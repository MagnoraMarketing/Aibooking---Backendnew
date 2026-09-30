import "server-only";
import { NextResponse } from "next/server";
import { VAPI_API_BASE, getVapiPrivateKey } from "./client";

// A call's recording, played and downloaded through our own server.
//
// Since July 2026 Vapi's storage is access-controlled: the recordingUrl in
// the end-of-call-report (and on GET /call) is no longer fetchable without
// credentials, so an <audio> pointed straight at it stays at 0:00. The file
// is now reached through GET /call/:id/mono-recording with the private key,
// which answers with a 302 to a short-lived signed URL. That key can never
// reach the browser, so every recording is streamed through here — and every
// request (including each range request while seeking) asks Vapi for a fresh
// signed URL, so a long listen never outlives its link.
//
// Callers check that the call belongs to whoever is asking before calling
// this; this function only fetches.

// The combined mono file, not stereo: stereo puts each speaker on its own
// channel, which plays back as one side of the conversation per ear.
async function signedRecordingUrl(callId: string): Promise<string | null> {
  try {
    const response = await fetch(`${VAPI_API_BASE}/call/${encodeURIComponent(callId)}/mono-recording`, {
      method: "GET",
      headers: { Authorization: `Bearer ${getVapiPrivateKey()}` },
      redirect: "manual",
      cache: "no-store",
    });
    if (response.status >= 300 && response.status < 400) return response.headers.get("location");
    if (response.ok) {
      // Should Vapi ever answer with the link in a body instead of a redirect.
      const body = (await response.json().catch(() => null)) as { url?: unknown } | null;
      return typeof body?.url === "string" ? body.url : null;
    }
    console.error(`Vapi refused the recording for call ${callId} (${response.status}).`);
    return null;
  } catch (err) {
    console.error(`Could not ask Vapi for the recording of call ${callId}:`, String(err));
    return null;
  }
}

const EXTENSION_BY_TYPE: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
};

function extensionFor(contentType: string | null, url: string): string {
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (EXTENSION_BY_TYPE[type]) return EXTENSION_BY_TYPE[type]!;
  const match = /\.([a-z0-9]{2,4})(?:$|\?)/i.exec(new URL(url).pathname);
  return match ? match[1]!.toLowerCase() : "wav";
}

export function recordingFileName(callId: string, startedAt: string | null, extension: string): string {
  const day = startedAt ? startedAt.slice(0, 10) : "samtale";
  return `optagelse-${day}-${callId.slice(0, 8)}.${extension}`;
}

// The HTTP answer for a recording: streamed with the browser's Range header
// passed through (so the player can seek), or as a file download when
// `download` is set. `fallbackUrl` is the URL stored in the report, tried
// only when Vapi's authenticated endpoint has nothing — it still works for
// recordings kept in custom storage.
export async function recordingResponse(
  request: Request,
  params: { callId: string; startedAt?: string | null; fallbackUrl?: string | null; download?: boolean }
): Promise<NextResponse> {
  const url = (await signedRecordingUrl(params.callId)) ?? params.fallbackUrl ?? null;
  if (!url) {
    return NextResponse.json({ error: { message: "Der er ingen optagelse af denne samtale." } }, { status: 404 });
  }

  const range = request.headers.get("range");
  const upstream = await fetch(url, {
    headers: range && !params.download ? { Range: range } : {},
    cache: "no-store",
  }).catch(() => null);
  if (!upstream || (!upstream.ok && upstream.status !== 206) || !upstream.body) {
    console.error(`Recording for call ${params.callId} could not be fetched (${upstream?.status ?? "network error"}).`);
    return NextResponse.json({ error: { message: "Optagelsen kunne ikke hentes lige nu." } }, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "audio/wav";
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
  });
  for (const name of ["content-length", "content-range"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  const fileName = recordingFileName(params.callId, params.startedAt ?? null, extensionFor(contentType, url));
  headers.set("Content-Disposition", `${params.download ? "attachment" : "inline"}; filename="${fileName}"`);

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
