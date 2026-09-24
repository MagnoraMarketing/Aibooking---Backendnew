import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { createOutboundCall } from "@/lib/vapi";
import { outboundAssistantId } from "@/lib/vapi/assistant-owner";
import { widgetDialsThroughTwilio } from "@/lib/widgets/provider";
import { createTwilioOutboundCall, getOrCreateSubaccount } from "@/lib/twilio";
import { twilioWebhookUrls } from "@/lib/telephony/urls";
import { isWithinCallWindow, nextWindowOpening, parseWallClock, type CallWindow } from "./call-window";
import { isDialable, type CampaignStatus } from "./status";
import { leadVariables } from "./csv";
import { retryDelayMinutes } from "./retry";
import { suppressedNumbers } from "./suppression";
import { getBalanceSeconds } from "@/lib/credits";

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
  voicemail_message: string | null;
  call_window_start: string;
  call_window_end: string;
  call_days: number[];
  call_timezone: string;
  max_concurrent_calls: number;
  max_attempts: number;
  retry_after_minutes: number;
  retry_rules: Record<string, number> | null;
}

export interface DialerTickResult {
  campaigns: number;
  dialed: number;
  deferred: number;
  failed: number;
  suppressed: number;
  pausedForCredits: number;
}

export interface DialContact {
  id: string;
  phone_number: string;
  contact_name: string | null;
  company: string | null;
  email: string | null;
  custom_data: Record<string, string> | null;
  attempts: number;
}

const CONTACT_COLUMNS = "id, phone_number, contact_name, company, email, custom_data, attempts";

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
  const result: DialerTickResult = { campaigns: 0, dialed: 0, deferred: 0, failed: 0, suppressed: 0, pausedForCredits: 0 };

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
      "id, status, customer_id, widget_id, phone_number_id, agent_instruction, voicemail_message, call_window_start, call_window_end, call_days, call_timezone, max_concurrent_calls, max_attempts, retry_after_minutes, retry_rules"
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

  // AI minutes come out of the same balance as everything else. With none
  // left the campaign is paused rather than left to fail every contact —
  // resuming it (after topping up) carries on where it stopped.
  if ((await getBalanceSeconds(campaign.customer_id)) <= 0) {
    await supabase
      .from("outbound_campaigns")
      .update({ status: "paused", paused_at: now.toISOString() })
      .eq("id", campaign.id)
      .eq("status", "running");
    result.pausedForCredits += 1;
    return result;
  }

  const staleBefore = new Date(now.getTime() - STALE_ATTEMPT_MINUTES * 60_000).toISOString();
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
    .select(CONTACT_COLUMNS)
    .eq("campaign_id", campaign.id)
    .eq("status", "pending")
    .not("next_attempt_at", "is", null)
    .lte("next_attempt_at", now.toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(slots)
    .returns<DialContact[]>();

  if (!contacts || contacts.length === 0) return result;

  const blocked = await suppressedNumbers(
    campaign.customer_id,
    contacts.map((contact) => contact.phone_number)
  );

  const placeCall = await resolveDialer(supabase, campaign);

  for (const contact of contacts) {
    // On the do-not-call list: never dialled, and never retried.
    if (blocked.has(contact.phone_number)) {
      await supabase
        .from("outbound_campaign_contacts")
        .update({
          status: "failed",
          outcome: "do_not_call",
          failure_reason: "Nummeret står på spærrelisten",
          next_attempt_at: null,
        })
        .eq("id", contact.id)
        .eq("status", "pending");
      result.suppressed += 1;
      continue;
    }

    if (await dialContact(supabase, campaign, contact, placeCall, now)) result.dialed += 1;
    else result.failed += 1;
  }

  return result;
}

// Claims one contact and rings it. Claimed before dialling, and only if
// still pending — two ticks (or a tick and a "test with one lead") must
// never ring the same person twice. Returns false when the call was
// refused or the contact was already taken.
async function dialContact(
  supabase: ReturnType<typeof getAdminClient>,
  campaign: CampaignRow,
  contact: DialContact,
  placeCall: (contact: DialContact) => Promise<string>,
  now: Date
): Promise<boolean> {
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
  if (!claimed) return false;

  try {
    const callId = await placeCall(contact);
    await supabase.from("outbound_campaign_contacts").update({ vapi_call_id: callId }).eq("id", contact.id);
    return true;
  } catch (err) {
    const reason = String(err);
    console.error("Outbound call refused:", reason);
    await settleFailedAttempt(supabase, campaign, contact.id, contact.attempts + 1, reason, now);
    return false;
  }
}

// "Test med ét lead": rings exactly one contact now, before the campaign is
// launched — so the customer hears the agent on a real call first. Same
// claim, same provider and same billing as the queue; the calling window,
// the do-not-call list and the balance are checked by the caller.
export async function dialSingleContact(campaignId: string, contactId: string, now: Date = new Date()): Promise<void> {
  const supabase = getAdminClient();
  const { data: campaign } = await supabase
    .from("outbound_campaigns")
    .select(
      "id, status, customer_id, widget_id, phone_number_id, agent_instruction, voicemail_message, call_window_start, call_window_end, call_days, call_timezone, max_concurrent_calls, max_attempts, retry_after_minutes, retry_rules"
    )
    .eq("id", campaignId)
    .maybeSingle<CampaignRow>();
  if (!campaign) throw new Error("Campaign not found");

  const { data: contact } = await supabase
    .from("outbound_campaign_contacts")
    .select(CONTACT_COLUMNS)
    .eq("id", contactId)
    .eq("campaign_id", campaignId)
    .maybeSingle<DialContact>();
  if (!contact) throw new Error("Contact not found");

  const placeCall = await resolveDialer(supabase, campaign);
  const ok = await dialContact(supabase, campaign, contact, placeCall, now);
  if (!ok) {
    const { data: after } = await supabase
      .from("outbound_campaign_contacts")
      .select("failure_reason")
      .eq("id", contactId)
      .maybeSingle();
    throw new Error(after?.failure_reason ?? "Opkaldet kunne ikke startes");
  }
}

// A refusal is only final once the campaign has no attempts left. Anything
// earlier goes back in the queue, which is the point of asking for retries.
async function settleFailedAttempt(
  supabase: ReturnType<typeof getAdminClient>,
  campaign: CampaignRow,
  contactId: string,
  attempts: number,
  reason: string,
  now: Date
): Promise<void> {
  if (attempts >= campaign.max_attempts) {
    await supabase
      .from("outbound_campaign_contacts")
      .update({ status: "failed", failure_reason: reason.slice(0, 500), next_attempt_at: null, calling_since: null })
      .eq("id", contactId);
    return;
  }

  // A call the provider refused outright counts as "failed" for the
  // campaign's retry rules.
  const retryAt = new Date(
    now.getTime() + retryDelayMinutes(campaign.retry_rules, "failed", campaign.retry_after_minutes) * 60_000
  );
  await supabase
    .from("outbound_campaign_contacts")
    .update({
      status: "pending",
      failure_reason: reason.slice(0, 500),
      next_attempt_at: (nextWindowOpening(windowOf(campaign), retryAt) ?? retryAt).toISOString(),
      calling_since: null,
    })
    .eq("id", contactId);
}

// Which provider places this campaign's calls, resolved once per campaign
// rather than once per contact — the same split the launch route makes.
async function resolveDialer(
  supabase: ReturnType<typeof getAdminClient>,
  campaign: CampaignRow
): Promise<(contact: DialContact) => Promise<string>> {
  const { data: phoneNumber } = await supabase
    .from("phone_numbers")
    .select("phone_number, vapi_phone_number_id")
    .eq("id", campaign.phone_number_id)
    .maybeSingle();
  if (!phoneNumber) throw new Error("Phone number no longer exists");

  if (await widgetDialsThroughTwilio(campaign.widget_id)) {
    const credentials = await getOrCreateSubaccount(campaign.customer_id);
    return async (contact: DialContact) =>
      (
        await createTwilioOutboundCall(credentials, {
          to: contact.phone_number,
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

  return async (contact: DialContact) =>
    (
      await createOutboundCall({
        assistantId,
        phoneNumberId: phoneNumber.vapi_phone_number_id!,
        customerNumber: contact.phone_number,
        variables: leadVariables({
          phone: contact.phone_number,
          name: contact.contact_name,
          company: contact.company,
          email: contact.email,
          customData: contact.custom_data,
        }),
        voicemailMessage: campaign.voicemail_message,
        // What this campaign is for, on top of the agent's own prompt. Only
        // for these calls — the assistant itself is never changed.
        campaignInstruction: campaign.agent_instruction,
      })
    ).id;
}
