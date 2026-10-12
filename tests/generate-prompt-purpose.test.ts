import { describe, it, expect, vi, beforeEach } from "vitest";

const generateReplyMock = vi.fn(async (_params: unknown) => ({ content: "draft" }));

let extra: Record<string, unknown>;

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
              return { data: { extra }, error: null };
            }
            throw new Error(`unexpected table ${table}`);
          },
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/llm", () => ({
  resolveLLMProviderWithFallback: () => ({ generateReply: (params: unknown) => generateReplyMock(params) }),
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

function metaSystemPrompt(): string {
  const params = generateReplyMock.mock.calls.at(-1)![0] as { systemPrompt: string };
  return params.systemPrompt;
}

function userMessage(): string {
  const params = generateReplyMock.mock.calls.at(-1)![0] as { messages: { content: string }[] };
  return params.messages[0]!.content;
}

describe("prompt generation adapts to the agent purposes picked in step 1", () => {
  beforeEach(() => {
    generateReplyMock.mockClear();
    extra = {};
  });

  it("keeps the original purpose-agnostic wording when nothing was picked", async () => {
    await POST(makeRequest({ businessDescription: "Bageri" }), { params: { id: "w1" } });

    expect(metaSystemPrompt()).toContain("spørgsmål og bookinger");
  });

  it("writes a booking-focused instruction when 'booking' is picked", async () => {
    extra = { agentPurposes: ["booking"] };

    await POST(makeRequest({ businessDescription: "Frisør" }), { params: { id: "w1" } });

    expect(metaSystemPrompt()).toContain("booke/aftale tider");
  });

  it("writes a Shopify-focused instruction when 'shopify' is picked", async () => {
    extra = { agentPurposes: ["shopify"] };

    await POST(makeRequest({ businessDescription: "Webshop" }), { params: { id: "w1" } });

    expect(metaSystemPrompt()).toContain("webshop");
  });

  it("forbids booking/purchases when only 'qa' is picked", async () => {
    extra = { agentPurposes: ["qa"] };

    await POST(makeRequest({ businessDescription: "Info-side" }), { params: { id: "w1" } });

    expect(metaSystemPrompt()).toContain("ALDRIG tilbyde at booke");
  });

  it("combines instructions when multiple purposes are picked", async () => {
    extra = { agentPurposes: ["booking", "shopify"] };

    await POST(makeRequest({ businessDescription: "Salon med webshop" }), { params: { id: "w1" } });

    const prompt = metaSystemPrompt();
    expect(prompt).toContain("booke/aftale tider");
    expect(prompt).toContain("webshop");
  });

  it("passes the step-1 notes field into the drafting request", async () => {
    extra = { agentPurposes: ["qa"], purposeNotes: "Nævn aldrig konkurrenten." };

    await POST(makeRequest({ businessDescription: "Info-side" }), { params: { id: "w1" } });

    expect(userMessage()).toContain("Nævn aldrig konkurrenten.");
  });
});
