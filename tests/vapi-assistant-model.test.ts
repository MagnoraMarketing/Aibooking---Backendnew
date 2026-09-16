import { describe, it, expect, vi, beforeEach } from "vitest";

// The customer has no model picker (see components/dashboard/agent-tabs/
// settings-tab.tsx): a widget agent runs on whatever model the master admin
// configured on the Vapi template assistant, the same place its voice is
// cloned from. These tests pin that the template's engine actually reaches
// the assistant — and that the customer's own prompt and tools survive it.

const vapiFetchMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(new Response("{}")));
vi.mock("@/lib/vapi/client", () => ({
  vapiFetch: (...args: unknown[]) => vapiFetchMock(...args),
}));

const templateIdMock = vi.fn(async (_gender: string): Promise<string | null> => "tmpl_female");
vi.mock("@/lib/settings/platform", () => ({
  getVapiVoiceTemplateAssistantId: (gender: string) => templateIdMock(gender),
}));

import { createVapiAssistant, updateVapiAssistant } from "@/lib/vapi/assistants";

const PARAMS = { name: "Agent", systemPrompt: "prompt", firstMessage: "hej", voiceGender: "female" as const };

function templateResponse(assistant: unknown) {
  return new Response(JSON.stringify(assistant));
}

function bodyOf(callIndex: number): Record<string, unknown> {
  const init = vapiFetchMock.mock.calls[callIndex]![1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  vapiFetchMock.mockReset().mockResolvedValue(new Response("{}"));
  templateIdMock.mockReset().mockResolvedValue("tmpl_female");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the model a widget assistant runs on", () => {
  it("comes from the Vapi template assistant, not from a value we picked", async () => {
    vapiFetchMock.mockResolvedValueOnce(
      templateResponse({
        voice: { provider: "11labs", voiceId: "Ida" },
        model: { provider: "openai", model: "gpt-4o-mini", temperature: 0.4, messages: [{ role: "system", content: "admin template prompt" }] },
      })
    );

    await createVapiAssistant(PARAMS);

    const model = bodyOf(1).model as Record<string, unknown>;
    expect(model.provider).toBe("openai");
    expect(model.model).toBe("gpt-4o-mini");
    expect(model.temperature).toBe(0.4);
  });

  // Cloning the template's `messages` would hand every customer the admin's
  // prompt instead of their own — only the engine is copied.
  it("keeps the widget's own system prompt and tools", async () => {
    vapiFetchMock.mockResolvedValueOnce(
      templateResponse({
        voice: { provider: "11labs", voiceId: "Ida" },
        model: { provider: "openai", model: "gpt-4o-mini", messages: [{ role: "system", content: "admin template prompt" }] },
      })
    );

    await createVapiAssistant(PARAMS, true);

    const model = bodyOf(1).model as { messages: { content: string }[]; tools: unknown[] };
    expect(model.messages).toEqual([{ role: "system", content: "prompt" }]);
    expect(model.tools.length).toBeGreaterThan(0);
  });

  it("falls back to the built-in model when no template is configured", async () => {
    templateIdMock.mockResolvedValue(null);

    await createVapiAssistant(PARAMS);

    const model = bodyOf(0).model as Record<string, unknown>;
    expect(model.provider).toBe("anthropic");
    expect(model.model).toBe("claude-haiku-4-5-20251001");
  });

  it("falls back when the template has no usable model block", async () => {
    vapiFetchMock.mockResolvedValueOnce(templateResponse({ voice: { provider: "11labs", voiceId: "Ida" } }));

    await updateVapiAssistant("asst_1", PARAMS);

    const model = bodyOf(1).model as Record<string, unknown>;
    expect(model.provider).toBe("anthropic");
    expect(model.model).toBe("claude-haiku-4-5-20251001");
  });

  // Voice and model used to be two separate reads of the same assistant.
  it("reads the template once per assistant build", async () => {
    vapiFetchMock.mockResolvedValueOnce(
      templateResponse({ voice: { provider: "11labs", voiceId: "Ida" }, model: { provider: "openai", model: "gpt-4o-mini" } })
    );

    await createVapiAssistant(PARAMS);

    const templateReads = vapiFetchMock.mock.calls.filter((call) => String(call[0]).includes("tmpl_female"));
    expect(templateReads).toHaveLength(1);
    expect(bodyOf(1).voice).toEqual({ provider: "11labs", voiceId: "Ida" });
  });
});

// A customer's prompt describes a receptionist who takes appointments; the
// tool list decides whether it can. Those come apart the moment no calendar
// is connected, and a real test call showed what that costs: the agent
// confirmed a haircut for 14:00, read the caller's number back, wished them
// well — and booked nothing, because there was nowhere to book it.
describe("an agent that has no calendar", () => {
  // A single shared Response can only be read once, and these tests let the
  // template fetch fall through to it — so hand out a fresh one per call.
  beforeEach(() => {
    vapiFetchMock.mockImplementation(() => Promise.resolve(new Response("{}")));
  });

  const systemMessage = (callIndex: number) => {
    const model = bodyOf(callIndex).model as { messages: { role: string; content: string }[] };
    return model.messages[0]!.content;
  };

  it("is told it cannot book, in its own language", async () => {
    await createVapiAssistant({ ...PARAMS, language: "da" });

    expect(systemMessage(1)).toContain("prompt");
    expect(systemMessage(1)).toContain("Du kan ikke booke");
    expect(systemMessage(1)).toMatch(/Bekræft aldrig et tidspunkt/);
  });

  it("says it in English for an English agent", async () => {
    await createVapiAssistant({ ...PARAMS, language: "en" });

    expect(systemMessage(1)).toContain("You cannot book");
  });

  it("carries no booking tools either way", async () => {
    await createVapiAssistant(PARAMS);

    const model = bodyOf(1).model as { tools: unknown[] };
    expect(model.tools).toEqual([]);
  });

  // The directive is about a missing capability, not a missing calendar
  // connection in general — an agent that CAN book must never be told it
  // cannot, or it would refuse callers while holding a working calendar.
  it("is never added to an agent that does have the tools", async () => {
    await createVapiAssistant({ ...PARAMS, language: "da" }, true);

    expect(systemMessage(1)).toBe("prompt");
    expect((bodyOf(1).model as { tools: unknown[] }).tools.length).toBeGreaterThan(0);
  });

  it("reaches an existing assistant through an update too", async () => {
    await updateVapiAssistant("asst_1", { ...PARAMS, language: "da" });

    expect(systemMessage(1)).toContain("Du kan ikke booke");
  });
});
