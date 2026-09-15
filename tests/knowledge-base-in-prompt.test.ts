import { describe, it, expect, vi, beforeEach } from "vitest";

// The Prompt Lab now tells customers, in so many words, that their knowledge
// base is joined onto the prompt for every conversation — and that they
// should therefore NOT paste prices and opening hours into the prompt
// themselves. These pin that promise to the code that has to keep it.

const updateVapiAssistantMock = vi.fn(async (..._args: unknown[]) => {});

vi.mock("@/lib/vapi/assistants", () => ({
  updateVapiAssistant: (...args: unknown[]) => updateVapiAssistantMock(...args),
}));

vi.mock("@/lib/settings/platform", () => ({
  getDefaultSystemPrompt: async () => "Du er AI-receptionist.",
}));

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { provider: "vapi" }, error: null }) }),
      }),
    }),
  }),
}));

import { syncWidgetToVapiAssistant } from "@/lib/vapi/sync";
import { formatKnowledgeBaseForPrompt } from "@/lib/knowledge-base/format";
import type { Widget } from "@/types/database";

const WIDGET = {
  id: "w1",
  name: "Reception",
  language: "da",
  system_prompt: "Du er receptionist for Bageren.",
  opening_message: "Hej!",
  llm_model_id: "llm-1",
  booking_enabled: false,
} as unknown as Widget;

function source(label: string, content: string) {
  return { id: label, type: "url" as const, label, content, characterCount: content.length, costSeconds: 0, createdAt: "" };
}

function promptSentToVapi(): string {
  const params = updateVapiAssistantMock.mock.calls.at(-1)![1] as { systemPrompt: string };
  return params.systemPrompt;
}

describe("the knowledge base reaches the agent's prompt", () => {
  beforeEach(() => updateVapiAssistantMock.mockClear());

  it("appends the sources to the customer's own prompt", async () => {
    await syncWidgetToVapiAssistant(WIDGET, {
      vapiAssistantId: "asst_1",
      knowledgeBase: [source("bageren.dk", "Rugbrød koster 45 kr. Åbent 6-17.")],
    });

    const prompt = promptSentToVapi();
    expect(prompt).toContain("Du er receptionist for Bageren.");
    expect(prompt).toContain("Rugbrød koster 45 kr.");
  });

  it("keeps every source, so nothing a customer added is silently dropped", async () => {
    await syncWidgetToVapiAssistant(WIDGET, {
      vapiAssistantId: "asst_1",
      knowledgeBase: [source("priser", "Rugbrød 45 kr."), source("tider", "Åbent 6-17."), source("om-os", "Grundlagt 1993.")],
    });

    const prompt = promptSentToVapi();
    for (const fact of ["Rugbrød 45 kr.", "Åbent 6-17.", "Grundlagt 1993."]) {
      expect(prompt).toContain(fact);
    }
  });

  it("sends the prompt alone when there is no knowledge base, with no empty scaffolding", async () => {
    await syncWidgetToVapiAssistant(WIDGET, { vapiAssistantId: "asst_1", knowledgeBase: [] });

    expect(promptSentToVapi()).toBe("Du er receptionist for Bageren.");
  });

  it("tells the agent not to invent anything beyond those sources", async () => {
    await syncWidgetToVapiAssistant(WIDGET, {
      vapiAssistantId: "asst_1",
      knowledgeBase: [source("bageren.dk", "Rugbrød 45 kr.")],
    });

    expect(promptSentToVapi()).toContain("Opfind ikke information");
  });
});

describe("formatting the knowledge base", () => {
  it("labels each source, so the agent can say where a fact came from", () => {
    const formatted = formatKnowledgeBaseForPrompt([source("bageren.dk/priser", "Rugbrød 45 kr.")]);
    expect(formatted).toContain("### bageren.dk/priser");
  });

  it("caps the total, so one huge source cannot crowd out the instructions", () => {
    const formatted = formatKnowledgeBaseForPrompt([source("stor", "x".repeat(50_000))]);
    expect(formatted!.length).toBeLessThan(21_000);
  });

  it("returns nothing at all for an empty knowledge base", () => {
    expect(formatKnowledgeBaseForPrompt([])).toBeNull();
  });
});
