"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { LLMModel, Package, VoiceModel, Widget } from "@/types/database";
import type { WidgetWithExtras } from "./agent-configurator";
import { AgentCreationWizard } from "./agent-creation-wizard";

interface AgentsManagerProps {
  initialWidgets: Widget[];
  llmModels: LLMModel[];
  voiceModels: VoiceModel[];
  embedCodeUnlocked: boolean;
  trialDaysRemaining: number;
  pkg: Package | null;
}

export function AgentsManager({
  initialWidgets,
  llmModels,
  voiceModels,
  embedCodeUnlocked,
  trialDaysRemaining,
  pkg,
}: AgentsManagerProps) {
  const [widgets, setWidgets] = useState(initialWidgets);
  const [showWizard, setShowWizard] = useState(initialWidgets.length === 0);
  const [search, setSearch] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const filteredWidgets = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return widgets;
    return widgets.filter((w) => w.name.toLowerCase().includes(query));
  }, [widgets, search]);

  function handleWizardComplete(created: WidgetWithExtras) {
    setWidgets((prev) => [created, ...prev]);
    setShowWizard(false);
  }

  async function handleToggleStatus(widget: Widget) {
    setTogglingId(widget.id);
    const nextStatus = widget.status === "active" ? "paused" : "active";

    const res = await fetch(`/api/customer/widgets/${widget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });

    setTogglingId(null);

    if (res.ok) {
      setWidgets((prev) => prev.map((w) => (w.id === widget.id ? { ...w, status: nextStatus } : w)));
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">AI Agents</h1>
          <p className="mt-1 text-sm text-slate-500">Administrer og opret jeres AI-assistenter</p>
        </div>
        {!showWizard ? (
          <button
            type="button"
            onClick={() => setShowWizard(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + Ny agent
          </button>
        ) : null}
      </div>

      {showWizard ? (
        <AgentCreationWizard
          llmModels={llmModels}
          voiceModels={voiceModels}
          embedCodeUnlocked={embedCodeUnlocked}
          trialDaysRemaining={trialDaysRemaining}
          pkg={pkg}
          onCancel={() => setShowWizard(false)}
          onComplete={handleWizardComplete}
        />
      ) : null}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Dine agenter</h2>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Søg efter agent-navn…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />

        {filteredWidgets.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Ingen agenter fundet.
          </div>
        ) : (
          <ul className="space-y-3">
            {filteredWidgets.map((widget) => (
              <li
                key={widget.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <Link href={`/dashboard/agent/${widget.id}`} className="flex-1">
                  <p className="text-sm font-semibold text-slate-800">{widget.name}</p>
                  <p className="text-xs text-slate-500">
                    Oprettet {new Date(widget.created_at).toLocaleDateString("da-DK")}
                  </p>
                </Link>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-slate-500">
                    {widget.status === "active" ? "Aktiv" : "Sat på pause"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={widget.status === "active"}
                    disabled={togglingId === widget.id}
                    onClick={() => handleToggleStatus(widget)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                      widget.status === "active" ? "bg-emerald-500" : "bg-slate-300"
                    } disabled:opacity-60`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                        widget.status === "active" ? "left-5" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
