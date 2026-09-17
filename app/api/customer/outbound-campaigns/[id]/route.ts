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
    .select("phone_number, contact_name, status, attempts, next_attempt_at, failure_reason")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });

  return NextResponse.json({ campaign, contacts: contacts ?? [] });
});

// Changing a campaign before it goes out.
//
// A campaign used to be write-once: a typo in the name, a wrong number in
// the list or an agent picked by mistake meant deleting it and typing the
// hundred numbers again. It is a draft until it is launched, and a draft
// that cannot be edited is not a draft.
//
// Only a draft. Once launched, calls have been placed against these
// settings; changing the list or the hours underneath a running campaign
// would make the record of what happened untrue.
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
  if (campaign.status !== "draft") {
    throw ApiError.badRequest("Kampagnen er sendt af sted og kan ikke ændres. Opret en ny i stedet.");
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

  // The list is replaced wholesale, which is what editing a textarea of
  // numbers means. Safe only because nothing has been dialled yet — every
  // contact is still pending, so nothing is thrown away that happened.
  if (body.contacts) {
    const { error: deleteError } = await supabase
      .from("outbound_campaign_contacts")
      .delete()
      .eq("campaign_id", campaignId);
    if (deleteError) throw deleteError;

    const { error: insertError } = await supabase.from("outbound_campaign_contacts").insert(
      body.contacts.map((contact) => ({
        campaign_id: campaignId,
        phone_number: contact.phoneNumber,
        contact_name: contact.name ?? null,
      }))
    );
    if (insertError) throw insertError;
  }

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
    metadata: { ...update, contactCount: body.contacts?.length },
  });

  return NextResponse.json({ campaign: updated });
});

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
