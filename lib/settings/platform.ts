import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { TRIAL_MINUTES } from "@/lib/billing/trial";

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

const FALLBACK_SUMMARIZATION_MODEL = "claude-3-5-sonnet-20241022";

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

// A single, master-admin-configured Vapi assistant (built and tuned directly
// in Vapi's own dashboard, same as the voice templates below) that the
// "Generér prompt" wizard step falls back to via Vapi's Chat API when
// Anthropic itself fails (out of credits, key revoked, outage — see
// translateAnthropicError in lib/llm/anthropic-provider.ts and
// FallbackProvider in lib/llm/fallback-provider.ts). Left unset, the
// fallback simply never fires and today's Anthropic-only error is what the
// customer sees — this setting is opt-in.
const VAPI_PROMPT_DRAFTING_ASSISTANT_KEY = "vapi_prompt_drafting_assistant_id";

export async function getVapiPromptDraftingAssistantId(): Promise<string | null> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", VAPI_PROMPT_DRAFTING_ASSISTANT_KEY)
    .maybeSingle();

  if (!data || typeof data.value !== "string" || !data.value) return null;
  return data.value;
}

export async function setVapiPromptDraftingAssistantId(assistantId: string | null): Promise<void> {
  const supabase = getAdminClient();

  // Same NOT NULL-column reasoning as setVapiVoiceTemplateAssistantId below:
  // clearing the field deletes the row rather than writing null into it.
  const { error } = assistantId
    ? await supabase.from("platform_settings").upsert({ key: VAPI_PROMPT_DRAFTING_ASSISTANT_KEY, value: assistantId })
    : await supabase.from("platform_settings").delete().eq("key", VAPI_PROMPT_DRAFTING_ASSISTANT_KEY);

  if (error) throw new Error(`Failed to update Vapi prompt-drafting assistant: ${error.message}`);
}

export type { VapiVoiceGender } from "@/lib/vapi/voice-gender";
import type { VapiVoiceGender } from "@/lib/vapi/voice-gender";

function vapiVoiceTemplateKey(gender: VapiVoiceGender): string {
  return `vapi_${gender}_voice_template_assistant_id`;
}

// Two hand-configured Vapi assistants (one male voice, one female voice),
// set by a master admin, that widget assistants clone their `voice` config
// from — see resolveVoiceConfig in lib/vapi/assistants.ts. Never exposed to
// customers: they only ever pick "Mand"/"Dame", not a raw Vapi id.
export async function getVapiVoiceTemplateAssistantId(gender: VapiVoiceGender): Promise<string | null> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", vapiVoiceTemplateKey(gender))
    .maybeSingle();

  if (!data || typeof data.value !== "string" || !data.value) return null;
  return data.value;
}

export async function setVapiVoiceTemplateAssistantId(gender: VapiVoiceGender, assistantId: string | null): Promise<void> {
  const supabase = getAdminClient();
  const key = vapiVoiceTemplateKey(gender);

  // Clearing a template means removing the row, not writing null into it:
  // platform_settings.value is NOT NULL, so the upsert rejected the write and
  // the admin screen 500'd — which made the one page that configures voices
  // impossible to clear, on a platform where the voices are what needed
  // fixing.
  const { error } = assistantId
    ? await supabase.from("platform_settings").upsert({ key, value: assistantId })
    : await supabase.from("platform_settings").delete().eq("key", key);

  if (error) throw new Error(`Failed to update Vapi ${gender} voice template: ${error.message}`);
}

// The free trial every new customer starts with (lib/customers/self-signup.ts
// and lib/customers/onboarding.ts): how many minutes they get for the 7-day
// trial. The platform pays for these minutes; the customer only ever sees how
// many they have left. Admin-configurable so the offer can change without a
// deploy. A change applies to customers created afterwards — minutes already
// granted stay as they were.
const TRIAL_MINUTES_KEY = "trial_minutes";
// The admin's own note about the trial (what it costs, why it is set as it
// is). Master admin only: it is never sent to a customer-facing page or API.
const TRIAL_INTERNAL_NOTE_KEY = "trial_internal_note";

export const MAX_TRIAL_MINUTES = 600;

export interface TrialSettings {
  minutes: number;
  internalNote: string;
}

export async function getTrialMinutes(): Promise<number> {
  const supabase = getAdminClient();
  const { data } = await supabase.from("platform_settings").select("value").eq("key", TRIAL_MINUTES_KEY).maybeSingle();

  const value = data?.value;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return TRIAL_MINUTES;
  return Math.min(MAX_TRIAL_MINUTES, Math.floor(value));
}

export async function getTrialSettings(): Promise<TrialSettings> {
  const supabase = getAdminClient();
  const [minutes, { data: note }] = await Promise.all([
    getTrialMinutes(),
    supabase.from("platform_settings").select("value").eq("key", TRIAL_INTERNAL_NOTE_KEY).maybeSingle(),
  ]);
  return { minutes, internalNote: typeof note?.value === "string" ? note.value : "" };
}

export async function setTrialSettings(settings: TrialSettings): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase.from("platform_settings").upsert({ key: TRIAL_MINUTES_KEY, value: settings.minutes });
  if (error) throw new Error(`Failed to update trial minutes: ${error.message}`);

  // platform_settings.value is NOT NULL, so an emptied note removes the row.
  const { error: noteError } = settings.internalNote
    ? await supabase.from("platform_settings").upsert({ key: TRIAL_INTERNAL_NOTE_KEY, value: settings.internalNote })
    : await supabase.from("platform_settings").delete().eq("key", TRIAL_INTERNAL_NOTE_KEY);
  if (noteError) throw new Error(`Failed to update trial note: ${noteError.message}`);
}

// Trial grants are ledger rows written with this description, so a
// customer's own trial size can be read back later even after the setting
// has changed.
export function trialGrantDescription(minutes: number): string {
  return `Gratis prøveperiode: ${minutes} minutter (7 dage)`;
}

// How many trial minutes this customer was actually given — what their
// billing page shows as the trial's total. Falls back to the current
// setting for a customer whose grant can't be found.
export async function getCustomerTrialMinutes(customerId: string): Promise<number> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("credit_transactions")
    .select("amount_seconds")
    .eq("customer_id", customerId)
    .eq("type", "subscription_credit")
    .like("description", "Gratis prøveperiode:%")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (data && typeof data.amount_seconds === "number") return Math.round(data.amount_seconds / 60);
  return getTrialMinutes();
}
