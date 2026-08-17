import { NextResponse } from "next/server";
import type { Vapi } from "@vapi-ai/server-sdk";
import { verifyVapiWebhookSecret, handleVapiServerMessage } from "@/lib/vapi";
import { MAX_REQUEST_BODY_BYTES } from "@/lib/security/http";

// Every route here is per-request — never statically optimized/cached.
export const dynamic = "force-dynamic";

// Vapi's server webhook: one POST per call-lifecycle event
// (status-update, end-of-call-report, transcript, ...), body shaped as
// { message: { type, ... } }. Auth is a shared secret embedded as a query
// param on the URL we registered with Vapi (see lib/vapi/mapping.ts) rather
// than an HMAC signature or header — Vapi's assistant.server config has no
// secret/signature field to verify against.
export async function POST(request: Request): Promise<NextResponse> {
  const secret = new URL(request.url).searchParams.get("secret");
  if (!verifyVapiWebhookSecret(secret)) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_REQUEST_BODY_BYTES * 20) {
    // Transcripts/artifacts can be sizeable — allow a generous ceiling
    // (2MB) well above a normal JSON API payload, still bounded.
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let body: { message?: Vapi.ServerMessageMessage };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.message) {
    return NextResponse.json({ error: "Missing message" }, { status: 400 });
  }

  try {
    await handleVapiServerMessage(body.message);
  } catch (err) {
    // Never leak internals to Vapi's retry logs; log server-side and let
    // them retry the delivery.
    console.error("Failed to process Vapi webhook message:", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
