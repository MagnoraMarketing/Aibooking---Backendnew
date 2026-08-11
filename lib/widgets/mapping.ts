import type { z } from "zod";
import type { widgetUpdateSchema } from "@/lib/security/schemas";

type WidgetUpdateInput = z.infer<typeof widgetUpdateSchema>;

// Maps the camelCase API input to the widgets table's snake_case columns,
// omitting any field the caller didn't send (partial update semantics).
export function widgetUpdateToDbRow(input: WidgetUpdateInput): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (input.name !== undefined) row.name = input.name;
  if (input.status !== undefined) row.status = input.status;
  if (input.businessName !== undefined) row.business_name = input.businessName;
  if (input.llmModelId !== undefined) row.llm_model_id = input.llmModelId;
  if (input.voiceModelId !== undefined) row.voice_model_id = input.voiceModelId;
  if (input.language !== undefined) row.language = input.language;
  if (input.systemPrompt !== undefined) row.system_prompt = input.systemPrompt;
  if (input.welcomeMessage !== undefined) row.welcome_message = input.welcomeMessage;
  if (input.openingMessage !== undefined) row.opening_message = input.openingMessage;
  if (input.primaryColor !== undefined) row.primary_color = input.primaryColor;
  if (input.secondaryColor !== undefined) row.secondary_color = input.secondaryColor;
  if (input.logoUrl !== undefined) row.logo_url = input.logoUrl;
  if (input.avatarUrl !== undefined) row.avatar_url = input.avatarUrl;
  if (input.position !== undefined) row.position = input.position;
  if (input.widgetSize !== undefined) row.widget_size = input.widgetSize;
  if (input.showBranding !== undefined) row.show_branding = input.showBranding;
  if (input.maxResponseChars !== undefined) row.max_response_chars = input.maxResponseChars;

  return row;
}
