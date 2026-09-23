import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// OpenAI retired the beta Realtime endpoints (POST /v1/realtime/sessions → 404
// "Invalid URL"), which broke every realtime voice widget. These tests pin the
// GA wire format, because api.openai.com isn't reachable from CI.

import { createRealtimeClientSecret, toGaRealtimeModel } from "@/lib/realtime/openai-realtime";

const fetchMock = vi.fn();
const originalFetch = global.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test";
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("createRealtimeClientSecret", () => {
  it("mints the key via the GA client_secrets endpoint with a nested session config", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ value: "ek_123", expires_at: 1790000000, session: {} }));

    const res = await createRealtimeClientSecret({ model: "gpt-realtime", instructions: "Be helpful" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect((init as RequestInit).method).toBe("POST");
    expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.session.type).toBe("realtime");
    expect(body.session.model).toBe("gpt-realtime");
    expect(body.session.instructions).toBe("Be helpful");
    expect(body.session.audio.output.voice).toBe("alloy");
    expect(body.modalities).toBeUndefined();
    expect(res).toEqual({ clientSecret: "ek_123", expiresAt: 1790000000, model: "gpt-realtime", voice: "alloy" });
  });

  it("maps retired preview models to their GA successor", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ value: "ek_1" }));
    const res = await createRealtimeClientSecret({ model: "gpt-4o-realtime-preview-2024-12-17", instructions: "x" });
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).session.model).toBe("gpt-realtime");
    expect(res.model).toBe("gpt-realtime");
    expect(toGaRealtimeModel("gpt-4o-mini-realtime-preview")).toBe("gpt-realtime-mini");
    expect(toGaRealtimeModel("")).toBe("gpt-realtime");
    expect(toGaRealtimeModel("gpt-realtime-mini")).toBe("gpt-realtime-mini");
  });

  it("surfaces OpenAI's error body", async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":{"message":"bad"}}', { status: 400 }));
    await expect(createRealtimeClientSecret({ model: "gpt-realtime", instructions: "x" })).rejects.toThrow(/400/);
  });
});
