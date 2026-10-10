import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Three things the dashboards depend on:
//  - recordings are streamed through us, because Vapi's own links need the
//    private key since July 2026 and never played in a browser;
//  - a customer sees their calls priced at their package's minute price;
//  - every agent hangs up when the customer says goodbye.

vi.mock("@/lib/database/admin", () => ({ getAdminClient: () => ({}) }));

const vapiFetchMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(new Response("{}")));
vi.mock("@/lib/vapi/client", () => ({
  VAPI_API_BASE: "https://api.vapi.ai",
  getVapiPrivateKey: () => "sk_test",
  vapiFetch: (...args: unknown[]) => vapiFetchMock(...args),
}));
vi.mock("@/lib/settings/platform", () => ({
  getVapiVoiceTemplateAssistantId: async () => null,
}));

import { recordingResponse, recordingFileName } from "@/lib/vapi/recording";
import { minutePriceOf, priceCall } from "@/lib/aibooking-dashboard/customer";
import { buildEndCallTool, createVapiAssistant } from "@/lib/vapi/assistants";
import type { DashboardCall } from "@/lib/aibooking-dashboard/calls";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("playing a recording", () => {
  it("asks Vapi's authenticated endpoint for a signed link and streams it, passing Range through", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://signed.example/rec.wav?sig=1" } }))
      .mockResolvedValueOnce(
        new Response("abc", {
          status: 206,
          headers: { "content-type": "audio/wav", "content-length": "3", "content-range": "bytes 0-2/10" },
        })
      );

    const request = new Request("https://app.test/rec", { headers: { range: "bytes=0-2" } });
    const response = await recordingResponse(request, { callId: "call-12345678", startedAt: "2026-09-30T10:00:00Z" });

    const [vapiUrl, vapiInit] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(vapiUrl).toBe("https://api.vapi.ai/call/call-12345678/mono-recording");
    expect((vapiInit.headers as Record<string, string>).Authorization).toBe("Bearer sk_test");
    expect(vapiInit.redirect).toBe("manual");

    const [fileUrl, fileInit] = fetchMock.mock.calls[1]! as [string, RequestInit];
    expect(fileUrl).toBe("https://signed.example/rec.wav?sig=1");
    expect((fileInit.headers as Record<string, string>).Range).toBe("bytes=0-2");

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-2/10");
    expect(response.headers.get("content-disposition")).toContain("inline");
    expect(await response.text()).toBe("abc");
  });

  it("hands the file over as a download when asked", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://signed.example/x" } }))
      .mockResolvedValueOnce(new Response("abc", { status: 200, headers: { "content-type": "audio/mpeg" } }));

    const response = await recordingResponse(new Request("https://app.test/rec"), {
      callId: "call-12345678",
      startedAt: "2026-09-30T10:00:00Z",
      download: true,
    });

    expect(response.headers.get("content-disposition")).toBe('attachment; filename="optagelse-2026-09-30-call-123.mp3"');
  });

  it("falls back to the stored link, and says so plainly when there is nothing", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    const response = await recordingResponse(new Request("https://app.test/rec"), { callId: "call-1" });
    expect(response.status).toBe(404);
  });

  it("names the file after the day and the call", () => {
    expect(recordingFileName("abcdef1234", "2026-09-01T08:00:00Z", "wav")).toBe("optagelse-2026-09-01-abcdef12.wav");
  });
});

describe("what a call costs the customer", () => {
  it("uses the package's minute price, else the monthly price over the included minutes", () => {
    expect(minutePriceOf({ overage_price_per_minute: 6.66, monthly_price: 999, included_minutes: 150 })).toBe(6.66);
    expect(minutePriceOf({ overage_price_per_minute: 0, monthly_price: 2499, included_minutes: 600 })).toBeCloseTo(4.165);
    expect(minutePriceOf(null)).toBe(0);
  });

  it("prices a call by its talk time and never passes Vapi's cost on", () => {
    const call = { durationSeconds: 90, cost: 0.39 } as DashboardCall;
    expect(priceCall(call, 6.66).cost).toBe(9.99);
  });
});

describe("ending the call when the customer says goodbye", () => {
  it("gives every assistant the hang-up tool, without a filler, and tells it when to use it", async () => {
    await createVapiAssistant({ name: "A", systemPrompt: "Du er receptionist.", firstMessage: "Hej", language: "da" });

    const body = JSON.parse(String((vapiFetchMock.mock.calls.at(-1)![1] as RequestInit).body)) as {
      model: { tools: unknown[]; messages: { content: string }[] };
    };
    expect(body.model.tools).toContainEqual(buildEndCallTool());
    expect(buildEndCallTool().messages).toEqual([]);
    expect(body.model.messages[0]!.content).toContain("Sådan afslutter du samtalen");
    expect(body.model.messages[0]!.content).toContain("endCall");
  });
});
