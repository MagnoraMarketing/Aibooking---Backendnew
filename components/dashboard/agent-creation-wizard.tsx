"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LLMModel, Package, VoiceModel } from "@/types/database";
import type { SavePatch, WidgetWithExtras } from "./agent-configurator";
import { PromptLabTab } from "./agent-tabs/prompt-lab";
import { WizardVoiceStep } from "./agent-tabs/wizard-voice-step";
import { EmbedCodeTab } from "./agent-tabs/embed-code";

const STEPS = ["Navn & model", "Prompt", "Stemme", "Embed-kode"] as const;

interface AgentCreationWizardProps {
  llmModels: LLMModel[];
  voiceModels: VoiceModel[];
  embedCodeUnlocked: boolean;
  trialDaysRemaining: number;
  pkg: Package | null;
  onCancel: () => void;
  onComplete: (widget: WidgetWithExtras) => void;
}

function StepProgress({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((label, i) => (
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
          {i < STEPS.length - 1 ? <div className={`h-px flex-1 ${i < step ? "bg-emerald-500" : "bg-slate-200"}`} /> : null}
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
  const [selectedModelId, setSelectedModelId] = useState<string | null>(
    llmModels.find((m) => m.is_default)?.id ?? llmModels[0]?.id ?? null
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <StepProgress step={step} />

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
            <p className="mb-2 text-sm font-medium text-slate-700">Model</p>
            {llmModels.length === 0 ? (
              <p className="text-sm text-slate-500">Ingen modeller tilgængelige endnu.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {llmModels.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setSelectedModelId(model.id)}
                    className={`rounded-xl border p-4 text-left transition ${
                      selectedModelId === model.id
                        ? "border-brand-500 ring-1 ring-brand-500"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-800">{model.display_name}</p>
                    {model.is_default ? (
                      <span className="mt-1 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-600">
                        Anbefalet
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
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
              disabled={creating}
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
          <EmbedCodeTab widget={widget} unlocked={embedCodeUnlocked} trialDaysRemaining={trialDaysRemaining} pkg={pkg} />
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
