import "server-only";
import { jwt } from "twilio";
import { getAdminClient } from "@/lib/database/admin";
import { assertTwilioWebhookBaseUrlConfigured, twilioWebhookUrls } from "@/lib/telephony/urls";
import { twilioFetch, type TwilioCredentials } from "./client";
import { getOrCreateSubaccount } from "./subaccounts";
import { ApiError } from "@/types/errors";

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
// customer's own subaccount/number. Cached on twilio_subaccounts, mirroring
// getOrCreateSubaccount's own shape; a rare double-provision race just
// leaves an extra unused Key/Application behind on Twilio's side, harmless
// and not worth guarding against.
//
// The cached pair is re-checked on every token mint rather than trusted
// blindly. The Application's Voice Request URL is baked in at creation, so
// a first dialer use while NEXT_PUBLIC_APP_URL still pointed somewhere else
// (a preview deploy, localhost, a trailing slash) left every later call
// dialing a URL that answers nothing or fails the signature check — the
// browser just rang out with no error on our side. Re-asserting the URL
// fixes that on the next token, and a Key or Application deleted in the
// Twilio console (404) is provisioned again instead of producing tokens
// Twilio rejects.
export async function getOrCreateDialerApp(customerId: string): Promise<DialerAppCredentials> {
  // Surfaced as-is in the dialer: without a public https base URL Twilio
  // has nowhere to fetch dialer-start from, and "Something went wrong"
  // would hide the one thing the admin needs to change.
  try {
    assertTwilioWebhookBaseUrlConfigured();
  } catch (err) {
    throw ApiError.internal(err instanceof Error ? err.message : String(err));
  }

  const subaccount = await getOrCreateSubaccount(customerId);
  const supabase = getAdminClient();
  const voiceUrl = `${twilioWebhookUrls().dialerStart}?customerId=${encodeURIComponent(customerId)}`;

  const { data: existing, error } = await supabase
    .from("twilio_subaccounts")
    .select("dialer_api_key_sid, dialer_api_key_secret, dialer_twiml_app_sid")
    .eq("customer_id", customerId)
    .single();
  if (error) throw error;

  if (existing.dialer_api_key_sid && existing.dialer_api_key_secret && existing.dialer_twiml_app_sid) {
    const [keyResponse, appResponse] = await Promise.all([
      twilioFetch(`/Keys/${existing.dialer_api_key_sid}.json`, subaccount, {}, { acceptStatuses: [404] }),
      twilioFetch(
        `/Applications/${existing.dialer_twiml_app_sid}.json`,
        subaccount,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ VoiceUrl: voiceUrl, VoiceMethod: "POST" }),
        },
        { acceptStatuses: [404] }
      ),
    ]);

    if (keyResponse.ok && appResponse.ok) {
      return {
        ...subaccount,
        apiKeySid: existing.dialer_api_key_sid,
        apiKeySecret: existing.dialer_api_key_secret,
        twimlAppSid: existing.dialer_twiml_app_sid,
      };
    }
  }

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
