import { NextResponse } from "next/server";
import {
  readJsonBody,
  withErrorHandling,
  rateLimit,
  getClientIp,
  widgetSessionEndSchema,
  withPublicCors,
  corsPreflight,
} from "@/lib/security";
import { finalizeUsageSession, setUsageSessionDuration } from "@/lib/usage";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Same job as PATCH /api/widget/session, but shaped for navigator.sendBeacon,
// which the widget uses when the visitor closes the tab mid-conversation.
// sendBeacon can only issue a POST, and a beacon body typed
// application/json would need a CORS preflight that an unloading page has
// no chance to complete — so this route exists as a POST that accepts a
// text/plain body (a CORS-safelisted content type, no preflight), and
// readJsonBody parses the text regardless of the declared type.
//
// Without this, a text-chat session was never finalized on unload: its
// minutes were never deducted from the credit ledger and its conversation
// stayed "active" forever. finalizeUsageSession is idempotent (it returns
// early once ended_at is set), so a beacon racing a normal end is harmless.
export const POST = withPublicCors(
  withErrorHandling(async (request) => {
    const ip = getClientIp(request.headers);
    const { allowed } = rateLimit(`widget-session-end:${ip}`, { limit: 40, windowMs: 60_000 });
    if (!allowed) throw ApiError.tooManyRequests();

    const body = await readJsonBody(request, widgetSessionEndSchema);

    if (body.clientMeasuredDurationSeconds !== undefined) {
      await setUsageSessionDuration(body.sessionId, body.clientMeasuredDurationSeconds);
    }

    const session = await finalizeUsageSession(body.sessionId);

    return NextResponse.json({
      sessionId: session.id,
      billedDurationSeconds: session.billed_duration_seconds,
    });
  })
);

export const OPTIONS = () => corsPreflight();
