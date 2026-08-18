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
  };
}

// Twilio's <Say>/<Gather> `language` attribute wants a BCP-47 tag, not the
// bare two-letter codes this app stores on widgets.language.
export function toTwilioLanguage(widgetLanguage: string): string {
  return widgetLanguage === "en" ? "en-US" : "da-DK";
}
