import { describe, it, expect, vi, beforeEach } from "vitest";

const generateReplyMock = vi.fn(async (_params: unknown) => ({ content: "  Du er AI-receptionist for Bageren.  " }));

let knowledgeBase: { id: string; label: string; content: string }[];

vi.mock("@/lib/auth", () => ({
  requireCustomerAdmin: async () => ({ userId: "user-1", profile: { customer_id: "cust-1", role: "CUSTOMER_ADMIN" } }),
}));

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === "widgets") {
              return {
                data: { id: "w1", customer_id: "cust-1", language: "da", name: "Main widget", business_name: "Bageren ApS" },
                error: null,
              };
            }
            if (table === "widget_settings") {
              return { data: { extra: { knowledgeBase } }, error: null };
            }
            throw new Error(`unexpected table ${table}`);
          },
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/llm", () => ({
  resolveLLMProvider: () => ({ generateReply: (params: unknown) => generateReplyMock(params) }),
}));

vi.mock("@/lib/settings/platform", () => ({
  getPromptDraftingModelName: async () => "claude-haiku-4-5-20251001",
}));

import { POST } from "@/app/api/customer/widgets/[id]/generate-prompt/route";

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/customer/widgets/w1/generate-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function userMessage(): string {
  const params = generateReplyMock.mock.calls.at(-1)![0] as { messages: { content: string }[] };
  return params.messages[0]!.content;
}

describe("prompt generation uses the attached knowledge base", () => {
  beforeEach(() => {
    generateReplyMock.mockClear();
    knowledgeBase = [];
  });

  it("writes the draft with the attached sources in view", async () => {
    knowledgeBase = [{ id: "s1", label: "bageren.dk", content: "Vi bager surdejsbrød og laver bryllupskager." }];

    const res = await POST(makeRequest({ businessDescription: "Bageri i Aarhus" }), { params: { id: "w1" } });

    expect(res.status).toBe(200);
    expect(userMessage()).toContain("bageren.dk");
    expect(userMessage()).toContain("surdejsbrød");
  });

  it("tells the model not to copy the knowledge base into the prompt itself", async () => {
    knowledgeBase = [{ id: "s1", label: "bageren.dk", content: "Rugbrød 45 kr." }];

    await POST(makeRequest({ businessDescription: "Bageri" }), { params: { id: "w1" } });

    const params = generateReplyMock.mock.calls.at(-1)![0] as { systemPrompt: string };
    expect(params.systemPrompt).toContain("GENGIV dem ikke");
  });

  it("names the business, so the draft isn't about a nameless company", async () => {
    await POST(makeRequest({ businessDescription: "Bageri" }), { params: { id: "w1" } });

    expect(userMessage()).toContain("Bageren ApS");
  });

  it("works fine with no knowledge base attached", async () => {
    const res = await POST(makeRequest({ businessDescription: "Bageri" }), { params: { id: "w1" } });

    expect(res.status).toBe(200);
    expect(userMessage()).not.toContain("vidensbase");
    expect(await res.json()).toEqual({ systemPrompt: "Du er AI-receptionist for Bageren." });
  });

  it("caps how much of a long source it pastes into the request", async () => {
    knowledgeBase = [{ id: "s1", label: "stor.dk", content: "x".repeat(50_000) }];

    await POST(makeRequest({ businessDescription: "Bageri" }), { params: { id: "w1" } });

    expect(userMessage().length).toBeLessThan(5_000);
  });
});
