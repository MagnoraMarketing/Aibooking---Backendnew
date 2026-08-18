import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { hasEmbedCodeAccess, trialDaysRemaining } from "@/lib/billing";
import { getBalanceSeconds } from "@/lib/credits";
import { AgentsManager } from "@/components/dashboard/agents-manager";
import type { Customer, LLMModel, Package, Subscription, VoiceModel, Widget } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AgentListPage() {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const [
    { data: widgets },
    { data: llmModels },
    { data: allLlmModels },
    { data: voiceModels },
    { data: customer },
    { data: subscription },
    balanceSeconds,
  ] = await Promise.all([
    supabase
      .from("widgets")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .returns<Widget[]>(),
    supabase
      .from("llm_models")
      .select("*")
      .eq("active", true)
      .eq("show_in_create_flow", true)
      .order("display_name")
      .returns<LLMModel[]>(),
    supabase.from("llm_models").select("id, provider"),
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

  // This page is Widget Agents only now — Telefon (Inbound/Outbound) agents
  // have their own panel on the Inbound page (see agentType docs on
  // AgentsManager for why this split exists).
  const providerByModelId = new Map((allLlmModels ?? []).map((m) => [m.id, m.provider]));
  const widgetAgents = (widgets ?? []).filter((w) => !w.llm_model_id || providerByModelId.get(w.llm_model_id) !== "anthropic");

  const embedCodeUnlocked = customer
    ? hasEmbedCodeAccess({
        customerCreatedAt: customer.created_at,
        subscriptionStatus: subscription?.status ?? null,
        balanceSeconds,
      })
    : false;

  return (
    <AgentsManager
      initialWidgets={widgetAgents}
      llmModels={llmModels ?? []}
      voiceModels={voiceModels ?? []}
      embedCodeUnlocked={embedCodeUnlocked}
      trialDaysRemaining={customer ? trialDaysRemaining(customer.created_at) : 0}
      pkg={subscription?.packages ?? null}
      agentType="widget"
    />
  );
}
