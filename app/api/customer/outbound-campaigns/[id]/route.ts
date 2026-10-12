import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import {
  readJsonBody,
  withErrorHandling,
  writeAuditLog,
  requireParam,
  outboundCampaignUpdateSchema,
} from "@/lib/security";
import { settingsToDbRow, windowIssue } from "@/lib/outbound/settings";
import { canChangeAgentOrNumber, canEditSettings, canReplaceAllContacts, type CampaignStatus } from "@/lib/outbound/status";
import {
  planContactList,
  type ContactInput,
  type ContactListPlan,
  type ExistingContact,
} from "@/lib/outbound/contacts";
import { nextWindowOpening, parseWallClock } from "@/lib/outbound/call-window";
import { outboundNumberIssue } from "@/lib/phone-numbers";
import { widgetDialsThroughTwilio } from "@/lib/widgets/provider";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// One campaign with its contact list — what the edit form loads. The list
// page only carries counts, because a hundred numbers per campaign is not
// something to send to the browser until someone opens one.
export const GET = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const campaignId = requireParam(params, "id");

  const { data: campaign, error } = await supabase
    .from("outbound_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw error;
  if (!campaign || campaign.customer_id !== ctx.profile.customer_id) throw ApiError.notFound("Campaign not found");

  const { data: contacts } = await supabase
    .from("outbound_campaign_contacts")
    .select("phone_number, contact_name, company, status, attempts, next_attempt_at, failure_reason")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });

  return NextResponse.json({ campaign, contacts: contacts ?? [] });
});

// Changing a campaign, including one already running.
//
// A campaign used to be write-once, then draft-only: a wrong instruction or
// a too-narrow call window meant cancelling a campaign halfway through and
// typing the list again. What stops that is not refusing all edits but
// keeping the edit off anything that already happened — which is exactly the
// line lib/outbound/status.ts draws:
//
//   * name, purpose, hours, retries — editable while there is a call left to
//     place, because they only decide calls not yet made;
//   * agent and number — only while nothing is being dialled, because they
//     decide what a call IS, and half a list answered by another agent from
//     another number is a record nobody can read;
//   * the contact list — replaced wholesale only in a draft. Afterwards it is
//     merged: new numbers are added, names are corrected, and a contact that
//     has been dialled is never deleted. Its call record, its recording and
//     its result are not ours to throw away because someone edited a
//     textarea.
export const PATCH = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, outboundCampaignUpdateSchema);
  const supabase = getAdminClient();
  const campaignId = requireParam(params, "id");
  const customerId = ctx.profile.customer_id!;

  const { data: campaign, error: lookupError } = await supabase
    .from("outbound_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!campaign || campaign.customer_id !== customerId) throw ApiError.notFound("Campaign not found");
  const status = campaign.status as CampaignStatus;
  if (!canEditSettings(status)) {
    throw ApiError.badRequest("Kampagnen er afsluttet og er nu en optegnelse over de opkald, der blev foretaget.");
  }
  if ((body.widgetId || body.phoneNumberId) && !canChangeAgentOrNumber(status)) {
    throw ApiError.badRequest(
      "Sæt kampagnen på pause, før du skifter agent eller telefonnummer — ellers bliver halvdelen af listen ringet op af den ene og halvdelen af den anden."
    );
  }

  // Checked against what the campaign will be after the edit, not what it
  // was: changing only the start time must still be judged against the end
  // time already stored.
  const badWindow = windowIssue(
    body.callWindowStart ?? String(campaign.call_window_start).slice(0, 5),
    body.callWindowEnd ?? String(campaign.call_window_end).slice(0, 5)
  );
  if (badWindow) throw ApiError.badRequest(badWindow);

  const widgetId = body.widgetId ?? campaign.widget_id;
  if (body.widgetId) {
    const { data: widget } = await supabase
      .from("widgets")
      .select("id, customer_id")
      .eq("id", body.widgetId)
      .maybeSingle();
    if (!widget || widget.customer_id !== customerId) throw ApiError.notFound("Widget not found");
  }

  // Re-checked whenever either half of the pairing moves: a number that
  // suited the old agent may be one the new agent cannot dial from.
  if (body.phoneNumberId || body.widgetId) {
    const { data: phoneNumber } = await supabase
      .from("phone_numbers")
      .select("id, customer_id, purchase_status, released_at, vapi_phone_number_id, twilio_sid")
      .eq("id", body.phoneNumberId ?? campaign.phone_number_id)
      .maybeSingle();
    if (!phoneNumber || phoneNumber.customer_id !== customerId) throw ApiError.notFound("Phone number not found");

    const issue = outboundNumberIssue(phoneNumber, { usesVapi: !(await widgetDialsThroughTwilio(widgetId)) });
    if (issue) throw ApiError.badRequest(issue);
  }

  const update: Record<string, unknown> = {
    ...settingsToDbRow(body),
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.widgetId !== undefined ? { widget_id: body.widgetId } : {}),
    ...(body.phoneNumberId !== undefined ? { phone_number_id: body.phoneNumberId } : {}),
  };

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from("outbound_campaigns").update(update).eq("id", campaignId);
    if (error) throw error;
  }

  const contactChanges = body.contacts
    ? await applyContactList(supabase, { ...campaign, status }, body.contacts)
    : null;

  const { data: updated } = await supabase
    .from("outbound_campaigns")
    .select("*, outbound_campaign_contacts(count)")
    .eq("id", campaignId)
    .maybeSingle();

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "outbound_campaign.updated",
    entityType: "outbound_campaign",
    entityId: campaignId,
    metadata: { ...update, contactCount: body.contacts?.length, ...contactChanges },
  });

  return NextResponse.json({ campaign: updated, contacts: contactChanges });
});

interface CampaignForContacts {
  id: string;
  status: CampaignStatus;
  call_window_start: string;
  call_window_end: string;
  call_days: number[] | null;
  call_timezone: string;
}

// Saving the contact list of a campaign that may already be halfway through.
// What should happen is decided by planContactList (lib/outbound/contacts.ts);
// this carries it out.
async function applyContactList(
  supabase: ReturnType<typeof getAdminClient>,
  campaign: CampaignForContacts,
  contacts: ContactInput[]
): Promise<Omit<ContactListPlan, "insert" | "update" | "delete"> & { added: number; updated: number; removed: number }> {
  const { data: existing, error: existingError } = await supabase
    .from("outbound_campaign_contacts")
    .select("id, phone_number, contact_name, company, status, attempts, last_called_at")
    .eq("campaign_id", campaign.id);
  if (existingError) throw existingError;

  const plan = planContactList((existing ?? []) as ExistingContact[], contacts, {
    replaceAll: canReplaceAllContacts(campaign.status),
  });

  if (plan.delete.length > 0) {
    const { error } = await supabase.from("outbound_campaign_contacts").delete().in("id", plan.delete);
    if (error) throw error;
  }

  for (const row of plan.update) {
    const { error } = await supabase
      .from("outbound_campaign_contacts")
      .update({ contact_name: row.contact_name, company: row.company })
      .eq("id", row.id);
    if (error) throw error;
  }

  if (plan.insert.length > 0) {
    // A draft's contacts are queued by launch; one added to a campaign that
    // is already running is due when the campaign's hours next allow it, so
    // it is rung like everyone else rather than sitting in the queue forever.
    const opening = canReplaceAllContacts(campaign.status)
      ? null
      : nextWindowOpening(
          {
            startMinutes: parseWallClock(campaign.call_window_start),
            endMinutes: parseWallClock(campaign.call_window_end),
            days: campaign.call_days ?? [],
            timeZone: campaign.call_timezone,
          },
          new Date()
        );

    const { error } = await supabase.from("outbound_campaign_contacts").insert(
      plan.insert.map((contact) => ({
        campaign_id: campaign.id,
        phone_number: contact.phoneNumber,
        contact_name: contact.name ?? null,
        company: contact.company ?? null,
        next_attempt_at: opening?.toISOString() ?? null,
      }))
    );
    if (error) throw error;
  }

  return {
    added: plan.insert.length,
    updated: plan.update.length,
    removed: plan.delete.length,
    keptBecauseCalled: plan.keptBecauseCalled,
  };
}

// Throwing away a draft. A launched campaign is a record of calls that were
// placed, so it stays.
export const DELETE = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const campaignId = requireParam(params, "id");
  const customerId = ctx.profile.customer_id!;

  const { data: campaign } = await supabase
    .from("outbound_campaigns")
    .select("id, customer_id, status")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign || campaign.customer_id !== customerId) throw ApiError.notFound("Campaign not found");
  if (campaign.status !== "draft") {
    throw ApiError.badRequest("Kampagnen er sendt af sted og kan ikke slettes.");
  }

  const { error } = await supabase.from("outbound_campaigns").delete().eq("id", campaignId);
  if (error) throw error;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "outbound_campaign.deleted",
    entityType: "outbound_campaign",
    entityId: campaignId,
  });

  return NextResponse.json({ success: true });
});
