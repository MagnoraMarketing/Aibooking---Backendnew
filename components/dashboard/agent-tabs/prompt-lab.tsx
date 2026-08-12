"use client";

import { useState } from "react";
import type { SavePatch, WidgetWithExtras } from "../agent-configurator";

const EXAMPLE_PROMPT = `Du er AI-receptionist for [virksomhedsnavn]. Du hjælper besøgende med at booke tid, besvarer spørgsmål om åbningstider og priser, og taler naturligt og venligt på dansk.

Hvis du ikke kender svaret på noget, må du ikke opfinde information — bed i stedet kunden om at kontakte virksomheden direkte.`;

export function PromptLabTab({ widget, savePatch }: { widget: WidgetWithExtras; savePatch: SavePatch }) {
  const [systemPrompt, setSystemPrompt] = useState(widget.system_prompt ?? "");
  const [welcomeMessage, setWelcomeMessage] = useState(widget.welcome_message ?? "");
  const [openingMessage, setOpeningMessage] = useState(widget.opening_message ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  async function handleSave() {
    setSaving(true);
    setStatus("idle");
    const ok = await savePatch({ systemPrompt, welcomeMessage, openingMessage });
    setSaving(false);
    setStatus(ok ? "saved" : "error");
  }

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor="system-prompt" className="text-sm font-medium text-slate-700">
            System-prompt
          </label>
          <button
            type="button"
            onClick={() => setSystemPrompt(EXAMPLE_PROMPT)}
            className="text-xs font-medium text-brand-600 hover:text-brand-700"
          >
            Indsæt eksempel
          </button>
        </div>
        <textarea
          id="system-prompt"
          rows={8}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder={EXAMPLE_PROMPT}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div>
        <label htmlFor="welcome-message" className="mb-1 block text-sm font-medium text-slate-700">
          Velkomstbesked
        </label>
        <input
          id="welcome-message"
          value={welcomeMessage}
          onChange={(e) => setWelcomeMessage(e.target.value)}
          placeholder="Hej! Hvordan kan jeg hjælpe dig i dag?"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div>
        <label htmlFor="opening-message" className="mb-1 block text-sm font-medium text-slate-700">
          Åbningsbesked (talt)
        </label>
        <input
          id="opening-message"
          value={openingMessage}
          onChange={(e) => setOpeningMessage(e.target.value)}
          placeholder="Goddag, du taler med AI-assistenten. Hvad kan jeg hjælpe med?"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? "Gemmer…" : "Gem"}
        </button>
        {status === "saved" ? <span className="text-sm text-emerald-600">Gemt.</span> : null}
        {status === "error" ? <span className="text-sm text-red-600">Kunne ikke gemme.</span> : null}
      </div>
    </div>
  );
}
