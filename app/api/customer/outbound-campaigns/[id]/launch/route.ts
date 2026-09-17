import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog, requireParam } from "@/lib/security";
import { checkAndRefillIfNeeded } from "@/lib/credits";
import { nextWindowOpening, parseWallClock, type CallWindow } from "@/lib/outbound/call-window";
import { canLaunch } from "@/lib/outbound/status";
import { outboundNumberIssue } from "@/lib/phone-numbers";
import { widgetDialsThroughTwilio } from "@/lib/widgets/provider";
import { outboundAssistantId } from "@/lib/vapi/assistant-owner";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// A campaign can only be launched once (draft -> running), and launching
// queues its contacts rather than calling them. Stopping and restarting it
// afterwards is pause/resume, not a second launch. The dialer works that queue a few at a time, inside the campaign's
// own hours (lib/outbound/dialer.ts).
//
// What stays here is everything worth refusing before a single call goes
// out: no minutes, an agent with no assistant, a number that cannot dial.
// Those are the same for all 100 contacts, and finding out per contact,
// after the campaign says "sendt", is how a customer ends up with a hundred
// identical failures and no idea why.
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
  if (!canLaunch(campaign.status)) throw ApiError.badRequest("Kampagnen er allerede sendt af sted.");

  const refill = await checkAndRefillIfNeeded(customerId);
  if (refill.balanceSeconds <= 0) {
    throw ApiError.paymentRequired("No minutes remaining on this account");
  }

  const isTwilioDirect = await widgetDialsThroughTwilio(campaign.widget_id);

  if (!isTwilioDirect) {
    const { data: settings } = await supabase
      .from("widget_settings")
      .select("extra")
      .eq("widget_id", campaign.widget_id)
      .maybeSingle();
    // An agent may keep a separate persona for campaign calls — placing one
    // is not the same conversation as answering the phone. Falls back to the
    // assistant that answers when there is only the one. The dialer resolves
    // it again per campaign; this is the pre-flight so the customer hears
    // about a missing assistant now rather than from 100 failed contacts.
    if (!outboundAssistantId((settings?.extra as Record<string, unknown> | null) ?? {})) {
      throw ApiError.badRequest("Denne agent har ikke en Vapi-assistent");
    }
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

  // Queued, not dialled. Launching used to place every call from this one
  // request: Vapi allows ten concurrent calls for the whole platform, so a
  // hundred-contact campaign mostly failed, nobody was ever tried a second
  // time, and a campaign launched at 21:00 rang a hundred people at 21:00.
  // The dialer works the queue a few at a time, inside the campaign's own
  // hours (see lib/outbound/dialer.ts).
  const window: CallWindow = {
    startMinutes: parseWallClock(campaign.call_window_start),
    endMinutes: parseWallClock(campaign.call_window_end),
    days: campaign.call_days ?? [],
    timeZone: campaign.call_timezone,
  };
  const now = new Date();
  const firstAttemptAt = nextWindowOpening(window, now);
  if (!firstAttemptAt) {
    throw ApiError.badRequest("Kampagnen har ingen ringedage valgt, så der er ingen tidspunkter at ringe på.");
  }

  const { data: contacts, error: contactsError } = await supabase
    .from("outbound_campaign_contacts")
    .update({ next_attempt_at: firstAttemptAt.toISOString() })
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .select("id");
  if (contactsError) throw contactsError;

  await supabase
    .from("outbound_campaigns")
    .update({ status: "running", launched_at: new Date().toISOString() })
    .eq("id", campaignId);

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "outbound_campaign.launched",
    entityType: "outbound_campaign",
    entityId: campaignId,
    metadata: { contactCount: contacts?.length ?? 0, firstAttemptAt: firstAttemptAt.toISOString() },
  });

  return NextResponse.json({
    queued: contacts?.length ?? 0,
    // When the first call goes out — now, or when the window next opens. The
    // dashboard says so, because a campaign that queues silently looks
    // exactly like one that did nothing.
    startsAt: firstAttemptAt.toISOString(),
    startsNow: firstAttemptAt.getTime() <= now.getTime() + 60_000,
  });
});
