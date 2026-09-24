import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, outboundCampaignInputSchema } from "@/lib/security";
import { settingsToDbRow, windowIssue } from "@/lib/outbound/settings";
import { campaignStatsFor, EMPTY_STATS } from "@/lib/outbound/stats";
import { outboundNumberIssue } from "@/lib/phone-numbers";
import { widgetDialsThroughTwilio } from "@/lib/widgets/provider";
import { suppressedNumbers } from "@/lib/outbound/suppression";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// The overview, with what each campaign amounts to. Polled by the dashboard
// while a campaign is running, so it answers in two queries for all of them
// rather than a handful each (see lib/outbound/stats.ts).
export const GET = withErrorHandling(async () => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("outbound_campaigns")
    .select("*, outbound_campaign_contacts(count)")
    .eq("customer_id", ctx.profile.customer_id!)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const stats = await campaignStatsFor((data ?? []).map((campaign) => campaign.id), supabase);

  return NextResponse.json({
    campaigns: (data ?? []).map((campaign) => ({ ...campaign, stats: stats[campaign.id] ?? EMPTY_STATS })),
  });
});

// Creates a campaign in "draft" status with its contact list — placing the
// actual calls is a separate step (POST .../[id]/launch), so a customer can
// review the list before anything goes out.
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, outboundCampaignInputSchema);
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const { data: widget, error: widgetError } = await supabase
    .from("widgets")
    .select("id, customer_id")
    .eq("id", body.widgetId)
    .maybeSingle();
  if (widgetError) throw widgetError;
  if (!widget || widget.customer_id !== customerId) throw ApiError.notFound("Widget not found");

  const { data: phoneNumber, error: phoneNumberError } = await supabase
    .from("phone_numbers")
    .select("id, customer_id, purchase_status, released_at, vapi_phone_number_id, twilio_sid")
    .eq("id", body.phoneNumberId)
    .maybeSingle();
  if (phoneNumberError) throw phoneNumberError;
  if (!phoneNumber || phoneNumber.customer_id !== customerId) {
    throw ApiError.notFound("Phone number not found");
  }

  // Any of the customer's numbers, not just one bound to this agent — see
  // lib/phone-numbers/outbound.ts for what actually decides it.
  const issue = outboundNumberIssue(phoneNumber, { usesVapi: !(await widgetDialsThroughTwilio(widget.id)) });
  if (issue) throw ApiError.badRequest(issue);

  const badWindow = windowIssue(body.callWindowStart, body.callWindowEnd);
  if (badWindow) throw ApiError.badRequest(badWindow);

  const { data: campaign, error } = await supabase
    .from("outbound_campaigns")
    .insert({
      customer_id: customerId,
      widget_id: widget.id,
      phone_number_id: phoneNumber.id,
      name: body.name,
      // Anything the form left out keeps the column default — weekdays
      // 09–17 in Copenhagen, three at a time, one attempt.
      ...settingsToDbRow(body),
    })
    .select("*")
    .single();

  if (error) throw error;

  let contactRows: Record<string, unknown>[];
  if (body.leadListId) {
    const { data: list } = await supabase
      .from("lead_lists")
      .select("id, customer_id")
      .eq("id", body.leadListId)
      .maybeSingle();
    if (!list || list.customer_id !== customerId) {
      await supabase.from("outbound_campaigns").delete().eq("id", campaign.id);
      throw ApiError.notFound("Lead list not found");
    }
    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select("phone_number, contact_name, company, email, custom_data, status")
      .eq("list_id", list.id)
      .eq("customer_id", customerId)
      .neq("status", "do_not_call")
      .order("created_at", { ascending: true })
      .limit(5000);
    if (leadsError) throw leadsError;
    const blocked = await suppressedNumbers(customerId, (leads ?? []).map((lead) => lead.phone_number));
    const seen = new Set<string>();
    contactRows = (leads ?? [])
      .filter((lead) => !blocked.has(lead.phone_number) && !seen.has(lead.phone_number) && seen.add(lead.phone_number))
      .map((lead) => ({
        campaign_id: campaign.id,
        phone_number: lead.phone_number,
        contact_name: lead.contact_name,
        company: lead.company,
        email: lead.email,
        custom_data: lead.custom_data ?? {},
      }));
    if (contactRows.length === 0) {
      await supabase.from("outbound_campaigns").delete().eq("id", campaign.id);
      throw ApiError.badRequest("Listen har ingen leads, der må ringes op.");
    }
  } else {
    contactRows = body.contacts!.map((contact) => ({
      campaign_id: campaign.id,
      phone_number: contact.phoneNumber,
      contact_name: contact.name ?? null,
      company: contact.company ?? null,
    }));
  }

  const { error: contactsError } = await supabase.from("outbound_campaign_contacts").insert(contactRows);

  if (contactsError) {
    // Don't leave an empty campaign behind if the contact list failed to save.
    await supabase.from("outbound_campaigns").delete().eq("id", campaign.id);
    throw contactsError;
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "outbound_campaign.created",
    entityType: "outbound_campaign",
    entityId: campaign.id,
    metadata: { contactCount: contactRows.length, leadListId: body.leadListId ?? null },
  });

  return NextResponse.json({ campaign }, { status: 201 });
});
