import { notFound } from "next/navigation";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { buildShareUrl, buildEmbedSnippet } from "@/lib/widgets";
import { AgentConfigurator, type WidgetExtra, type WidgetWithExtras } from "@/components/dashboard/agent-configurator";
import type { LLMModel, VoiceModel, Widget } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AgentConfigurePage({ params }: { params: { id: string } }) {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();

  const { data: widget } = await supabase.from("widgets").select("*").eq("id", params.id).maybeSingle<Widget>();

  if (!widget || widget.customer_id !== ctx.profile.customer_id) {
    notFound();
  }

  const [{ data: settings }, { data: llmModels }, { data: voiceModels }] = await Promise.all([
    supabase
      .from("widget_settings")
      .select("extra")
      .eq("widget_id", widget.id)
      .maybeSingle<{ extra: WidgetExtra | null }>(),
    supabase.from("llm_models").select("*").eq("active", true).order("display_name").returns<LLMModel[]>(),
    supabase.from("voice_models").select("*").eq("active", true).order("name").returns<VoiceModel[]>(),
  ]);

  const widgetWithExtras: WidgetWithExtras = {
    ...widget,
    shareUrl: buildShareUrl(widget.public_id),
    embedSnippet: buildEmbedSnippet(widget.public_id),
    extra: settings?.extra ?? {},
  };

  return (
    <AgentConfigurator initialWidget={widgetWithExtras} llmModels={llmModels ?? []} voiceModels={voiceModels ?? []} />
  );
}
