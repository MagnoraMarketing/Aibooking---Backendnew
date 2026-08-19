"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { LLMModel, Package, VoiceModel, Widget } from "@/types/database";
import type { KnowledgeBaseSource } from "@/lib/knowledge-base/types";
import { useTranslation } from "@/components/i18n/language-provider";
import { PromptLabTab } from "./agent-tabs/prompt-lab";
import { SettingsTab } from "./agent-tabs/settings-tab";
import { TestAgentTab } from "./agent-tabs/test-agent";
import { CustomizeWidgetTab } from "./agent-tabs/customize-widget";
import { EmbedCodeTab } from "./agent-tabs/embed-code";
import { KnowledgeBaseTab } from "./agent-tabs/knowledge-base-tab";
import { WizardPhoneStep } from "./agent-tabs/wizard-phone-step";

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
  voiceGender?: "male" | "female" | null;
  knowledgeBase?: KnowledgeBaseSource[];
}

export interface WidgetWithExtras extends Widget {
  shareUrl: string;
  embedSnippet: string;
  extra: WidgetExtra;
}

export type SavePatch = (patch: Record<string, unknown>) => Promise<boolean>;

type TabKey = "prompt" | "settings" | "knowledge" | "customize" | "test" | "embed" | "phone";

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
  const tabs: { key: TabKey; label: string }[] = [
    { key: "prompt", label: t("agent.configurator.tab.promptLab") },
    { key: "settings", label: t("agent.configurator.tab.settings") },
    { key: "knowledge", label: t("agent.configurator.tab.knowledgeBase") },
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
  const isPhoneType = llmModels.find((m) => m.id === widget.llm_model_id)?.provider === "anthropic";
  const tabs = tabsFor(isPhoneType, t);
  const requestedTab = useSearchParams().get("tab");
  const [activeTab, setActiveTab] = useState<TabKey>(isTabKey(requestedTab, tabs) ? requestedTab : "prompt");

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t("agent.configurator.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{widget.name}</p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeTab === tab.key ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "prompt" ? <PromptLabTab widget={widget} savePatch={savePatch} /> : null}
      {activeTab === "settings" ? (
        <SettingsTab widget={widget} llmModels={llmModels} voiceModels={voiceModels} savePatch={savePatch} />
      ) : null}
      {activeTab === "knowledge" ? (
        <KnowledgeBaseTab
          widget={widget}
          onSourcesChange={(knowledgeBase) =>
            setWidget((prev) => ({ ...prev, extra: { ...prev.extra, knowledgeBase } }))
          }
        />
      ) : null}
      {activeTab === "test" ? <TestAgentTab widget={widget} /> : null}
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
