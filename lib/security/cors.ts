import "server-only";
import { NextResponse } from "next/server";

// The /api/widget/* endpoints are the only ones a browser calls from a
// domain that isn't ours: public/widget.js runs inside the customer's own
// website and fetches this origin cross-origin. Without these headers the
// browser blocks every one of those responses, so a pasted embed snippet
// renders nothing on a real site even though the exact same widget works
// on our share URL and in the dashboard's Test Agent tab (both same-origin).
//
// Allow-Origin is "*" deliberately: these endpoints are public by design
// (a widget's public_id is the only credential, see lib/widgets/lookup.ts)
// and must work on any customer domain without us maintaining an allowlist.
// Nothing here is cookie-authenticated, so credentials stay off — with "*"
// the browser would reject a credentialed response anyway.
const PUBLIC_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  // Responses vary by Origin even with "*", and /api/widget/config is the
  // kind of GET a CDN would happily cache — keep caches from serving one
  // site's preflight-shaped response to another.
  Vary: "Origin",
};

export function applyPublicCors<T extends Response>(response: T): T {
  for (const [key, value] of Object.entries(PUBLIC_CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

type RouteHandler = (request: Request, context: { params: Record<string, string> }) => Promise<NextResponse>;

// Wrap OUTSIDE withErrorHandling — error responses need the CORS headers
// just as much as successful ones, or the browser hides a real 402 "no
// minutes remaining" behind an opaque network error.
export function withPublicCors(handler: RouteHandler): RouteHandler {
  return async (request, context) => applyPublicCors(await handler(request, context));
}

// Preflight for the POST/PATCH calls that carry Content-Type: application/json.
export function corsPreflight(): Promise<NextResponse> {
  return Promise.resolve(applyPublicCors(new NextResponse(null, { status: 204 })));
}
