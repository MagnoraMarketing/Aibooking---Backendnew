import "server-only";

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

// The fixed set of webhook URLs Twilio is configured to call (see
// lib/twilio/numbers.ts's configureDirectVoiceWebhook and
// lib/twilio/calls.ts's createTwilioOutboundCall) — every route validating
// a Twilio request signature needs the exact same string it was signed
// against, so this is the single source of truth for all of them.
export function twilioWebhookUrls() {
  const base = getAppUrl();
  return {
    inbound: `${base}/api/telephony/twilio/voice/inbound`,
    turn: `${base}/api/telephony/twilio/voice/turn`,
    status: `${base}/api/telephony/twilio/voice/status`,
    outboundStart: `${base}/api/telephony/twilio/voice/outbound-start`,
    audioBase: `${base}/api/telephony/twilio/audio`,
    // The platform TwiML Application's Voice Request URL (see
    // lib/twilio/voice-token.ts) — Twilio hits this when the browser Voice
    // SDK places its call, not tied to any customer subaccount/number.
    relayStart: `${base}/api/telephony/twilio/voice/relay-start`,
    // The manual dialer's per-customer TwiML Application Voice Request URL
    // (see lib/twilio/dialer.ts) — unlike relayStart, this one is scoped to
    // a customer's own subaccount, so a `?customerId=` query string is
    // appended by callers to identify which subaccount's credentials to
    // validate the request signature against.
    dialerStart: `${base}/api/telephony/twilio/voice/dialer-start`,
    dialerStatus: `${base}/api/telephony/twilio/voice/dialer-status`,
  };
}

// The standalone ConversationRelay WebSocket relay (relay-server/), which
// deliberately does NOT run on Vercel — Twilio needs the connection to stay
// open for the whole call, and Vercel serverless functions can't hold one
// open that long. Returns null (rather than a default) when unconfigured,
// so callers fail loudly instead of building TwiML that points nowhere.
export function conversationRelayWebSocketUrl(): string | null {
  return process.env.CONVERSATION_RELAY_WS_URL ?? null;
}

// Twilio's <Say>/<Gather> `language` attribute wants a BCP-47 tag, not the
// bare two-letter codes this app stores on widgets.language.
export function toTwilioLanguage(widgetLanguage: string): string {
  return widgetLanguage === "en" ? "en-US" : "da-DK";
}
