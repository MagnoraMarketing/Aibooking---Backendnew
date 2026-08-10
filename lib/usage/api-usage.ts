import "server-only";
import { getAdminClient } from "@/lib/database/admin";

export async function recordLLMUsage(params: {
  customerId: string;
  widgetId: string;
  conversationId: string;
  usageSessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase.from("api_usage").insert({
    customer_id: params.customerId,
    widget_id: params.widgetId,
    conversation_id: params.conversationId,
    usage_session_id: params.usageSessionId,
    provider: "anthropic",
    model: params.model,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    estimated_cost: params.estimatedCost,
  });

  if (error) throw new Error(`Failed to record LLM api_usage: ${error.message}`);
}

export async function recordTTSUsage(params: {
  customerId: string;
  widgetId: string;
  conversationId: string;
  usageSessionId: string;
  charactersUsed: number;
  estimatedCost: number;
}): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase.from("api_usage").insert({
    customer_id: params.customerId,
    widget_id: params.widgetId,
    conversation_id: params.conversationId,
    usage_session_id: params.usageSessionId,
    provider: "elevenlabs",
    characters_used: params.charactersUsed,
    estimated_cost: params.estimatedCost,
  });

  if (error) throw new Error(`Failed to record TTS api_usage: ${error.message}`);
}
