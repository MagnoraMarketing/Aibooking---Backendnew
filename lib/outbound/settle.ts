import "server-only";
import type { getAdminClient } from "@/lib/database/admin";

type SupabaseAdmin = ReturnType<typeof getAdminClient>;

// Vapi's reasons for a call that never became a conversation. A campaign
// that asked for retries wants these tried again; a call the person actually
// took is done regardless of how it ended.
const NO_ANSWER_REASONS = /no-answer|busy|voicemail|customer-did-not-answer|failed|rejected|declined|unreachable/i;

export function vapiCallWasAnswered(endedReason: unknown): boolean {
  const reason = typeof endedReason === "string" ? endedReason : "";
  return !NO_ANSWER_REASONS.test(reason);
}

// Closes out a campaign contact once its call has ended — shared by both
// dialling paths, Vapi's end-of-call report (app/api/webhooks/vapi) and
// Twilio's status callback for calls placed straight through the
// customer's subaccount (app/api/telephony/twilio/voice/status).
//
// Every ended call used to mark the contact "completed", which made "we rang
// and nobody picked up" indistinguishable from "we spoke to them" — and made
// the retry setting a lie, because there was never anything left to retry.
//
// Only a contact still "calling" is touched: a redelivered webhook, or one
// arriving after the dialer already gave up on the attempt as stale (see
// lib/outbound/dialer.ts), must not reopen or overwrite what was settled.
export async function settleCampaignContact(
  supabase: SupabaseAdmin,
  contactId: string,
  outcome: { answered: boolean; reason: string }
): Promise<void> {
  if (outcome.answered) {
    await supabase
      .from("outbound_campaign_contacts")
      .update({ status: "completed", failure_reason: null, next_attempt_at: null, calling_since: null })
      .eq("id", contactId)
      .eq("status", "calling");
    return;
  }

  const { data: contact } = await supabase
    .from("outbound_campaign_contacts")
    .select("attempts, campaign_id")
    .eq("id", contactId)
    .maybeSingle();
  const { data: campaign } = contact
    ? await supabase
        .from("outbound_campaigns")
        .select("max_attempts, retry_after_minutes")
        .eq("id", contact.campaign_id)
        .maybeSingle()
    : { data: null };

  const attempts = contact?.attempts ?? 1;
  const maxAttempts = campaign?.max_attempts ?? 1;
  const failureReason = outcome.reason || "Opkaldet blev ikke besvaret";

  if (!campaign || attempts >= maxAttempts) {
    await supabase
      .from("outbound_campaign_contacts")
      .update({ status: "failed", failure_reason: failureReason, next_attempt_at: null, calling_since: null })
      .eq("id", contactId)
      .eq("status", "calling");
    return;
  }

  // Back in the queue. The dialer moves it again if the retry lands outside
  // the campaign's hours, so nothing here has to know about the window.
  await supabase
    .from("outbound_campaign_contacts")
    .update({
      status: "pending",
      failure_reason: failureReason,
      next_attempt_at: new Date(Date.now() + campaign.retry_after_minutes * 60_000).toISOString(),
      calling_since: null,
    })
    .eq("id", contactId)
    .eq("status", "calling");
}
