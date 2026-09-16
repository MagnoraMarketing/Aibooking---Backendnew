import { notFound, redirect } from "next/navigation";
import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { buildShareUrl, buildEmbedSnippet } from "@/lib/widgets";
import { hasEmbedCodeAccess, trialDaysRemaining } from "@/lib/billing";
import { getBalanceSeconds } from "@/lib/credits";
import { AgentConfigurator, type WidgetExtra, type WidgetWithExtras } from "@/components/dashboard/agent-configurator";
import type { Customer, LLMModel, Package, Subscription, VoiceModel, Widget } from "@/types/database";
import { AGENT_SECTION_PATHS, type AgentSection } from "./agent-sections";

// Configuring one agent, reachable from the section that agent belongs to.
//
// A phone agent used to be configured at /dashboard/agent/<id> — the Widget
// Agents URL — so opening one from Inbound moved the highlight in the top
// menu to Widget Agents, a page that does not even list it (it filters to
// agent_type='widget'). The customer was left in a section they had not
// asked for, looking at a phone agent.
//
// So each section has its own URL for the same screen, and a widget opened
// under the wrong one is sent to its own. That keeps every existing link
// working — the dashboard, Knowledge Base and the checkout return all point
// at /dashboard/agent/<id> — without any of them having to know the agent's
// type, which is a database fact they do not have at link time.
function sectionFor(widget: Widget): AgentSection {
  return widget.agent_type === "phone" ? "inbound" : "widget";
}

// Carried across the redirect: /dashboard/agent/<id>?tab=knowledge is a real
// link (see app/dashboard/knowledge-base/page.tsx), and dropping the tab
// would land the customer on the wrong one after the bounce.
function queryString(searchParams: Record<string, string | string[] | undefined> | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
    else if (value !== undefined) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function AgentConfigurePage({
  id,
  section,
  searchParams,
}: {
  id: string;
  section: AgentSection;
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const { data: widget } = await supabase.from("widgets").select("*").eq("id", id).maybeSingle<Widget>();

  if (!widget || widget.customer_id !== customerId) {
    notFound();
  }

  const belongsIn = sectionFor(widget);
  if (belongsIn !== section) {
    redirect(`${AGENT_SECTION_PATHS[belongsIn]}/${widget.id}${queryString(searchParams)}`);
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
    widgetLaunchPaidAt: customer!.widget_launch_paid_at,
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
