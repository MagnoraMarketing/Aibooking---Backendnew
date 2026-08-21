import "server-only";
import { jwt } from "twilio";
import { getAdminClient } from "@/lib/database/admin";
import { twilioWebhookUrls } from "@/lib/telephony/urls";
import { twilioFetch, type TwilioCredentials } from "./client";
import { getOrCreateSubaccount } from "./subaccounts";

const { AccessToken } = jwt;
const { VoiceGrant } = AccessToken;

const TOKEN_TTL_SECONDS = 3600;

export interface DialerAppCredentials extends TwilioCredentials {
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
}

// Lazily provisions the manual dialer's browser-calling resources: a
// Signing Key (to mint Voice Access Tokens) and a TwiML Application (whose
// Voice Request URL points at dialer-start), both created directly under
// the customer's own Twilio subaccount rather than the platform's shared
// account (contrast lib/twilio/voice-token.ts, which mints tokens against
// one platform-wide TwiML App for the widget's ConversationRelay flow) — so
// a browser call placed here bills and shows caller ID under the
// customer's own subaccount/number. Idempotent and cached on
// twilio_subaccounts, mirroring getOrCreateSubaccount's own shape; a rare
// double-provision race just leaves an extra unused Key/Application behind
// on Twilio's side, harmless and not worth guarding against.
export async function getOrCreateDialerApp(customerId: string): Promise<DialerAppCredentials> {
  const subaccount = await getOrCreateSubaccount(customerId);
  const supabase = getAdminClient();

  const { data: existing, error } = await supabase
    .from("twilio_subaccounts")
    .select("dialer_api_key_sid, dialer_api_key_secret, dialer_twiml_app_sid")
    .eq("customer_id", customerId)
    .single();
  if (error) throw error;

  if (existing.dialer_api_key_sid && existing.dialer_api_key_secret && existing.dialer_twiml_app_sid) {
    return {
      ...subaccount,
      apiKeySid: existing.dialer_api_key_sid,
      apiKeySecret: existing.dialer_api_key_secret,
      twimlAppSid: existing.dialer_twiml_app_sid,
    };
  }

  const voiceUrl = `${twilioWebhookUrls().dialerStart}?customerId=${encodeURIComponent(customerId)}`;

  const [keyResponse, appResponse] = await Promise.all([
    twilioFetch("/Keys.json", subaccount, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ FriendlyName: "AIbooking Dialer" }),
    }),
    twilioFetch("/Applications.json", subaccount, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        FriendlyName: "AIbooking Dialer",
        VoiceUrl: voiceUrl,
        VoiceMethod: "POST",
      }),
    }),
  ]);

  const key = (await keyResponse.json()) as { sid: string; secret: string };
  const app = (await appResponse.json()) as { sid: string };

  const { error: updateError } = await supabase
    .from("twilio_subaccounts")
    .update({
      dialer_api_key_sid: key.sid,
      dialer_api_key_secret: key.secret,
      dialer_twiml_app_sid: app.sid,
    })
    .eq("customer_id", customerId);
  if (updateError) throw updateError;

  return { ...subaccount, apiKeySid: key.sid, apiKeySecret: key.secret, twimlAppSid: app.sid };
}

// Mints a short-lived Twilio Access Token granting browser-side calling via
// the Twilio Voice SDK, scoped to a customer's own dialer TwiML App (see
// getOrCreateDialerApp above) — the counterpart to
// lib/twilio/voice-token.ts's createVoiceAccessToken for the manual dialer.
export function createDialerAccessToken(app: DialerAppCredentials, identity: string): string {
  const token = new AccessToken(app.accountSid, app.apiKeySid, app.apiKeySecret, {
    identity,
    ttl: TOKEN_TTL_SECONDS,
  });
  token.addGrant(new VoiceGrant({ outgoingApplicationSid: app.twimlAppSid, incomingAllow: false }));
  return token.toJwt();
}
