import { describe, it, expect } from "vitest";
import { estimateLLMCost } from "@/lib/llm/cost";
import { estimateTTSCost } from "@/lib/tts/cost";
import {
  shouldSummarize,
  messagesToSummarize,
  selectRecentMessages,
  buildSystemPrompt,
  RECENT_MESSAGE_WINDOW,
  SUMMARIZE_TRIGGER_MESSAGE_COUNT,
} from "@/lib/llm/context-builder";
import { generatePublicWidgetId } from "@/lib/widgets/public-id";
import type { LLMMessage } from "@/lib/llm/types";

describe("LLM cost estimation", () => {
  it("computes input+output cost from per-million pricing", () => {
    const cost = estimateLLMCost({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      inputPricePerMillion: 6.5,
      outputPricePerMillion: 32.5,
    });
    expect(cost).toBeCloseTo(39, 5);
  });

  it("is zero for zero tokens", () => {
    expect(estimateLLMCost({ inputTokens: 0, outputTokens: 0, inputPricePerMillion: 10, outputPricePerMillion: 10 })).toBe(0);
  });
});

describe("TTS cost estimation", () => {
  it("scales linearly with characters used", () => {
    const cost100 = estimateTTSCost(100);
    const cost200 = estimateTTSCost(200);
    expect(cost200).toBeCloseTo(cost100 * 2, 5);
  });
});

describe("conversation context window (cost control)", () => {
  function messages(count: number): LLMMessage[] {
    return Array.from({ length: count }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`,
    }));
  }

  it("does not trigger summarization under the threshold", () => {
    expect(shouldSummarize(messages(SUMMARIZE_TRIGGER_MESSAGE_COUNT))).toBe(false);
  });

  it("triggers summarization once history exceeds the threshold", () => {
    expect(shouldSummarize(messages(SUMMARIZE_TRIGGER_MESSAGE_COUNT + 1))).toBe(true);
  });

  it("keeps only the recent window verbatim, folding the rest into the summary batch", () => {
    const history = messages(20);
    const recent = selectRecentMessages(history);
    const toSummarize = messagesToSummarize(history);

    expect(recent).toHaveLength(RECENT_MESSAGE_WINDOW);
    expect(toSummarize).toHaveLength(20 - RECENT_MESSAGE_WINDOW);
    expect(recent[0]).toEqual(history[history.length - RECENT_MESSAGE_WINDOW]);
  });

  it("includes the running summary in the system prompt when present", () => {
    const prompt = buildSystemPrompt({
      basePrompt: "Du er en assistent.",
      summary: "Kunden hedder Jens og vil booke tid tirsdag.",
      maxResponseChars: 400,
    });
    expect(prompt).toContain("Jens");
    expect(prompt).toContain("kort");
  });
});

describe("widget public ids", () => {
  it("generates ids that never leak into a predictable internal format", () => {
    const id = generatePublicWidgetId();
    expect(id).toMatch(/^[0-9a-zA-Z]{14}$/);
  });

  it("generates unique ids across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generatePublicWidgetId()));
    expect(ids.size).toBe(1000);
  });
});
