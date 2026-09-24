import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { createOutboundCall } from "@/lib/vapi";
import { outboundAssistantId } from "@/lib/vapi/assistant-owner";
import { widgetDialsThroughTwilio } from "@/lib/widgets/provider";
import { createTwilioOutboundCall, getOrCreateSubaccount } from "@/lib/twilio";
import { assertTwilioWebhookBaseUrlConfigured, twilioWebhookUrls } from "@/lib/telephony/urls";
import { isWithinCallWindow, nextWindowOpening, parseWallClock, type CallWindow } from "./call-window";
import { isDialable, type CampaignStatus } from "./status";

// Works a launched campaign's queue, a few contacts at a time.
//
// Launching used to fire every contact at once from the request that pressed
// the button. Vapi allows ten concurrent calls for the whole platform, so a
// hundred-contact campaign mostly failed; a contact who did not pick up was
// never tried again; and a campaign launched in the evening rang everyone in
// the evening. None of that is fixable from inside one request — dialling has
// to happen over time, which is what this is.
//
// Called every minute (see 0040_outbound_dialer_schedule.sql) and safe to
// call more often: it only ever picks up contacts that are due, and marks
// them as calling before it dials.

// An attempt that has not reported back within this long is not still
// ringing — Vapi's longest call is shorter — so it stops counting against
// the campaign's concurrency and blocking the rest of the queue.
const STALE_ATTEMPT_MINUTES = 30;

// How many campaigns one tick will touch. A tick runs inside a serverless
// request, so it has to end.
const CAMPAIGNS_PER_TICK = 20;

interface CampaignRow {
  id: string;
  status: CampaignStatus;
  customer_id: string;
  widget_id: string;
  phone_number_id: string;
  agent_instruction: string | null;
  call_window_start: string;
  call_window_end: string;
  call_days: number[];
  call_timezone: string;
  max_concurrent_calls: number;
  max_attempts: number;
  retry_after_minutes: number;
}

export interface DialerTickResult {
  campaigns: number;
  dialed: number;
  deferred: number;
  failed: number;
}

function windowOf(campaign: CampaignRow): CallWindow {
  return {
    startMinutes: parseWallClock(campaign.call_window_start),
    endMinutes: parseWallClock(campaign.call_window_end),
    days: campaign.call_days ?? [],
    timeZone: campaign.call_timezone,
  };
}

export async function runDialerTick(now: Date = new Date()): Promise<DialerTickResult> {
  const supabase = getAdminClient();
  const result: DialerTickResult = { campaigns: 0, dialed: 0, deferred: 0, failed: 0 };

  // Campaigns with at least one contact due. Fetched as ids first so the
  // "which campaigns have work" question stays one indexed read.
  const { data: dueContacts } = await supabase
    .from("outbound_campaign_contacts")
    .select("campaign_id")
    .eq("status", "pending")
    .not("next_attempt_at", "is", null)
    .lte("next_attempt_at", now.toISOString())
    .limit(500);

  const campaignIds = [...new Set((dueContacts ?? []).map((row) => row.campaign_id))].slice(0, CAMPAIGNS_PER_TICK);
  if (campaignIds.length === 0) return result;

  const { data: campaigns } = await supabase
    .from("outbound_campaigns")
    .select(
      "id, status, customer_id, widget_id, phone_number_id, agent_instruction, call_window_start, call_window_end, call_days, call_timezone, max_concurrent_calls, max_attempts, retry_after_minutes"
    )
    .in("id", campaignIds)
    // Paused campaigns keep their queue untouched and are simply not dialled
    // — see lib/outbound/status.ts.
    .eq("status", "running")
    .returns<CampaignRow[]>();

  for (const campaign of campaigns ?? []) {
    result.campaigns += 1;
    Object.assign(result, await runCampaign(supabase, campaign, now, result));
  }

  return result;
}

// Closes a campaign that has nothing left to dial.
//
// "Completed" has to be a fact about the contacts rather than a button
// somebody pressed, so it is decided here: no contact still pending and none
// still ringing. Failed rather than completed when every single call was
// refused — a campaign that reached nobody did not succeed, and saying it
// completed would bury exactly the thing worth looking at.
//
// Checked for every running campaign on every tick, not only ones that dialled
// this minute: the last call of a campaign is settled by the webhook, long
// after the dialer's final tick for it.
export async function finishCompletedCampaigns(
  supabase: ReturnType<typeof getAdminClient>,
  now: Date = new Date()
): Promise<number> {
  const { data: running } = await supabase
    .from("outbound_campaigns")
    .select("id")
    .eq("status", "running")
    .limit(100);

  let finished = 0;
  for (const campaign of running ?? []) {
    const { data: rows } = await supabase
      .from("outbound_campaign_contacts")
      .select("status")
      .eq("campaign_id", campaign.id);
    if (!rows || rows.length === 0) continue;

    const open = rows.filter((row) => row.status === "pending" || row.status === "calling").length;
    if (open > 0) continue;

    const completedCount = rows.filter((row) => row.status === "completed").length;
    await supabase
      .from("outbound_campaigns")
      .update({
        status: completedCount > 0 ? "completed" : "failed",
        finished_at: now.toISOString(),
      })
      .eq("id", campaign.id)
      .eq("status", "running");
    finished += 1;
  }

  return finished;
}

async function runCampaign(
  supabase: ReturnType<typeof getAdminClient>,
  campaign: CampaignRow,
  now: Date,
  result: DialerTickResult
): Promise<DialerTickResult> {
  // The query already filters to running; this is the rule itself, stated
  // where the calls are placed rather than only in a where-clause.
  if (!isDialable(campaign.status)) return result;

  const window = windowOf(campaign);

  // Outside the hours: park everything due until the window opens again
  // rather than failing it. An evening launch starts in the morning.
  if (!isWithinCallWindow(window, now)) {
    const opening = nextWindowOpening(window, now);
    if (!opening) return result;

    const { count } = await supabase
      .from("outbound_campaign_contacts")
      .update({ next_attempt_at: opening.toISOString() }, { count: "exact" })
      .eq("campaign_id", campaign.id)
      .eq("status", "pending")
      .lte("next_attempt_at", now.toISOString());
    result.deferred += count ?? 0;
    return result;
  }

  const staleBefore = new Date(now.getTime() - STALE_ATTEMPT_MINUTES * 60_000).toISOString();

  // An attempt that never reported back is settled here as an unanswered
  // one — the backstop for a status webhook that was lost or never came.
  // Without it the contact sat in "calling" for good: never retried, and
  // its campaign could never finish, because finishCompletedCampaigns waits
  // for every "calling" row.
  const { data: staleContacts } = await supabase
    .from("outbound_campaign_contacts")
    .select("id, attempts")
    .eq("campaign_id", campaign.id)
    .eq("status", "calling")
    .lt("calling_since", staleBefore);
  for (const stale of staleContacts ?? []) {
    await settleFailedAttempt(
      supabase,
      campaign,
      stale.id,
      stale.attempts,
      "Intet svar fra telefoniudbyderen",
      now,
      { onlyIfCalling: true }
    );
  }

  const { count: inFlight } = await supabase
    .from("outbound_campaign_contacts")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .eq("status", "calling")
    .gte("calling_since", staleBefore);

  const slots = campaign.max_concurrent_calls - (inFlight ?? 0);
  if (slots <= 0) return result;

  const { data: contacts } = await supabase
    .from("outbound_campaign_contacts")
    .select("id, phone_number, contact_name, attempts")
    .eq("campaign_id", campaign.id)
    .eq("status", "pending")
    .not("next_attempt_at", "is", null)
    .lte("next_attempt_at", now.toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(slots);

  if (!contacts || contacts.length === 0) return result;

  // One campaign whose number or agent is broken must not stop every other
  // campaign in this tick — this used to throw straight out of the route.
  // Its contacts stay pending (nothing was claimed yet) and it is retried
  // next tick, logged each time so the reason is visible.
  let placeCall: (to: string) => Promise<string>;
  try {
    placeCall = await resolveDialer(supabase, campaign);
  } catch (err) {
    console.error(`Outbound dialer: campaign ${campaign.id} cannot dial:`, String(err));
    return result;
  }

  for (const contact of contacts) {
    // Claimed before dialling, and only if still pending — two ticks
    // overlapping must not ring the same person twice.
    const { data: claimed } = await supabase
      .from("outbound_campaign_contacts")
      .update({
        status: "calling",
        calling_since: now.toISOString(),
        last_called_at: now.toISOString(),
        attempts: contact.attempts + 1,
      })
      .eq("id", contact.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    try {
      const callId = await placeCall(contact.phone_number);
      await supabase.from("outbound_campaign_contacts").update({ vapi_call_id: callId }).eq("id", contact.id);
      result.dialed += 1;
    } catch (err) {
      const reason = String(err);
      console.error("Outbound call refused:", reason);
      await settleFailedAttempt(supabase, campaign, contact.id, contact.attempts + 1, reason, now);
      result.failed += 1;
    }
  }

  return result;
}

// A refusal is only final once the campaign has no attempts left. Anything
// earlier goes back in the queue, which is the point of asking for retries.
async function settleFailedAttempt(
  supabase: ReturnType<typeof getAdminClient>,
  campaign: CampaignRow,
  contactId: string,
  attempts: number,
  reason: string,
  now: Date,
  options: { onlyIfCalling?: boolean } = {}
): Promise<void> {
  // The stale sweep races the webhooks: a late status callback may have
  // settled the contact between the read and this write.
  const scoped = <T extends { eq: (column: string, value: string) => T }>(query: T): T =>
    options.onlyIfCalling ? query.eq("status", "calling") : query;

  if (attempts >= campaign.max_attempts) {
    await scoped(
      supabase
        .from("outbound_campaign_contacts")
        .update({ status: "failed", failure_reason: reason.slice(0, 500), next_attempt_at: null, calling_since: null })
        .eq("id", contactId)
    );
    return;
  }

  const retryAt = new Date(now.getTime() + campaign.retry_after_minutes * 60_000);
  await scoped(
    supabase
      .from("outbound_campaign_contacts")
      .update({
        status: "pending",
        failure_reason: reason.slice(0, 500),
        next_attempt_at: (nextWindowOpening(windowOf(campaign), retryAt) ?? retryAt).toISOString(),
        calling_since: null,
      })
      .eq("id", contactId)
  );
}

// Which provider places this campaign's calls, resolved once per campaign
// rather than once per contact — the same split the launch route makes.
async function resolveDialer(
  supabase: ReturnType<typeof getAdminClient>,
  campaign: CampaignRow
): Promise<(to: string) => Promise<string>> {
  const { data: phoneNumber } = await supabase
    .from("phone_numbers")
    .select("phone_number, vapi_phone_number_id")
    .eq("id", campaign.phone_number_id)
    .maybeSingle();
  if (!phoneNumber) throw new Error("Phone number no longer exists");

  if (await widgetDialsThroughTwilio(campaign.widget_id)) {
    // Twilio fetches the answer URL from the outside; a localhost one
    // rings the contact and then drops the call on pickup.
    assertTwilioWebhookBaseUrlConfigured();
    const credentials = await getOrCreateSubaccount(campaign.customer_id);
    return async (to: string) =>
      (
        await createTwilioOutboundCall(credentials, {
          to,
          from: phoneNumber.phone_number,
          voiceUrl: twilioWebhookUrls().outboundStart,
          statusCallbackUrl: twilioWebhookUrls().status,
        })
      ).sid;
  }

  const { data: settings } = await supabase
    .from("widget_settings")
    .select("extra")
    .eq("widget_id", campaign.widget_id)
    .maybeSingle();
  const assistantId = outboundAssistantId((settings?.extra as Record<string, unknown> | null) ?? {});
  if (!assistantId) throw new Error("Denne agent har ikke en Vapi-assistent");

  return async (to: string) =>
    (
      await createOutboundCall({
        assistantId,
        phoneNumberId: phoneNumber.vapi_phone_number_id!,
        customerNumber: to,
        // What this campaign is for, on top of the agent's own prompt. Only
        // for these calls — the assistant itself is never changed.
        campaignInstruction: campaign.agent_instruction,
      })
    ).id;
}
