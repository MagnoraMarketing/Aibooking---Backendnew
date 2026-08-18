import { notFound } from "next/navigation";
import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { buildShareUrl, buildEmbedSnippet } from "@/lib/widgets";
import { hasEmbedCodeAccess, trialDaysRemaining } from "@/lib/billing";
import { getBalanceSeconds } from "@/lib/credits";
import { AgentConfigurator, type WidgetExtra, type WidgetWithExtras } from "@/components/dashboard/agent-configurator";
import type { Customer, LLMModel, Package, Subscription, VoiceModel, Widget } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AgentConfigurePage({ params }: { params: { id: string } }) {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const { data: widget } = await supabase.from("widgets").select("*").eq("id", params.id).maybeSingle<Widget>();

  if (!widget || widget.customer_id !== customerId) {
    notFound();
  }

  const [{ data: settings }, { data: llmModels }, { data: voiceModels }, { data: customer }, { data: subscription }, balanceSeconds] =
    await Promise.all([
      supabase
        .from("widget_settings")
        .select("extra")
        .eq("widget_id", widget.id)
        .maybeSingle<{ extra: WidgetExtra | null }>(),
      supabase.from("llm_models").select("*").eq("active", true).order("display_name").returns<LLMModel[]>(),
      supabase.from("voice_models").select("*").eq("active", true).order("name").returns<VoiceModel[]>(),
      supabase.from("customers").select("*").eq("id", customerId).single<Customer>(),
      supabase
        .from("subscriptions")
        .select("*, packages(*)")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<Subscription & { packages: Package | null }>(),
      getBalanceSeconds(customerId),
    ]);

  const widgetWithExtras: WidgetWithExtras = {
    ...widget,
    shareUrl: buildShareUrl(widget.public_id),
    embedSnippet: buildEmbedSnippet(widget.public_id),
    extra: settings?.extra ?? {},
  };

  const embedCodeUnlocked = hasEmbedCodeAccess({
    customerCreatedAt: customer!.created_at,
    subscriptionStatus: subscription?.status ?? null,
    balanceSeconds,
    byoTrialExpiresAt: customer!.byo_trial_expires_at,
  });

  return (
    <AgentConfigurator
      initialWidget={widgetWithExtras}
      llmModels={llmModels ?? []}
      voiceModels={voiceModels ?? []}
      embedCodeUnlocked={embedCodeUnlocked}
      trialDaysRemaining={trialDaysRemaining(customer!.created_at)}
      pkg={subscription?.packages ?? null}
    />
  );
}
