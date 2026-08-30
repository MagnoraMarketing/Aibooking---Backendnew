import type { LLMMessage } from "./types";
import { languageDirective } from "@/lib/i18n/agent-content";

// Keeping the LLM context small is the single biggest lever on Claude API
// cost. Instead of replaying the full conversation on every turn we keep a
// rolling window of recent messages and fold everything older into a short
// running summary (see summarize() in the provider + /api/widget/message).
export const RECENT_MESSAGE_WINDOW = 8;
export const SUMMARIZE_TRIGGER_MESSAGE_COUNT = 12;

export function shouldSummarize(history: LLMMessage[]): boolean {
  return history.length > SUMMARIZE_TRIGGER_MESSAGE_COUNT;
}

export function messagesToSummarize(history: LLMMessage[]): LLMMessage[] {
  return history.slice(0, Math.max(0, history.length - RECENT_MESSAGE_WINDOW));
}

export function selectRecentMessages(history: LLMMessage[]): LLMMessage[] {
  return history.slice(-RECENT_MESSAGE_WINDOW);
}

const DEFAULT_SYSTEM_PROMPT =
  "Du er en hjælpsom AI-assistent for virksomheden. Hjælp besøgende, besvar spørgsmål og hjælp med at skabe bookinger. Tal naturligt og kortfattet.";

export function buildSystemPrompt(params: {
  basePrompt: string | null;
  summary: string | null;
  maxResponseChars: number;
  knowledgeBase?: string | null;
  // Widget's spoken language (see lib/i18n/agent-content.ts) — every
  // default/example prompt here is authored in Danish, so a non-Danish
  // widget needs an explicit instruction or Claude just answers in Danish.
  language?: string | null;
}): string {
  const approxWords = Math.max(10, Math.round(params.maxResponseChars / 6));
  const costControl = [
    `Svar altid kort og naturligt, maks ca. ${approxWords} ord.`,
    "Undgå indledende høflighedsfraser, gentagelser og fyldord.",
    "Hvis du ikke kender svaret, sig det tydeligt i stedet for at opfinde information.",
  ].join(" ");

  const parts = [(params.basePrompt ?? DEFAULT_SYSTEM_PROMPT).trim(), costControl];

  const directive = languageDirective(params.language);
  if (directive) {
    parts.push(directive);
  }

  if (params.knowledgeBase) {
    parts.push(params.knowledgeBase);
  }

  if (params.summary) {
    parts.push(`Resume af samtalen indtil videre:\n${params.summary}`);
  }

  return parts.join("\n\n");
}
