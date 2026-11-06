"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { LLMModel, Package, VoiceModel, Widget } from "@/types/database";
import type { KnowledgeBaseSource } from "@/lib/knowledge-base/types";
import { useTranslation } from "@/components/i18n/language-provider";
import { WIDGET_LAUNCH_MINUTES } from "@/lib/billing/widget-launch-offer";
import { PromptLabTab } from "./agent-tabs/prompt-lab";
import { SettingsTab } from "./agent-tabs/settings-tab";
import { TestAgentTab } from "./agent-tabs/test-agent";
import { TestCallTab } from "./agent-tabs/test-call";
import { CustomizeWidgetTab } from "./agent-tabs/customize-widget";
import { EmbedCodeTab } from "./agent-tabs/embed-code";
import { KnowledgeBaseTab } from "./agent-tabs/knowledge-base-tab";
import { BookingTab } from "./agent-tabs/booking-tab";
import { WebshopTab } from "./agent-tabs/webshop-tab";
import { DeliveryTab } from "./agent-tabs/delivery-tab";
import { WizardPhoneStep } from "./agent-tabs/wizard-phone-step";
import { StatusPill, primaryButtonClass } from "./agent-flow-ui";
import { agentSectionPath } from "./agent-sections";

// The "om virksomheden" answers behind a generated system prompt. Saved
// alongside the prompt itself so it stays regenerable — see
// agent-tabs/prompt-lab.tsx.
export interface PromptInputs {
  businessDescription?: string;
  keyServices?: string;
  openingHours?: string;
  otherNotes?: string;
}

export interface WidgetExtra {
  tagline?: string | null;
  isGlowing?: boolean;
  isTransparent?: boolean;
  transcriptionEnabled?: boolean;
  chatEnabled?: boolean;
  autostart?: boolean;
  muteOnMinimize?: boolean;
  muteOnTabChange?: boolean;
  showLeadForm?: boolean;
  agentMute?: boolean;
  vapiAssistantId?: string | null;
  // A second assistant used only for outbound campaign calls — maintained in
  // Vapi by hand and never synced over. Unset means campaigns use the one
  // that answers the phone.
  vapiOutboundAssistantId?: string | null;
  voiceGender?: "male" | "female" | null;
  silenceTimeoutSeconds?: number | null;
  maxDurationSeconds?: number | null;
  promptInputs?: PromptInputs | null;
  knowledgeBase?: KnowledgeBaseSource[];
  // Picked in the wizard's first step — see AgentPurpose in
  // agent-creation-wizard.tsx and taskBullets in
  // app/api/customer/widgets/[id]/generate-prompt/route.ts.
  agentPurposes?: ("booking" | "shopify" | "qa")[] | null;
  purposeNotes?: string | null;
}

export interface WidgetWithExtras extends Widget {
  shareUrl: string;
  embedSnippet: string;
  extra: WidgetExtra;
}

export type SavePatch = (patch: Record<string, unknown>) => Promise<boolean>;

type TabKey = "prompt" | "settings" | "knowledge" | "booking" | "webshop" | "delivery" | "customize" | "test" | "embed" | "phone";

// Which tabs make sense depends on what the agent is for — chosen once at
// creation (see agent-creation-wizard.tsx's Voice Widget / Telefon type
// picker) and readable afterwards from the widget's model provider.
// Customise Widget / Embed Code are meaningless for a phone-only agent
// (there's no website embed); Telefonnummer replaces Embed Code for one
// instead, handing off to the Inbound page the same way the wizard's final
// step does.
function tabsFor(
  isPhoneType: boolean,
  t: (key: string, vars?: Record<string, string | number>) => string
): { key: TabKey; label: string }[] {
  // Same order as the creation flow (agent-creation-wizard.tsx): what the
  // agent knows, what it says, how it sounds, what it connects to, how it
  // looks — then test it, then put it live.
  const tabs: { key: TabKey; label: string }[] = [
    { key: "knowledge", label: t("agent.configurator.tab.knowledgeBase") },
    { key: "prompt", label: t("agent.configurator.tab.promptLab") },
    { key: "settings", label: t("agent.configurator.tab.settings") },
    { key: "booking", label: t("agent.configurator.tab.booking") },
    // Next to Booking on purpose: both are "connect the system you already run"
    // integrations, and a shop owner looking for one will look where the other is.
    { key: "webshop", label: t("agent.configurator.tab.webshop") },
    // Delivery belongs to the same "connect what you already run" group, and
    // applies to widget and phone agents alike.
    { key: "delivery", label: t("agent.configurator.tab.delivery") },
  ];
  if (!isPhoneType) tabs.push({ key: "customize", label: t("agent.configurator.tab.customizeWidget") });
  tabs.push({ key: "test", label: t("agent.configurator.tab.testAgent") });
  tabs.push(
    isPhoneType
      ? { key: "phone", label: t("agent.configurator.tab.phone") }
      : { key: "embed", label: t("agent.configurator.tab.embedCode") }
  );
  return tabs;
}

function isTabKey(value: string | null, tabs: { key: TabKey; label: string }[]): value is TabKey {
  return tabs.some((tab) => tab.key === value);
}

interface AgentConfiguratorProps {
  initialWidget: WidgetWithExtras;
  llmModels: LLMModel[];
  voiceModels: VoiceModel[];
  embedCodeUnlocked: boolean;
  trialDaysRemaining: number;
  pkg: Package | null;
}

export function AgentConfigurator({
  initialWidget,
  llmModels,
  voiceModels,
  embedCodeUnlocked,
  trialDaysRemaining,
  pkg,
}: AgentConfiguratorProps) {
  const { t } = useTranslation();
  const [widget, setWidget] = useState(initialWidget);
  // The stored type, not the model it happens to run on — a phone agent is a
  // Vapi agent too now (see 0036_agent_type.sql).
  const isPhoneType = widget.agent_type === "phone";
  const tabs = tabsFor(isPhoneType, t);
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<TabKey>(isTabKey(requestedTab, tabs) ? requestedTab : "knowledge");
  // Set by the Stripe return page once the launch offer is paid and the
  // minutes are on the ledger (app/dashboard/checkout/return/page.tsx) — the
  // customer lands here rather than on a Stripe receipt, so this is where
  // they get told it worked.
  const justPaid = searchParams.get("paid") === "1";

  const savePatch: SavePatch = async (patch) => {
    const res = await fetch(`/api/customer/widgets/${widget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });

    if (!res.ok) return false;

    const { widget: updated } = await res.json();
    setWidget((prev) => ({ ...prev, ...updated }));
    return true;
  };

  // On a phone the tab row scrolls sideways; keep the chosen tab in view
  // (Test sits far to the right, and the "Test agenten" button jumps there).
  const tabRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabRowRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [activeTab]);

  const listPath = agentSectionPath(isPhoneType ? "phone" : "widget");

  function selectTab(key: TabKey) {
    setActiveTab(key);
    // Keep the tab in the URL, so a reload — or the link from the agent list
    // straight to Test — lands on the same tab.
    const params = new URLSearchParams(window.location.search);
    params.set("tab", key);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="space-y-3">
        <Link href={listPath} className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-700">
          {isPhoneType ? t("agentFlow.configurator.backToPhoneAgents") : t("agentFlow.configurator.backToAgents")}
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("agent.configurator.title")}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold text-slate-900">{widget.name}</h1>
              <StatusPill active={widget.status === "active"} />
            </div>
          </div>
          {activeTab !== "test" ? (
            <button type="button" onClick={() => selectTab("test")} className={primaryButtonClass}>
              {t("agentFlow.configurator.testNow")}
            </button>
          ) : null}
        </div>
      </div>

      {justPaid ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-semibold text-emerald-800">{t("agent.configurator.paidBannerTitle")}</p>
          <p className="mt-1 text-sm text-emerald-700">
            {t("agent.configurator.paidBannerBody", { minutes: WIDGET_LAUNCH_MINUTES })}
          </p>
        </div>
      ) : null}

      {/* One scrollable row on a phone rather than tabs wrapping into a
          block of three or four lines above the content. */}
      <div ref={tabRowRef} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm sm:w-auto sm:flex-wrap">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => selectTab(tab.key)}
              aria-current={activeTab === tab.key ? "page" : undefined}
              className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition ${
                activeTab === tab.key ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "prompt" ? <PromptLabTab widget={widget} savePatch={savePatch} /> : null}
      {activeTab === "settings" ? (
        <SettingsTab widget={widget} llmModels={llmModels} voiceModels={voiceModels} savePatch={savePatch} />
      ) : null}
      {activeTab === "booking" ? <BookingTab widget={widget} /> : null}
      {activeTab === "webshop" ? <WebshopTab widget={widget} /> : null}
      {activeTab === "delivery" ? <DeliveryTab widget={widget} /> : null}
      {activeTab === "knowledge" ? (
        <KnowledgeBaseTab
          widget={widget}
          onSourcesChange={(knowledgeBase) =>
            setWidget((prev) => ({ ...prev, extra: { ...prev.extra, knowledgeBase } }))
          }
        />
      ) : null}
      {/* A phone agent is tested as a call, not as a chat bubble on a
          simulated web page — that preview is what a website visitor sees,
          and this agent has no website visitors. */}
      {activeTab === "test" ? (
        isPhoneType ? (
          <TestCallTab widget={widget} />
        ) : (
          <TestAgentTab widget={widget} onWidgetChange={(updated) => setWidget((prev) => ({ ...prev, ...updated }))} />
        )
      ) : null}
      {activeTab === "customize" ? <CustomizeWidgetTab widget={widget} savePatch={savePatch} /> : null}
      {activeTab === "embed" ? (
        <EmbedCodeTab
          widget={widget}
          unlocked={embedCodeUnlocked}
          trialDaysRemaining={trialDaysRemaining}
          pkg={pkg}
        />
      ) : null}
      {activeTab === "phone" ? <WizardPhoneStep widget={widget} /> : null}
    </div>
  );
}
