"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LLMModel, Package, VoiceModel } from "@/types/database";
import type { SavePatch, WidgetWithExtras } from "./agent-configurator";
import { PromptLabTab } from "./agent-tabs/prompt-lab";
import { WizardVoiceStep } from "./agent-tabs/wizard-voice-step";
import { EmbedCodeTab } from "./agent-tabs/embed-code";
import { WizardPhoneStep } from "./agent-tabs/wizard-phone-step";

type AgentType = "widget" | "phone";

const TYPE_OPTIONS: {
  value: AgentType;
  title: string;
  description: string;
  provider: "vapi" | "anthropic";
}[] = [
  {
    value: "widget",
    title: "Voice Widget",
    description: "En chat-/stemme-widget til jeres hjemmeside — besøgende taler direkte med agenten i browseren.",
    provider: "vapi",
  },
  {
    value: "phone",
    title: "Telefon (Inbound/Outbound)",
    description: "Agenten besvarer og/eller foretager opkald via jeres telefonnummer — forbindes med Twilio.",
    provider: "anthropic",
  },
];

function stepsFor(agentType: AgentType | null) {
  const lastStep = agentType === "phone" ? "Telefonnummer" : "Embed-kode";
  return ["Navn & type", "Prompt", "Stemme", lastStep] as const;
}

interface AgentCreationWizardProps {
  llmModels: LLMModel[];
  voiceModels: VoiceModel[];
  embedCodeUnlocked: boolean;
  trialDaysRemaining: number;
  pkg: Package | null;
  onCancel: () => void;
  onComplete: (widget: WidgetWithExtras) => void;
}

function StepProgress({ step, steps }: { step: number; steps: readonly string[] }) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((label, i) => (
        <div key={label} className="flex flex-1 items-center gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                i < step
                  ? "bg-emerald-500 text-white"
                  : i === step
                    ? "bg-brand-600 text-white"
                    : "bg-slate-100 text-slate-400"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </span>
            <span className={`hidden text-xs font-medium sm:inline ${i === step ? "text-slate-900" : "text-slate-400"}`}>
              {label}
            </span>
          </div>
          {i < steps.length - 1 ? <div className={`h-px flex-1 ${i < step ? "bg-emerald-500" : "bg-slate-200"}`} /> : null}
        </div>
      ))}
    </div>
  );
}

// The first-run "very simple steps" flow: create the agent, then walk it
// through prompt -> voice -> embed code one screen at a time, reusing the
// same tab components (PromptLabTab, EmbedCodeTab) the full agent config
// page uses later — a widget saved mid-wizard is exactly as valid/complete
// as one saved from the tabs, so abandoning partway never leaves anything
// broken, just unfinished.
export function AgentCreationWizard({
  llmModels,
  voiceModels,
  embedCodeUnlocked,
  trialDaysRemaining,
  pkg,
  onCancel,
  onComplete,
}: AgentCreationWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [widget, setWidget] = useState<WidgetWithExtras | null>(null);

  const [name, setName] = useState("");
  const [agentType, setAgentType] = useState<AgentType | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steps = stepsFor(agentType);

  const savePatch: SavePatch = async (patch) => {
    if (!widget) return false;
    const res = await fetch(`/api/customer/widgets/${widget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return false;
    const { widget: updated } = await res.json();
    setWidget((prev) => (prev ? { ...prev, ...updated } : prev));
    return true;
  };

  async function handleCreate() {
    if (!name.trim()) {
      setError("Angiv et navn til agenten.");
      return;
    }
    if (!agentType) {
      setError("Vælg om agenten er en Voice Widget eller til Telefon.");
      return;
    }
    const provider = TYPE_OPTIONS.find((t) => t.value === agentType)!.provider;
    const selectedModelId = llmModels.find((m) => m.provider === provider)?.id ?? null;
    if (!selectedModelId) {
      setError("Ingen model tilgængelig for den valgte type endnu. Kontakt support.");
      return;
    }

    setCreating(true);
    setError(null);

    const res = await fetch("/api/customer/widgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), llmModelId: selectedModelId }),
    });

    setCreating(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? "Kunne ikke oprette agenten. Prøv igen.");
      return;
    }

    const { widget: created } = await res.json();
    setWidget({ ...created, extra: {} });
    setStep(1);
  }

  function handleFinish() {
    if (!widget) return;
    onComplete(widget);
    router.push(`/dashboard/agent/${widget.id}`);
  }

  return (
    <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <StepProgress step={step} steps={steps} />

      {step === 0 ? (
        <div className="space-y-4">
          <div>
            <label htmlFor="agent-name" className="mb-1 block text-sm font-medium text-slate-700">
              Agent Name
            </label>
            <input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Fx Reception – Hovedbutik"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Hvad skal agenten bruges til?</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAgentType(option.value)}
                  className={`rounded-xl border p-4 text-left transition ${
                    agentType === option.value
                      ? "border-brand-500 ring-1 ring-brand-500"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <p className="text-sm font-semibold text-slate-800">{option.title}</p>
                  <p className="mt-1 text-xs text-slate-500">{option.description}</p>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Resten af opsætningen tilpasses automatisk efter jeres valg — I skal ikke selv vælge teknisk model.
            </p>
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Annuller
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating || !agentType}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {creating ? "Opretter…" : "Næste →"}
            </button>
          </div>
        </div>
      ) : null}

      {step === 1 && widget ? (
        <div className="space-y-4">
          <PromptLabTab widget={widget} savePatch={savePatch} />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Spring over
            </button>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Næste →
            </button>
          </div>
        </div>
      ) : null}

      {step === 2 && widget ? (
        <div className="space-y-4">
          <WizardVoiceStep widget={widget} voiceModels={voiceModels} savePatch={savePatch} onNext={() => setStep(3)} />
          <button
            type="button"
            onClick={() => setStep(3)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Spring over
          </button>
        </div>
      ) : null}

      {step === 3 && widget ? (
        <div className="space-y-4">
          {agentType === "phone" ? (
            <WizardPhoneStep widget={widget} />
          ) : (
            <EmbedCodeTab widget={widget} unlocked={embedCodeUnlocked} trialDaysRemaining={trialDaysRemaining} pkg={pkg} />
          )}
          <button
            type="button"
            onClick={handleFinish}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Fuldfør — gå til agenten →
          </button>
        </div>
      ) : null}
    </div>
  );
}
