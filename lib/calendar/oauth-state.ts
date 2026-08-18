import "server-only";
import { randomUUID } from "crypto";

// CSRF protection for the Google/Outlook OAuth redirect round-trip: the
// connect route mints a nonce, stores it in an httpOnly cookie, and encodes
// it (plus the widget being connected) into the `state` param it hands to
// the provider. The callback route checks the provider's `state` against
// the cookie before trusting anything else in the request.
export function cookieNameForProvider(provider: "google" | "outlook"): string {
  return `calendar_oauth_state_${provider}`;
}

export function buildOAuthState(widgetId: string): { state: string; nonce: string } {
  const nonce = randomUUID();
  const state = `${nonce}.${widgetId}`;
  return { state, nonce };
}

export function parseOAuthState(state: string, expectedNonce: string): { widgetId: string } | null {
  const separatorIndex = state.indexOf(".");
  if (separatorIndex === -1) return null;
  const nonce = state.slice(0, separatorIndex);
  const widgetId = state.slice(separatorIndex + 1);
  if (!widgetId || nonce !== expectedNonce) return null;
  return { widgetId };
}
