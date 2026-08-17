import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import type { Customer, LLMModel, VoiceModel, Widget } from "@/types/database";

export interface WidgetBundle {
  widget: Widget;
  customer: Customer;
  llmModel: LLMModel | null;
  voiceModel: VoiceModel | null;
  extra: Record<string, unknown>;
}

async function loadExtra(supabase: ReturnType<typeof getAdminClient>, widgetId: string): Promise<Record<string, unknown>> {
  const { data } = await supabase.from("widget_settings").select("extra").eq("widget_id", widgetId).maybeSingle();
  return (data?.extra as Record<string, unknown> | null) ?? {};
}

// Single lookup path used by every public /api/widget/* route. Returns null
// if the widget doesn't exist, is paused, or belongs to a non-active
// customer — end users should never be able to distinguish those cases
// (all read as "widget unavailable").
export async function getWidgetBundleByPublicId(publicId: string): Promise<WidgetBundle | null> {
  const supabase = getAdminClient();

  const { data: widget, error } = await supabase
    .from("widgets")
    .select("*")
    .eq("public_id", publicId)
    .maybeSingle<Widget>();

  if (error || !widget || widget.status !== "active") return null;

  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", widget.customer_id)
    .maybeSingle<Customer>();

  if (!customer || customer.status !== "active") return null;

  const [{ data: llmModel }, { data: voiceModel }, extra] = await Promise.all([
    widget.llm_model_id
      ? supabase.from("llm_models").select("*").eq("id", widget.llm_model_id).maybeSingle<LLMModel>()
      : Promise.resolve({ data: null }),
    widget.voice_model_id
      ? supabase.from("voice_models").select("*").eq("id", widget.voice_model_id).maybeSingle<VoiceModel>()
      : Promise.resolve({ data: null }),
    loadExtra(supabase, widget.id),
  ]);

  return { widget, customer, llmModel: llmModel ?? null, voiceModel: voiceModel ?? null, extra };
}

// Same shape, keyed by internal widget id — used by session/message routes
// that already hold a widget_id from a usage_session row.
export async function getWidgetBundleById(widgetId: string): Promise<WidgetBundle | null> {
  const supabase = getAdminClient();

  const { data: widget, error } = await supabase
    .from("widgets")
    .select("*")
    .eq("id", widgetId)
    .maybeSingle<Widget>();

  if (error || !widget) return null;

  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", widget.customer_id)
    .maybeSingle<Customer>();

  if (!customer) return null;

  const [{ data: llmModel }, { data: voiceModel }, extra] = await Promise.all([
    widget.llm_model_id
      ? supabase.from("llm_models").select("*").eq("id", widget.llm_model_id).maybeSingle<LLMModel>()
      : Promise.resolve({ data: null }),
    widget.voice_model_id
      ? supabase.from("voice_models").select("*").eq("id", widget.voice_model_id).maybeSingle<VoiceModel>()
      : Promise.resolve({ data: null }),
    loadExtra(supabase, widget.id),
  ]);

  return { widget, customer, llmModel: llmModel ?? null, voiceModel: voiceModel ?? null, extra };
}
