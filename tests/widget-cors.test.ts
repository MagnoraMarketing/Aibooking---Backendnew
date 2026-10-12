import { describe, it, expect } from "vitest";
import { NextResponse } from "next/server";
import { applyPublicCors, corsPreflight, withPublicCors } from "@/lib/security/cors";
import { widgetSessionEndSchema } from "@/lib/security/schemas";
import { errorResponse } from "@/lib/security/http";
import { ApiError } from "@/types/errors";

// public/widget.js runs on the customer's own domain and calls this origin
// cross-origin — without these headers the browser blocks every response and
// a pasted embed snippet renders nothing on a real website.
describe("public widget CORS", () => {
  it("allows any origin on a widget response", () => {
    const res = applyPublicCors(NextResponse.json({ ok: true }));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("answers the preflight with the methods and headers widget.js uses", async () => {
    const res = await corsPreflight();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("PATCH");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
  });

  // A 402 "no minutes remaining" the browser turns into an opaque network
  // error is indistinguishable from a broken widget, so error responses need
  // the headers too — hence withPublicCors wrapping withErrorHandling.
  it("keeps the headers on an error response", async () => {
    const handler = withPublicCors(async () => errorResponse(ApiError.paymentRequired("No minutes")));
    const res = await handler(new Request("https://example.com"), { params: {} });
    expect(res.status).toBe(402);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("session-end beacon payload", () => {
  it("accepts the bare {sessionId} the text widget beacons on unload", () => {
    const result = widgetSessionEndSchema.safeParse({ sessionId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" });
    expect(result.success).toBe(true);
  });

  it("accepts the client-measured duration the voice widgets report", () => {
    const result = widgetSessionEndSchema.safeParse({
      sessionId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      clientMeasuredDurationSeconds: 42.5,
    });
    expect(result.success).toBe(true);
  });
});
