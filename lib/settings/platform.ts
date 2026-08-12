import "server-only";
import { getAdminClient } from "@/lib/database/admin";

const FALLBACK_SYSTEM_PROMPT =
  "Du er AI-assistent for virksomheden. Din opgave er at hjælpe besøgende, besvare spørgsmål og skabe bookinger. Tal naturligt og kortfattet. Hvis du ikke kender svaret, må du ikke opfinde information.";

export async function getDefaultSystemPrompt(): Promise<string> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "default_system_prompt")
    .maybeSingle();

  if (!data || typeof data.value !== "string") return FALLBACK_SYSTEM_PROMPT;
  return data.value;
}

export async function setDefaultSystemPrompt(prompt: string): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("platform_settings")
    .upsert({ key: "default_system_prompt", value: prompt });

  if (error) throw new Error(`Failed to update default system prompt: ${error.message}`);
}

const FALLBACK_SUMMARIZATION_MODEL = "claude-sonnet-5";

// Rolling conversation summaries (see lib/llm/context-builder.ts) always use
// this model, regardless of which model the widget itself talks to — keeps
// the cost-control summarization step on a fast/cheap, consistently good
// model rather than whatever (possibly pricier) model the customer picked.
export async function getSummarizationModelName(): Promise<string> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "summarization_model_name")
    .maybeSingle();

  if (!data || typeof data.value !== "string") return FALLBACK_SUMMARIZATION_MODEL;
  return data.value;
}

export async function setSummarizationModelName(modelName: string): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("platform_settings")
    .upsert({ key: "summarization_model_name", value: modelName });

  if (error) throw new Error(`Failed to update summarization model: ${error.message}`);
}
