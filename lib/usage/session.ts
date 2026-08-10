import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { deductUsage } from "@/lib/credits/ledger";
import type { UsageSession } from "@/types/database";

// We track usage internally at second-level precision (not rounded up to
// whole minutes) and only format as minutes in the UI — this gives more
// accurate cost control than coarse per-minute billing.
export async function createUsageSession(params: {
  customerId: string;
  widgetId: string;
  conversationId: string;
}): Promise<UsageSession> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("usage_sessions")
    .insert({
      customer_id: params.customerId,
      widget_id: params.widgetId,
      conversation_id: params.conversationId,
    })
    .select("*")
    .single();

  if (error) throw new Error(`Failed to create usage session: ${error.message}`);
  return data as UsageSession;
}

export async function appendTurnUsage(params: {
  usageSessionId: string;
  durationSeconds: number;
  llmModel: string;
  ttsProvider: string;
  voiceModel: string;
  llmCost: number;
  ttsCost: number;
}): Promise<void> {
  const supabase = getAdminClient();

  const { data: session, error: fetchError } = await supabase
    .from("usage_sessions")
    .select("duration_seconds, estimated_llm_cost, estimated_tts_cost")
    .eq("id", params.usageSessionId)
    .single();

  if (fetchError) throw new Error(`Failed to load usage session: ${fetchError.message}`);

  const { error } = await supabase
    .from("usage_sessions")
    .update({
      duration_seconds: session.duration_seconds + params.durationSeconds,
      estimated_llm_cost: Number(session.estimated_llm_cost) + params.llmCost,
      estimated_tts_cost: Number(session.estimated_tts_cost) + params.ttsCost,
      llm_model: params.llmModel,
      tts_provider: params.ttsProvider,
      voice_model: params.voiceModel,
    })
    .eq("id", params.usageSessionId);

  if (error) throw new Error(`Failed to update usage session: ${error.message}`);
}

// Ends the session, bills the accumulated duration against the customer's
// credit ledger, and marks the conversation as ended.
export async function finalizeUsageSession(usageSessionId: string): Promise<UsageSession> {
  const supabase = getAdminClient();

  const { data: session, error: fetchError } = await supabase
    .from("usage_sessions")
    .select("*")
    .eq("id", usageSessionId)
    .single();

  if (fetchError) throw new Error(`Failed to load usage session: ${fetchError.message}`);
  if (session.ended_at) return session as UsageSession;

  const billedSeconds = Math.max(1, Math.round(session.duration_seconds));

  const { data: updated, error } = await supabase
    .from("usage_sessions")
    .update({
      ended_at: new Date().toISOString(),
      billed_duration_seconds: billedSeconds,
      credit_cost_seconds: billedSeconds,
    })
    .eq("id", usageSessionId)
    .select("*")
    .single();

  if (error) throw new Error(`Failed to finalize usage session: ${error.message}`);

  await deductUsage({
    customerId: updated.customer_id,
    seconds: billedSeconds,
    usageSessionId: updated.id,
    description: "Voice session usage",
  });

  if (updated.conversation_id) {
    await supabase
      .from("conversations")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", updated.conversation_id);
  }

  return updated as UsageSession;
}
