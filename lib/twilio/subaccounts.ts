import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { twilioFetch, getPlatformTwilioCredentials, type TwilioCredentials } from "./client";
import { ApiError } from "@/types/errors";

// Every customer who buys a number through us gets their own Twilio
// subaccount, created lazily on first purchase attempt (see
// 0016_twilio_subaccounts.sql for why). Idempotent: a second call for the
// same customer reuses the stored row instead of creating a second
// subaccount, and a unique constraint on customer_id makes a race between
// two concurrent purchase attempts safe — the loser's insert fails, and it
// falls back to reading the row the winner just created.
export async function getOrCreateSubaccount(customerId: string): Promise<TwilioCredentials> {
  const supabase = getAdminClient();

  const { data: existing, error: lookupError } = await supabase
    .from("twilio_subaccounts")
    .select("twilio_subaccount_sid, twilio_subaccount_auth_token, status")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (existing && existing.status === "active") {
    return { accountSid: existing.twilio_subaccount_sid, authToken: existing.twilio_subaccount_auth_token };
  }
  if (existing) {
    throw ApiError.internal(
      `Jeres Twilio-forbindelse er ikke aktiv (status: ${existing.status}). Kontakt support.`
    );
  }

  const platformCredentials = getPlatformTwilioCredentials();
  const response = await twilioFetch("/Accounts.json", platformCredentials, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ FriendlyName: `AIbooking – ${customerId}` }),
  });
  const created = (await response.json()) as { sid: string; auth_token: string };

  const { data: inserted, error: insertError } = await supabase
    .from("twilio_subaccounts")
    .insert({
      customer_id: customerId,
      twilio_subaccount_sid: created.sid,
      twilio_subaccount_auth_token: created.auth_token,
      status: "active",
    })
    .select("twilio_subaccount_sid, twilio_subaccount_auth_token")
    .single();

  if (insertError) {
    // Lost a race with a concurrent purchase attempt — fall back to the
    // row the other request just inserted rather than leaving an orphaned
    // Twilio subaccount unreferenced.
    const { data: winner, error: refetchError } = await supabase
      .from("twilio_subaccounts")
      .select("twilio_subaccount_sid, twilio_subaccount_auth_token")
      .eq("customer_id", customerId)
      .single();
    if (refetchError || !winner) throw insertError;
    return { accountSid: winner.twilio_subaccount_sid, authToken: winner.twilio_subaccount_auth_token };
  }

  return { accountSid: inserted.twilio_subaccount_sid, authToken: inserted.twilio_subaccount_auth_token };
}
