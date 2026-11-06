import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { hasEmbedCodeAccess, trialDaysRemaining } from "@/lib/billing";
import { getBalanceSeconds } from "@/lib/credits";
import { AgentsManager } from "@/components/dashboard/agents-manager";
import type { WidgetExtra, WidgetWithExtras } from "@/components/dashboard/agent-configurator";
import { buildEmbedSnippet, buildShareUrl } from "@/lib/widgets";
import { publicWidgetExtra } from "@/lib/uber-direct/connection";
import type { Customer, LLMModel, Package, Subscription, VoiceModel, Widget } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AgentListPage() {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const [
    { data: widgets },
    { data: llmModels },
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
  const widgetAgents = (widgets ?? []).filter((w) => w.agent_type === "widget");

  // Agents nobody has set up yet (the one a new customer gets at signup —
  // see needsSetup in lib/security/schemas.ts). Sent whole, so the creation
  // flow can open straight on one of them instead of making a new agent.
  const { data: settingsRows } = widgetAgents.length
    ? await supabase
        .from("widget_settings")
        .select("widget_id, extra")
        .in(
          "widget_id",
          widgetAgents.map((w) => w.id)
        )
    : { data: [] };
  const extraById = new Map(
    ((settingsRows ?? []) as { widget_id: string; extra: WidgetExtra | null }[]).map((row) => [row.widget_id, row.extra ?? {}])
  );
  const pendingSetup: WidgetWithExtras[] = widgetAgents
    .filter((w) => extraById.get(w.id)?.needsSetup === true)
    .map((w) => ({
      ...w,
      shareUrl: buildShareUrl(w.public_id),
      embedSnippet: buildEmbedSnippet(w.public_id),
      extra: publicWidgetExtra(extraById.get(w.id) as Record<string, unknown>) as WidgetExtra,
    }));

  const embedCodeUnlocked = customer
    ? hasEmbedCodeAccess({
        customerCreatedAt: customer.created_at,
        subscriptionStatus: subscription?.status ?? null,
        balanceSeconds,
        widgetLaunchPaidAt: customer.widget_launch_paid_at,
        customerType: customer.customer_type,
      })
    : false;

  return (
    <AgentsManager
      initialWidgets={widgetAgents}
      pendingSetup={pendingSetup}
      llmModels={llmModels ?? []}
      voiceModels={voiceModels ?? []}
      embedCodeUnlocked={embedCodeUnlocked}
      trialDaysRemaining={customer ? trialDaysRemaining(customer.created_at) : 0}
      pkg={subscription?.packages ?? null}
      agentType="widget"
    />
  );
}
