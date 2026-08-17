import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/database/admin";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Vapi doesn't sign webhook payloads (unlike Stripe) — it echoes back a
// shared secret configured on the assistant's server URL as the
// `x-vapi-secret` header. Compare with a fixed-time check since this is a
// bearer-style credential.
function isValidSecret(received: string | null, expected: string): boolean {
  if (!received) return false;
  const receivedBuf = Buffer.from(received);
  const expectedBuf = Buffer.from(expected);
  if (receivedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(receivedBuf, expectedBuf);
}

// Vapi fires many event types per call (status-update, transcript chunks,
// end-of-call-report, etc.) rather than Stripe's one-shot billing events, so
// unlike app/api/webhooks/stripe/route.ts this isn't an idempotency gate —
// it's just an audit log of raw deliveries (see vapi_events in
// 0011_vapi_model.sql). Nothing here currently drives billing: call
// minutes/credits are tracked through our own usage_sessions via
// POST/PATCH /api/widget/session, same as the OpenAI Realtime path.
export async function POST(request: Request): Promise<NextResponse> {
  const webhookSecret = process.env.VAPI_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 400 });
  }

  const receivedSecret = request.headers.get("x-vapi-secret");
  if (!isValidSecret(receivedSecret, webhookSecret)) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const message = (body as { message?: Record<string, unknown> } | null)?.message;
  if (!message) {
    return NextResponse.json({ error: "Missing message payload" }, { status: 400 });
  }

  const call = message.call as { id?: string } | undefined;
  const supabase = getAdminClient();

  const { error } = await supabase.from("vapi_events").insert({
    call_id: call?.id ?? null,
    type: typeof message.type === "string" ? message.type : null,
    payload: message,
  });

  if (error) {
    console.error("Failed to record vapi event:", error.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
