"use client";

import { useState } from "react";
import type { LLMModel, Package, VoiceModel, Widget } from "@/types/database";
import type { AgentCapabilities } from "@/lib/vapi/types";
import { PromptLabTab } from "./agent-tabs/prompt-lab";
import { SettingsTab } from "./agent-tabs/settings-tab";
import { TestAgentTab } from "./agent-tabs/test-agent";
import { CustomizeWidgetTab } from "./agent-tabs/customize-widget";
import { EmbedCodeTab } from "./agent-tabs/embed-code";
import { VoiceAgentTab } from "./agent-tabs/voice-agent";

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
  capabilities?: Partial<AgentCapabilities>;
}

export interface WidgetWithExtras extends Widget {
  shareUrl: string;
  embedSnippet: string;
  extra: WidgetExtra;
}

export type SavePatch = (patch: Record<string, unknown>) => Promise<boolean>;

const TABS = [
  { key: "prompt", label: "Prompt Lab" },
  { key: "settings", label: "Settings" },
  { key: "voice", label: "Voice Agent" },
  { key: "test", label: "Test Agent" },
  { key: "customize", label: "Customise Widget" },
  { key: "embed", label: "Embed Code" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

interface AgentConfiguratorProps {
  initialWidget: WidgetWithExtras;
  llmModels: LLMModel[];
  voiceModels: VoiceModel[];
  embedCodeUnlocked: boolean;
  trialDaysRemaining: number;
  pkg: Package | null;
  // Safe to expose to the browser — see lib/vapi/env.ts. Null when Vapi
  // hasn't been configured for this deployment yet.
  vapiPublicKey: string | null;
}

export function AgentConfigurator({
  initialWidget,
  llmModels,
  voiceModels,
  embedCodeUnlocked,
  trialDaysRemaining,
  pkg,
  vapiPublicKey,
}: AgentConfiguratorProps) {
  const [widget, setWidget] = useState(initialWidget);
  const [activeTab, setActiveTab] = useState<TabKey>("prompt");

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

  async function createOrSyncVapiAgent(patch: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/customer/widgets/${widget.id}/vapi`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });

    if (!res.ok) return false;

    const { widget: updated } = await res.json();
    setWidget((prev) => ({ ...prev, ...updated }));
    return true;
  }

  async function removeVapiAgent(): Promise<boolean> {
    const res = await fetch(`/api/customer/widgets/${widget.id}/vapi`, { method: "DELETE" });
    if (!res.ok) return false;

    const { widget: updated } = await res.json();
    setWidget((prev) => ({ ...prev, ...updated }));
    return true;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Configure Agent</h1>
        <p className="mt-1 text-sm text-slate-500">{widget.name}</p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {TABS.map((tab) => (
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
      {activeTab === "voice" ? (
        <VoiceAgentTab widget={widget} createOrSyncVapiAgent={createOrSyncVapiAgent} removeVapiAgent={removeVapiAgent} />
      ) : null}
      {activeTab === "test" ? <TestAgentTab widget={widget} vapiPublicKey={vapiPublicKey} /> : null}
      {activeTab === "customize" ? <CustomizeWidgetTab widget={widget} savePatch={savePatch} /> : null}
      {activeTab === "embed" ? (
        <EmbedCodeTab
          widget={widget}
          unlocked={embedCodeUnlocked}
          trialDaysRemaining={trialDaysRemaining}
          pkg={pkg}
          vapiPublicKey={vapiPublicKey}
        />
      ) : null}
    </div>
  );
}
