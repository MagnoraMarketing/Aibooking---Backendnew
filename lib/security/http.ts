import "server-only";
import { NextResponse } from "next/server";
import type { ZodSchema } from "zod";
import { ApiError } from "@/types/errors";

export const MAX_REQUEST_BODY_BYTES = 100 * 1024; // 100KB — generous for JSON API payloads

export async function readJsonBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_REQUEST_BODY_BYTES) {
    throw ApiError.badRequest("Request body too large");
  }

  const text = await request.text();
  if (text.length > MAX_REQUEST_BODY_BYTES) {
    throw ApiError.badRequest("Request body too large");
  }

  let json: unknown;
  try {
    json = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    throw ApiError.badRequest("Invalid JSON body");
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    throw ApiError.badRequest(`Validation failed: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }

  return result.data;
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }

  // Never leak internal error details (stack traces, DB errors, API key
  // hints) to the client — log server-side only.
  console.error("Unhandled API error:", err);
  return NextResponse.json(
    { error: { code: "internal_error", message: "Something went wrong" } },
    { status: 500 }
  );
}

type RouteHandler = (request: Request, context: { params: Record<string, string> }) => Promise<NextResponse>;

// Wraps a route handler so any thrown ApiError (or unexpected error) is
// converted into a consistent JSON error response instead of crashing.
export function withErrorHandling(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
