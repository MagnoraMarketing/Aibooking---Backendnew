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
import { formatKnowledgeBaseForPrompt, type KnowledgeBaseSource } from "@/lib/knowledge-base";
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

export async function handleConversationTurn(params: HandleTurnParams): Promise<HandleTurnResult> {
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

  const generation = await llmProvider.generateReply({
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
