"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { LLMModel, Widget } from "@/types/database";

interface AgentsManagerProps {
  initialWidgets: Widget[];
  llmModels: LLMModel[];
}

export function AgentsManager({ initialWidgets, llmModels }: AgentsManagerProps) {
  const router = useRouter();
  const [widgets, setWidgets] = useState(initialWidgets);
  const [showCreateForm, setShowCreateForm] = useState(initialWidgets.length === 0);
  const [name, setName] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(
    llmModels.find((m) => m.is_default)?.id ?? llmModels[0]?.id ?? null
  );
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const filteredWidgets = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return widgets;
    return widgets.filter((w) => w.name.toLowerCase().includes(query));
  }, [widgets, search]);

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
      setError("Kunne ikke oprette agenten. Prøv igen.");
      return;
    }

    const { widget } = await res.json();
    router.push(`/dashboard/agent/${widget.id}`);
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
        {!showCreateForm ? (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + Ny agent
          </button>
        ) : null}
      </div>

      {showCreateForm ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
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

          <div className="mb-4">
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

          {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

          <div className="flex gap-3">
            {widgets.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Annuller
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {creating ? "Opretter…" : "Opret agent →"}
            </button>
          </div>
        </div>
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
