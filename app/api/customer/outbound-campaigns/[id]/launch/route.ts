import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog, requireParam } from "@/lib/security";
import { checkAndRefillIfNeeded } from "@/lib/credits";
import { createOutboundCall, describeOutboundCallFailure } from "@/lib/vapi";
import { createTwilioOutboundCall, getOrCreateSubaccount } from "@/lib/twilio";
import { twilioWebhookUrls } from "@/lib/telephony/urls";
import { outboundNumberIssue } from "@/lib/phone-numbers";
import { widgetDialsThroughTwilio } from "@/lib/widgets/provider";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// One-way transition: a campaign can only be launched once (status
// draft -> launched). Fires one outbound call per pending contact
// concurrently, tolerating individual failures (a bad number shouldn't
// abort the rest of the campaign) — see outboundCampaignInputSchema's
// 100-contact cap for why this can run synchronously within one request.
// Which provider places the call (Vapi vs. Twilio-direct, see
// lib/telephony) depends on the agent's model, same branch used when the
// number was provisioned (lib/phone-numbers/service.ts).
export const POST = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const campaignId = requireParam(params, "id");
  const customerId = ctx.profile.customer_id!;

  const { data: campaign, error } = await supabase
    .from("outbound_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw error;
  if (!campaign || campaign.customer_id !== customerId) throw ApiError.notFound("Campaign not found");
  if (campaign.status !== "draft") throw ApiError.badRequest("Campaign has already been launched");

  const refill = await checkAndRefillIfNeeded(customerId);
  if (refill.balanceSeconds <= 0) {
    throw ApiError.paymentRequired("No minutes remaining on this account");
  }

  const isTwilioDirect = await widgetDialsThroughTwilio(campaign.widget_id);

  let assistantId: string | null = null;
  if (!isTwilioDirect) {
    const { data: settings } = await supabase
      .from("widget_settings")
      .select("extra")
      .eq("widget_id", campaign.widget_id)
      .maybeSingle();
    const rawAssistantId = (settings?.extra as Record<string, unknown> | null)?.vapiAssistantId;
    if (typeof rawAssistantId !== "string") {
      throw ApiError.badRequest("Denne agent har ikke en Vapi-assistent");
    }
    assistantId = rawAssistantId;
  }

  // Re-checked at launch, not just at creation: a number can be released or
  // fail between drafting a campaign and sending it. The customer check is
  // this route's own — the campaign is theirs, but the number id on it is
  // only as trustworthy as whoever wrote that row.
  const { data: phoneNumber, error: phoneNumberError } = await supabase
    .from("phone_numbers")
    .select("customer_id, phone_number, vapi_phone_number_id, twilio_sid, purchase_status, released_at")
    .eq("id", campaign.phone_number_id)
    .maybeSingle();
  if (phoneNumberError) throw phoneNumberError;
  if (!phoneNumber || phoneNumber.customer_id !== customerId) {
    throw ApiError.badRequest("Phone number no longer exists");
  }

  const numberIssue = outboundNumberIssue(phoneNumber, { usesVapi: !isTwilioDirect });
  if (numberIssue) throw ApiError.badRequest(numberIssue);

  const twilioCredentials = isTwilioDirect ? await getOrCreateSubaccount(customerId) : null;

  const { data: contacts, error: contactsError } = await supabase
    .from("outbound_campaign_contacts")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("status", "pending");
  if (contactsError) throw contactsError;

  const results = await Promise.allSettled(
    (contacts ?? []).map(async (contact) => {
      // outbound_campaign_contacts.vapi_call_id stores the provider's call
      // id regardless of provider — Vapi's or Twilio's — the column name
      // predates this second provider.
      const callId =
        isTwilioDirect && twilioCredentials
          ? (
              await createTwilioOutboundCall(twilioCredentials, {
                to: contact.phone_number,
                from: phoneNumber.phone_number,
                voiceUrl: twilioWebhookUrls().outboundStart,
                statusCallbackUrl: twilioWebhookUrls().status,
              })
            ).sid
          : (
              await createOutboundCall({
                assistantId: assistantId!,
                phoneNumberId: phoneNumber.vapi_phone_number_id!,
                customerNumber: contact.phone_number,
              })
            ).id;

      const { error: updateError } = await supabase
        .from("outbound_campaign_contacts")
        .update({ status: "calling", vapi_call_id: callId })
        .eq("id", contact.id);
      if (updateError) throw updateError;
    })
  );

  // The raw provider text is kept on the row, where we can read it; the
  // customer gets the distinct reasons in their own language. A campaign
  // where every call was refused used to look exactly like one that went
  // out — status "launched", nothing on screen — which is how "den ringer
  // ikke op" becomes a mystery instead of a message.
  let failedCount = 0;
  const failures = new Map<string, number>();
  await Promise.all(
    results.map(async (result, i) => {
      if (result.status !== "rejected") return;
      failedCount += 1;

      const raw = String(result.reason);
      console.error("Outbound call refused:", raw);
      const explained = describeOutboundCallFailure(raw);
      failures.set(explained, (failures.get(explained) ?? 0) + 1);

      await supabase
        .from("outbound_campaign_contacts")
        .update({ status: "failed", failure_reason: raw.slice(0, 500) })
        .eq("id", contacts![i].id);
    })
  );

  await supabase
    .from("outbound_campaigns")
    .update({ status: "launched", launched_at: new Date().toISOString() })
    .eq("id", campaignId);

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "outbound_campaign.launched",
    entityType: "outbound_campaign",
    entityId: campaignId,
    metadata: { contactCount: contacts?.length ?? 0, failedCount },
  });

  return NextResponse.json({
    launched: (contacts?.length ?? 0) - failedCount,
    failed: failedCount,
    failures: [...failures].map(([reason, count]) => ({ reason, count })),
  });
});
