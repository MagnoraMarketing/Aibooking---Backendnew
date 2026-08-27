import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { getOrCreateSubaccount, type TwilioCredentials } from "@/lib/twilio";

export interface TwilioDirectNumberContext {
  phoneNumberId: string;
  customerId: string;
  widgetId: string;
  credentials: TwilioCredentials;
}

// Twilio always sends a canonical E.164 "To"/"From", but a row could have
// been written from a less tidy source, so a lookup tries both the literal
// string and its digits-only normalization rather than missing the number
// (and hanging up on a real caller) over a space or a dash.
function phoneNumberLookupCandidates(phoneNumber: string): string[] {
  const raw = phoneNumber.trim();
  if (!raw) return [];

  const digits = raw.replace(/\D/g, "").replace(/^00/, "");
  const normalized = digits ? `+${digits}` : "";

  return normalized && normalized !== raw ? [raw, normalized] : [raw];
}

// Looks up which customer/widget owns a given E.164 number and returns the
// Twilio subaccount credentials needed to validate that call's request
// signature — used by every telephony webhook to go from "a request
// claiming to be about +45..." to "the actual owner's Twilio secret",
// which is what makes the signature check meaningful.
export async function resolveTwilioDirectNumber(phoneNumber: string): Promise<TwilioDirectNumberContext | null> {
  const candidates = phoneNumberLookupCandidates(phoneNumber);
  if (candidates.length === 0) return null;

  const supabase = getAdminClient();
  // Deliberately not .maybeSingle(): the same number can legitimately have
  // more than one active row (imported again after being pointed at another
  // agent), and maybeSingle turns that into an error — i.e. into "unknown
  // number, goodbye" on a number that works. Newest row wins instead, which
  // matches what the customer configured most recently.
  const { data: rows } = await supabase
    .from("phone_numbers")
    .select("id, customer_id, widget_id, source, twilio_account_sid, twilio_auth_token")
    .in("phone_number", candidates)
    .eq("purchase_status", "active")
    .order("created_at", { ascending: false })
    .limit(1);

  const row = rows?.[0];
  if (!row) return null;

  // Platform-purchased numbers validate against the customer's Twilio
  // subaccount (one set of credentials per customer); BYO numbers carry
  // their own customer-supplied credentials directly on the row instead —
  // see 0021_byo_twilio_direct.sql for why there's no subaccount to use here.
  const credentials =
    row.source === "byo_twilio" && row.twilio_account_sid && row.twilio_auth_token
      ? { accountSid: row.twilio_account_sid, authToken: row.twilio_auth_token }
      : await getOrCreateSubaccount(row.customer_id);

  return { phoneNumberId: row.id, customerId: row.customer_id, widgetId: row.widget_id, credentials };
}

// Which Twilio auth token signed a given call's webhook depends on the
// number the call ran on, not on the customer alone — a BYO number signs
// with the customer's own token, a platform-purchased one with its
// subaccount token. Callbacks that carry a number (the status webhook's
// To/From) can therefore resolve it exactly; the subaccount stays the
// fallback for the platform-purchased case. A number belonging to a
// different customer is ignored rather than trusted, so a callback can't
// be validated against credentials the conversation has nothing to do with.
export async function resolveTwilioCallCredentials(params: {
  customerId: string;
  candidateNumbers: Array<string | undefined | null>;
}): Promise<TwilioCredentials> {
  for (const candidate of params.candidateNumbers) {
    if (!candidate) continue;
    const context = await resolveTwilioDirectNumber(candidate);
    if (context && context.customerId === params.customerId) return context.credentials;
  }

  return getOrCreateSubaccount(params.customerId);
}
