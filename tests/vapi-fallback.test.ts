import { describe, it, expect, vi, beforeEach } from "vitest";
import { FallbackProvider } from "@/lib/llm/fallback-provider";
import type { LLMProvider } from "@/lib/llm/types";

function provider(generateReply: LLMProvider["generateReply"]): LLMProvider {
  return { name: "test", generateReply, summarize: vi.fn() };
}

describe("FallbackProvider", () => {
  const baseParams = { model: "primary-model", systemPrompt: "sys", maxTokens: 100, messages: [] };

  it("returns the primary's result when it succeeds, without touching the secondary", async () => {
    const secondaryGenerate = vi.fn();
    const fb = new FallbackProvider(
      provider(async () => ({ content: "from primary", inputTokens: 1, outputTokens: 1 })),
      provider(secondaryGenerate)
    );

    const result = await fb.generateReply(baseParams);

    expect(result.content).toBe("from primary");
    expect(secondaryGenerate).not.toHaveBeenCalled();
  });

  it("falls back to the secondary when the primary throws", async () => {
    const secondaryGenerate = vi.fn(async () => ({ content: "from secondary", inputTokens: 2, outputTokens: 2 }));
    const fb = new FallbackProvider(
      provider(async () => {
        throw new Error("out of credits");
      }),
      provider(secondaryGenerate)
    );

    const result = await fb.generateReply(baseParams);

    expect(result.content).toBe("from secondary");
    // No secondaryModel configured (VapiChatProvider resolves its own
    // assistant id) — params carry over as-is.
    expect(secondaryGenerate).toHaveBeenCalledWith(expect.objectContaining({ model: "primary-model" }));
  });

  it("overrides the model for a secondary that does take one", async () => {
    const secondaryGenerate = vi.fn(async () => ({ content: "from secondary", inputTokens: 2, outputTokens: 2 }));
    const fb = new FallbackProvider(
      provider(async () => {
        throw new Error("out of credits");
      }),
      provider(secondaryGenerate),
      "secondary-model"
    );

    await fb.generateReply(baseParams);

    expect(secondaryGenerate).toHaveBeenCalledWith(expect.objectContaining({ model: "secondary-model" }));
  });

  it("surfaces the primary's error when the secondary also fails", async () => {
    const primaryErr = new Error("primary: out of credits");
    const fb = new FallbackProvider(
      provider(async () => {
        throw primaryErr;
      }),
      provider(async () => {
        throw new Error("secondary: not configured");
      })
    );

    await expect(fb.generateReply(baseParams)).rejects.toBe(primaryErr);
  });
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/settings/platform", () => ({
  getVapiPromptDraftingAssistantId: vi.fn(async () => "assistant-1"),
}));

describe("VapiChatProvider", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.VAPI_PRIVATE_KEY = "test-key";
  });

  it("posts the combined system prompt + messages as a single input string", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ output: [{ content: [{ text: " Draft prompt " }] }], usage: { prompt_tokens: 5, completion_tokens: 7 } }), {
        status: 200,
      })
    );

    const { VapiChatProvider } = await import("@/lib/llm/vapi-provider");
    const result = await new VapiChatProvider().generateReply({
      model: "unused",
      systemPrompt: "Skriv en prompt",
      maxTokens: 500,
      messages: [{ role: "user", content: "Frisør i Aarhus" }],
    });

    expect(result.content).toBe("Draft prompt");
    expect(result.inputTokens).toBe(5);
    expect(result.outputTokens).toBe(7);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/chat/responses");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.assistantId).toBe("assistant-1");
    expect(body.input).toContain("Skriv en prompt");
    expect(body.input).toContain("Frisør i Aarhus");
  });

  it("throws when Vapi returns no text content", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ output: [{ content: [] }] }), { status: 200 }));

    const { VapiChatProvider } = await import("@/lib/llm/vapi-provider");
    await expect(
      new VapiChatProvider().generateReply({ model: "unused", systemPrompt: "sys", maxTokens: 10, messages: [] })
    ).rejects.toThrow();
  });
});
