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
