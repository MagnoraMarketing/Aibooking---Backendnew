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

const FALLBACK_PROMPT_DRAFTING_MODEL = "claude-haiku-4-5";

// Drafting a starting system prompt in the agent wizard ("Generér prompt").
// Deliberately its own setting rather than reusing the summarization model:
// that one also decides which model every Vapi assistant runs on (see
// lib/vapi/assistants.ts), and the model that drafts a one-off text field
// shouldn't be tied to the model that handles live calls. Haiku 4.5 is the
// cheap end of the range and plenty for a draft the customer then edits.
export async function getPromptDraftingModelName(): Promise<string> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "prompt_drafting_model_name")
    .maybeSingle();

  if (!data || typeof data.value !== "string") return FALLBACK_PROMPT_DRAFTING_MODEL;
  return data.value;
}

export async function setSummarizationModelName(modelName: string): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("platform_settings")
    .upsert({ key: "summarization_model_name", value: modelName });

  if (error) throw new Error(`Failed to update summarization model: ${error.message}`);
}

// Knowledge base ingestion (see lib/knowledge-base) has no per-token cost of
// its own — the content is stuffed into the system prompt, so its real cost
// is the extra tokens sent on every future turn. This rate converts ingested
// characters into an equivalent one-time deduction from the same per-minute
// credit ledger everything else uses, rather than adding a second pricing
// dimension. Admin-configurable so the rate can be tuned without a deploy.
const FALLBACK_KB_SECONDS_PER_1000_CHARS = 60;

export async function getKnowledgeBaseSecondsPer1000Chars(): Promise<number> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "knowledge_base_seconds_per_1000_chars")
    .maybeSingle();

  if (!data || typeof data.value !== "number") return FALLBACK_KB_SECONDS_PER_1000_CHARS;
  return data.value;
}

export async function setKnowledgeBaseSecondsPer1000Chars(seconds: number): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("platform_settings")
    .upsert({ key: "knowledge_base_seconds_per_1000_chars", value: seconds });

  if (error) throw new Error(`Failed to update knowledge base pricing: ${error.message}`);
}
