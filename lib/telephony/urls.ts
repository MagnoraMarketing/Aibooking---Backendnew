import "server-only";
import { toTwilioLanguage as resolveTwilioLanguage } from "@/lib/i18n/agent-content";

// A trailing slash on NEXT_PUBLIC_APP_URL would produce "…dk//api/…" here,
// and Twilio signs the exact string it was configured with — so the double
// slash would survive into every signature check and silently 403 every
// webhook. Normalizing once, here, keeps configuration-time and
// validation-time URLs byte-identical whatever the env var looks like.
function normalizeBaseUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/\/+$/, "");
}

function getAppUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  return configured ? normalizeBaseUrl(configured) : "http://localhost:3000";
}

// Called right before handing a webhook URL to Twilio (number purchase and
// BYO import — see lib/phone-numbers/service.ts and
// app/api/customer/phone-numbers/route.ts). Without this the localhost
// fallback above gets registered on a real phone number and every inbound
// call fails at Twilio's end, minutes after the fact, with nothing in our
// own logs to show for it; failing here instead surfaces as a plain
// provisioning error the customer can act on.
export function assertTwilioWebhookBaseUrlConfigured(): void {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) {
    throw new Error("NEXT_PUBLIC_APP_URL er ikke konfigureret — Twilio kan ikke kalde vores webhooks.");
  }

  const base = normalizeBaseUrl(configured);
  if (!/^https:\/\//i.test(base) || /^https:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(base)) {
    throw new Error(
      `NEXT_PUBLIC_APP_URL (${base}) skal være en offentligt tilgængelig https-adresse, før et nummer kan tage imod opkald.`
    );
  }
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
// bare locale code this app stores on widgets.language — see
// lib/i18n/agent-content.ts for the full 5-language mapping.
export function toTwilioLanguage(widgetLanguage: string): string {
  return resolveTwilioLanguage(widgetLanguage);
}
