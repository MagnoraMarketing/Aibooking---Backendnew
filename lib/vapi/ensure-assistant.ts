import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { getDefaultSystemPrompt } from "@/lib/settings/platform";
import { defaultGreeting, withLanguageDirective } from "@/lib/i18n/agent-content";
import { createVapiAssistant } from "./assistants";
import { syncWidgetToVapiAssistant } from "./sync";
import { DEFAULT_VOICE_GENDER, type VapiVoiceGender } from "./voice-gender";
import { ApiError } from "@/types/errors";

// Gives an agent the Vapi assistant an inbound number needs, creating it —
// and moving the agent onto the Vapi model — when it has none.
//
// Inbound calls are answered by a Vapi assistant (see
// lib/phone-numbers/service.ts). Phone agents created before that used the
// Anthropic model and our own TwiML pipeline instead, so they have no
// assistant, and nothing in the dashboard can give them one: the model picker
// is gone, and the PATCH route's self-heal only fires for agents already on
// the Vapi model. Without this they are simply stranded — offered in the
// Inbound page's agent picker and refused at the till.
//
// Moving the model is a real change and not only an inbound one: an agent
// converted here also places its OUTBOUND campaign calls through Vapi
// afterwards rather than Twilio directly (see the campaign launch route).
// That is the lesser evil — the alternative is an agent that cannot take the
// calls it exists to take — but it is why this only runs when a customer
// actually attaches an inbound number, never in the background.
export async function ensureInboundAssistant(widgetId: string): Promise<string> {
  const supabase = getAdminClient();

  const { data: widget, error } = await supabase
    .from("widgets")
    .select("*")
    .eq("id", widgetId)
    .single();
  if (error) throw error;

  const { data: settings } = await supabase
    .from("widget_settings")
    .select("extra")
    .eq("widget_id", widgetId)
    .maybeSingle();
  const extra = ((settings?.extra as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;

  const existing = extra.vapiAssistantId;
  if (typeof existing === "string" && existing) return existing;

  const { data: vapiModel } = await supabase
    .from("llm_models")
    .select("id")
    .eq("provider", "vapi")
    .eq("active", true)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!vapiModel) {
    // Nothing the customer can do about this one — it means the platform has
    // no Vapi model row at all, which is a setup problem on our side.
    throw ApiError.internal("Platformen har ingen aktiv Vapi-model, så agenten kan ikke tage imod opkald.");
  }

  const voiceGender = (extra.voiceGender as VapiVoiceGender | null | undefined) ?? DEFAULT_VOICE_GENDER;
  const basePrompt = widget.system_prompt ?? (await getDefaultSystemPrompt());

  const assistant = await createVapiAssistant({
    name: widget.name,
    systemPrompt: withLanguageDirective(basePrompt, widget.language),
    firstMessage: widget.opening_message ?? defaultGreeting(widget.language),
    voiceGender,
    language: widget.language,
  });

  const nextExtra = { ...extra, voiceGender, vapiAssistantId: assistant.id };
  await supabase.from("widget_settings").upsert({ widget_id: widgetId, extra: nextExtra });

  const { data: updated } = await supabase
    .from("widgets")
    .update({ llm_model_id: vapiModel.id })
    .eq("id", widgetId)
    .select("*")
    .single();

  // The assistant above is built from the bare prompt. Only the sync merges
  // in the knowledge base and the booking/webshop tools — without it the
  // agent would answer its first call knowing none of its own sources.
  if (updated) await syncWidgetToVapiAssistant(updated, nextExtra);

  return assistant.id;
}
