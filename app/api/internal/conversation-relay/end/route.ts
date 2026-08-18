import { NextResponse } from "next/server";
import { requireInternalSecret, readJsonBody, withErrorHandling, internalConversationRelayEndSchema } from "@/lib/security";
import { setUsageSessionDuration, finalizeUsageSession } from "@/lib/usage";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Called by relay-server/ when the ConversationRelay WebSocket closes (call
// ended, either side hung up). `durationSeconds` is measured by
// relay-server's own clock — the connection's actual open-to-close time —
// not a browser timer, satisfying "Usage skal beregnes server-side" the
// same way the Vapi/OpenAI-realtime widget session end already does (see
// app/api/widget/session's PATCH handler).
export const POST = withErrorHandling(async (request) => {
  requireInternalSecret(request);
  const body = await readJsonBody(request, internalConversationRelayEndSchema);

  await setUsageSessionDuration(body.usageSessionId, body.durationSeconds);
  const session = await finalizeUsageSession(body.usageSessionId);

  return NextResponse.json({ sessionId: session.id, billedDurationSeconds: session.billed_duration_seconds });
});
