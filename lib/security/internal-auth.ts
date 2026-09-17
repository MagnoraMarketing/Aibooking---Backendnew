import "server-only";
import { timingSafeEqual } from "crypto";
import { ApiError } from "@/types/errors";

const INTERNAL_SECRET_HEADER = "x-internal-secret";

// Guards the internal conversation-relay endpoints (app/api/internal/...) —
// these run real customer/widget lookups and cost money to call (LLM
// tokens), so unlike public endpoints they must never be reachable by an
// arbitrary caller on the internet. Only relay-server/ (the standalone
// ConversationRelay WebSocket service, deliberately outside Vercel) knows
// this secret. Not a Twilio-signed request — relay-server is our own code,
// not Twilio, so lib/twilio/signature.ts's scheme doesn't apply here.
export function requireInternalSecret(request: Request): void {
  requireSecretHeader(
    request,
    process.env.CONVERSATION_RELAY_INTERNAL_SECRET,
    "Conversation Relay er ikke konfigureret på platformen endnu (mangler CONVERSATION_RELAY_INTERNAL_SECRET)."
  );
}

// The outbound dialer, called once a minute by pg_cron from inside the
// database (see 0040_outbound_dialer_schedule.sql). A separate secret from
// the relay's: they are different callers, and this one places calls that
// cost money, so a leak of one must not hand over the other.
export function requireDialerSecret(request: Request): void {
  requireSecretHeader(
    request,
    process.env.OUTBOUND_DIALER_SECRET,
    "Den udgående dialer er ikke konfigureret på platformen endnu (mangler OUTBOUND_DIALER_SECRET)."
  );
}

function requireSecretHeader(request: Request, expected: string | undefined, missingMessage: string): void {
  if (!expected) {
    throw ApiError.internal(missingMessage);
  }

  const provided = request.headers.get(INTERNAL_SECRET_HEADER) ?? "";
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  const valid = expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
  if (!valid) throw ApiError.unauthorized("Invalid internal secret");
}
