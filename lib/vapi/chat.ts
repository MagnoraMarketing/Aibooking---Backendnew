import "server-only";
import { vapiFetch } from "./client";
import { ApiError } from "@/types/errors";

// Vapi's OpenAI-"Responses"-API-compatible endpoint (not the classic Chat
// Completions shape: input is a single string, not a messages array, and
// the reply comes back under output[0], not choices[0].message). It always
// routes through a persisted Vapi assistant — Vapi has no bare
// "just complete this text" endpoint — so the caller must already have an
// assistant built in the Vapi dashboard (see
// getVapiPromptDraftingAssistantId in lib/settings/platform.ts).
// https://docs.vapi.ai/chat/openai-compatibility

interface VapiChatResponse {
  output?: Array<{ content?: Array<{ text?: string }> }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    promptTokens?: number;
    completionTokens?: number;
  };
}

export interface VapiChatResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

export async function draftTextViaVapiAssistant(assistantId: string, input: string): Promise<VapiChatResult> {
  const response = await vapiFetch("/chat/responses", {
    method: "POST",
    body: JSON.stringify({ assistantId, input, stream: false }),
  });

  const data = (await response.json()) as VapiChatResponse;
  const content = data.output?.[0]?.content?.[0]?.text?.trim();
  if (!content) {
    throw ApiError.internal("Vapi-assistenten svarede uden noget tekstindhold.");
  }

  return {
    content,
    inputTokens: data.usage?.prompt_tokens ?? data.usage?.promptTokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? data.usage?.completionTokens ?? 0,
  };
}
