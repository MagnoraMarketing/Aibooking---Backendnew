import "server-only";
import { jwt } from "twilio";
import { ApiError } from "@/types/errors";

const { AccessToken } = jwt;
const { VoiceGrant } = AccessToken;

const TOKEN_TTL_SECONDS = 3600;

// Mints a short-lived Twilio Access Token (a JWT) granting browser-side
// calling via the Twilio Voice SDK — the widget uses this to place a "call"
// to our platform TwiML Application, which routes into ConversationRelay
// (see app/api/telephony/twilio/voice/relay-start). Uses the official
// `twilio` package rather than hand-rolling this one JWT: unlike the plain
// REST calls elsewhere in lib/twilio (simple, well-documented, safe to
// hand-roll via fetch), VoiceGrant's exact claim shape is Twilio's own
// proprietary format — getting it subtly wrong would silently break every
// browser call, so it's not worth reimplementing.
//
// `identity` only needs to be unique enough to show up in Twilio's call
// logs — it isn't used for authorization on our side (the real customer/
// widget/session binding travels as <Parameter> values, see
// buildConversationRelayResponse in lib/telephony/twiml.ts).
export function createVoiceAccessToken(identity: string): string {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
    throw ApiError.internal(
      "Twilio Voice Relay er ikke konfigureret på platformen endnu (mangler TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET/TWILIO_TWIML_APP_SID i miljøvariablerne)."
    );
  }

  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity,
    ttl: TOKEN_TTL_SECONDS,
  });
  token.addGrant(new VoiceGrant({ outgoingApplicationSid: twimlAppSid, incomingAllow: false }));
  return token.toJwt();
}
