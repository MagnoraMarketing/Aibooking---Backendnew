import "server-only";
import { getVapiPromptDraftingAssistantId } from "@/lib/settings/platform";
import { draftTextViaVapiAssistant } from "@/lib/vapi/chat";
import { ApiError } from "@/types/errors";
import type {
  LLMGenerateParams,
  LLMGenerateResult,
  LLMProvider,
  LLMSummarizeParams,
  LLMSummarizeResult,
} from "./types";

// Routes text generation through a master-admin-configured Vapi assistant
// (see getVapiPromptDraftingAssistantId) instead of talking to an LLM vendor
// directly — used as the fallback leg of FallbackProvider so that whichever
// model the admin has wired up in Vapi's own dashboard (their own account,
// their own credits) can stand in when Anthropic fails. Vapi's Chat API
// takes a single `input` string per assistant, not a separate system
// prompt + message list, so both are folded together here; this provider
// exists purely to draft one-off text (Prompt Lab), not to run a
// multi-turn conversation.
async function draft(systemPrompt: string | undefined, userContent: string): Promise<LLMGenerateResult> {
  const assistantId = await getVapiPromptDraftingAssistantId();
  if (!assistantId) {
    throw ApiError.internal(
      "Vapi-fallback for prompt-generering er ikke konfigureret (sæt 'Prompt-udkast Vapi Assistant ID' under Admin → Indstillinger)."
    );
  }

  const input = [systemPrompt, userContent].filter(Boolean).join("\n\n");
  const result = await draftTextViaVapiAssistant(assistantId, input);
  return { content: result.content, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
}

export class VapiChatProvider implements LLMProvider {
  readonly name = "vapi";

  async generateReply(params: LLMGenerateParams): Promise<LLMGenerateResult> {
    const userContent = params.messages.map((m) => m.content).join("\n\n");
    return draft(params.systemPrompt, userContent);
  }

  async summarize(params: LLMSummarizeParams): Promise<LLMSummarizeResult> {
    const transcript = params.messages
      .map((m) => `${m.role === "user" ? "Bruger" : "Assistent"}: ${m.content}`)
      .join("\n");

    const prompt = params.existingSummary
      ? `Eksisterende resume af samtalen indtil videre:\n${params.existingSummary}\n\nOpdater resumeet med denne nye del af samtalen. Hold det kort (maks 5 sætninger) og bevar kun fakta der er relevante for at fortsætte samtalen (kundens behov, aftaler, navn, kontaktinfo, beslutninger).\n\nNy del af samtalen:\n${transcript}`
      : `Lav et kort resume (maks 5 sætninger) af denne samtale. Bevar kun fakta der er relevante for at fortsætte samtalen (kundens behov, aftaler, navn, kontaktinfo, beslutninger).\n\nSamtale:\n${transcript}`;

    const result = await draft(undefined, prompt);
    return { summary: result.content, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  }
}
