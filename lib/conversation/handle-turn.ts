import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import {
  resolveLLMProvider,
  estimateLLMCost,
  buildSystemPrompt,
  shouldSummarize,
  messagesToSummarize,
  selectRecentMessages,
  type LLMMessage,
} from "@/lib/llm";
import { resolveTTSProvider, estimateTTSCost } from "@/lib/tts";
import { recordLLMUsage, recordTTSUsage, appendTurnUsage, estimateSpeechDurationSeconds } from "@/lib/usage";
import { getSummarizationModelName } from "@/lib/settings/platform";
import { decryptSecret } from "@/lib/security";
import { generateReplyWithCalendarTools, type CalendarToolContext } from "./calendar-tools";
// Import the specific submodules, not the @/lib/knowledge-base barrel —
// the barrel also re-exports PDF/URL extraction, which would drag their
// dependencies (pdf-parse, etc.) into every conversation turn for no
// reason. See lib/knowledge-base/pdf.ts's top comment for why that's not
// just a style nit: one such leak already broke an unrelated route.
import { formatKnowledgeBaseForPrompt } from "@/lib/knowledge-base/format";
import type { KnowledgeBaseSource } from "@/lib/knowledge-base/types";
import type { LLMModel, VoiceModel, Widget } from "@/types/database";
import { ApiError } from "@/types/errors";

export interface HandleTurnParams {
  widget: Widget;
  llmModel: LLMModel;
  voiceModel: VoiceModel;
  usageSessionId: string;
  conversationId: string;
  customerId: string;
  userMessage: string;
  clientDurationSeconds?: number;
  knowledgeBase?: KnowledgeBaseSource[];
}

export interface HandleTurnResult {
  replyText: string;
  audioBase64: string;
  audioContentType: string;
}

export interface GenerateReplyTextParams {
  widget: Widget;
  llmModel: LLMModel;
  usageSessionId: string;
  conversationId: string;
  customerId: string;
  userMessage: string;
  knowledgeBase?: KnowledgeBaseSource[];
}

// The LLM-generation half of handleConversationTurn below, minus TTS
// synthesis — used directly by the Twilio ConversationRelay path (see
// app/api/internal/conversation-relay/turn/route.ts), where Twilio's own
// STT/TTS handles audio and there's no voice_model/ElevenLabs step at all.
// handleConversationTurn (the phone/text-widget path, which does need audio
// back) is now a thin wrapper around this plus synthesis.
export interface GenerateReplyTextResult {
  replyText: string;
  llmCost: number;
}

export async function generateConversationReplyText(params: GenerateReplyTextParams): Promise<GenerateReplyTextResult> {
  const supabase = getAdminClient();

  const { data: historyRows, error: historyError } = await supabase
    .from("conversation_messages")
    .select("*")
    .eq("conversation_id", params.conversationId)
    .order("created_at", { ascending: true });

  if (historyError) throw new Error(`Failed to load conversation history: ${historyError.message}`);

  const history: LLMMessage[] = (historyRows ?? []).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  const { data: latestSummaryRow } = await supabase
    .from("conversation_summaries")
    .select("*")
    .eq("conversation_id", params.conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let summary = latestSummaryRow?.summary ?? null;

  const llmProvider = resolveLLMProvider(params.llmModel.provider);

  if (shouldSummarize(history)) {
    const summarizationModelName = await getSummarizationModelName();
    const { data: summarizationModelRow } = await supabase
      .from("llm_models")
      .select("*")
      .eq("model_name", summarizationModelName)
      .maybeSingle<LLMModel>();

    const toSummarize = messagesToSummarize(history);
    const summaryResult = await llmProvider.summarize({
      model: summarizationModelName,
      existingSummary: summary,
      messages: toSummarize,
    });

    summary = summaryResult.summary;
    const lastSummarizedRow = historyRows![toSummarize.length - 1];

    await supabase.from("conversation_summaries").insert({
      conversation_id: params.conversationId,
      summary,
      summarized_through_message_id: lastSummarizedRow?.id ?? null,
    });

    await recordLLMUsage({
      customerId: params.customerId,
      widgetId: params.widget.id,
      conversationId: params.conversationId,
      usageSessionId: params.usageSessionId,
      model: summarizationModelName,
      inputTokens: summaryResult.inputTokens,
      outputTokens: summaryResult.outputTokens,
      estimatedCost: estimateLLMCost({
        inputTokens: summaryResult.inputTokens,
        outputTokens: summaryResult.outputTokens,
        inputPricePerMillion: summarizationModelRow?.input_price_per_million ?? params.llmModel.input_price_per_million,
        outputPricePerMillion: summarizationModelRow?.output_price_per_million ?? params.llmModel.output_price_per_million,
      }),
    });
  }

  const systemPrompt = buildSystemPrompt({
    basePrompt: params.widget.system_prompt,
    summary,
    maxResponseChars: params.widget.max_response_chars,
    knowledgeBase: formatKnowledgeBaseForPrompt(params.knowledgeBase ?? []),
  });

  const messagesForLLM: LLMMessage[] = [
    ...selectRecentMessages(history),
    { role: "user", content: params.userMessage },
  ];

  // Only Anthropic-provider widgets can run the tool-use booking loop (see
  // calendar-tools.ts's module comment for why this stays out of the
  // generic LLMProvider interface) — a connected Cal.com calendar on any
  // other provider just doesn't get tool access, same as no connection.
  const calendarContext =
    llmProvider.name === "anthropic" ? await resolveCalendarToolContext(params) : null;

  const generation = calendarContext
    ? await generateReplyWithCalendarTools({
        model: params.llmModel.model_name,
        systemPrompt,
        messages: messagesForLLM,
        maxTokens: params.llmModel.max_tokens,
        calendar: calendarContext,
      })
    : await llmProvider.generateReply({
        model: params.llmModel.model_name,
        systemPrompt,
        messages: messagesForLLM,
        maxTokens: params.llmModel.max_tokens,
      });

  const replyText = generation.content.slice(0, params.widget.max_response_chars);

  await supabase.from("conversation_messages").insert([
    { conversation_id: params.conversationId, role: "user", content: params.userMessage },
    { conversation_id: params.conversationId, role: "assistant", content: replyText },
  ]);

  const llmCost = estimateLLMCost({
    inputTokens: generation.inputTokens,
    outputTokens: generation.outputTokens,
    inputPricePerMillion: params.llmModel.input_price_per_million,
    outputPricePerMillion: params.llmModel.output_price_per_million,
  });

  await recordLLMUsage({
    customerId: params.customerId,
    widgetId: params.widget.id,
    conversationId: params.conversationId,
    usageSessionId: params.usageSessionId,
    model: params.llmModel.model_name,
    inputTokens: generation.inputTokens,
    outputTokens: generation.outputTokens,
    estimatedCost: llmCost,
  });

  return { replyText, llmCost };
}

export async function handleConversationTurn(params: HandleTurnParams): Promise<HandleTurnResult> {
  const { replyText, llmCost } = await generateConversationReplyText(params);

  const ttsProvider = resolveTTSProvider(params.voiceModel.provider);

  let synthesis;
  try {
    synthesis = await ttsProvider.synthesize({
      text: replyText,
      voiceId: params.voiceModel.provider_voice_id,
    });
  } catch (err) {
    throw ApiError.internal(
      `Voice synthesis is temporarily unavailable: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }

  const ttsCost = estimateTTSCost(synthesis.charactersUsed);

  await recordTTSUsage({
    customerId: params.customerId,
    widgetId: params.widget.id,
    conversationId: params.conversationId,
    usageSessionId: params.usageSessionId,
    charactersUsed: synthesis.charactersUsed,
    estimatedCost: ttsCost,
  });

  const turnDurationSeconds =
    params.clientDurationSeconds ?? estimateSpeechDurationSeconds(synthesis.charactersUsed);

  await appendTurnUsage({
    usageSessionId: params.usageSessionId,
    durationSeconds: turnDurationSeconds,
    llmModel: params.llmModel.model_name,
    ttsProvider: ttsProvider.name,
    voiceModel: params.voiceModel.name,
    llmCost,
    ttsCost,
  });

  return { replyText, audioBase64: synthesis.audioBase64, audioContentType: synthesis.contentType };
}

// Looks up whether this widget has a working Cal.com connection — if so,
// the turn runs through the tool-use loop instead of a plain reply so the
// AI can actually check availability and book, not just talk about it.
// Decrypts the stored key just for this one call; never persisted or
// returned outside this function.
async function resolveCalendarToolContext(params: GenerateReplyTextParams): Promise<CalendarToolContext | null> {
  const supabase = getAdminClient();
  const { data: connection } = await supabase
    .from("calendar_connections")
    .select("calcom_api_key, calcom_event_type_id, calcom_timezone")
    .eq("widget_id", params.widget.id)
    .eq("provider", "calcom")
    .eq("status", "connected")
    .maybeSingle();

  if (!connection?.calcom_api_key || !connection.calcom_event_type_id) return null;

  const eventTypeId = Number(connection.calcom_event_type_id);
  if (!Number.isFinite(eventTypeId)) return null;

  return {
    apiKey: decryptSecret(connection.calcom_api_key),
    eventTypeId,
    timezone: connection.calcom_timezone ?? "Europe/Copenhagen",
    customerId: params.customerId,
    widgetId: params.widget.id,
    conversationId: params.conversationId,
  };
}
