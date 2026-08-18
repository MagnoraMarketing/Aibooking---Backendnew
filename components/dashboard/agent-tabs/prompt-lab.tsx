"use client";

import { useState } from "react";
import type { SavePatch, WidgetWithExtras } from "../agent-configurator";

export function PromptLabTab({ widget, savePatch }: { widget: WidgetWithExtras; savePatch: SavePatch }) {
  const [systemPrompt, setSystemPrompt] = useState(widget.system_prompt ?? "");
  const [welcomeMessage, setWelcomeMessage] = useState(widget.welcome_message ?? "");
  const [openingMessage, setOpeningMessage] = useState(widget.opening_message ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  const [businessDescription, setBusinessDescription] = useState("");
  const [keyServices, setKeyServices] = useState("");
  const [openingHours, setOpeningHours] = useState("");
  const [otherNotes, setOtherNotes] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setStatus("idle");
    const ok = await savePatch({ systemPrompt, welcomeMessage, openingMessage });
    setSaving(false);
    setStatus(ok ? "saved" : "error");
  }

  async function handleGenerate() {
    if (!businessDescription.trim()) {
      setGenerateError("Udfyld i det mindste hvad virksomheden laver.");
      return;
    }
    setGenerating(true);
    setGenerateError(null);

    const res = await fetch(`/api/customer/widgets/${widget.id}/generate-prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessDescription, keyServices, openingHours, otherNotes }),
    });

    setGenerating(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setGenerateError(
        data?.error?.message
          ? `Kunne ikke generere en prompt: ${data.error.message}`
          : "Kunne ikke generere en prompt. Prøv igen, eller skriv den selv nedenfor."
      );
      return;
    }

    const data = await res.json();
    setSystemPrompt(data.systemPrompt);
  }

  return (
    <div className="space-y-5">
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Basisoplysninger</h2>
          <p className="mt-1 text-sm text-slate-500">
            Svar kort på nogle få spørgsmål om jeres virksomhed, så AI&apos;en kan skrive et udkast til jeres
            AI-receptionist. I kan altid redigere resultatet manuelt bagefter.
          </p>
        </div>

        <div>
          <label htmlFor="business-description" className="mb-1 block text-sm font-medium text-slate-700">
            Hvad laver virksomheden?
          </label>
          <input
            id="business-description"
            value={businessDescription}
            onChange={(e) => setBusinessDescription(e.target.value)}
            placeholder="Fx frisørsalon i København med klip, farvning og styling"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="key-services" className="mb-1 block text-sm font-medium text-slate-700">
              Vigtigste ydelser/produkter
            </label>
            <input
              id="key-services"
              value={keyServices}
              onChange={(e) => setKeyServices(e.target.value)}
              placeholder="Fx klipning, farvning, brudestyling"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label htmlFor="opening-hours" className="mb-1 block text-sm font-medium text-slate-700">
              Åbningstider
            </label>
            <input
              id="opening-hours"
              value={openingHours}
              onChange={(e) => setOpeningHours(e.target.value)}
              placeholder="Fx man-fre 9-18, lør 10-14"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>

        <div>
          <label htmlFor="other-notes" className="mb-1 block text-sm font-medium text-slate-700">
            Andet vigtigt at vide
          </label>
          <input
            id="other-notes"
            value={otherNotes}
            onChange={(e) => setOtherNotes(e.target.value)}
            placeholder="Fx husk at spørge om telefonnummer ved booking"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>

        {generateError ? <p className="text-sm text-red-600">{generateError}</p> : null}

        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {generating ? "Genererer…" : "Generér prompt"}
        </button>
      </div>

      <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <label htmlFor="system-prompt" className="mb-1 block text-sm font-medium text-slate-700">
            System-prompt
          </label>
          <textarea
            id="system-prompt"
            rows={8}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Udfyld basisoplysningerne ovenfor og klik Generér prompt, eller skriv jeres egen her."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
          <p className="mt-1 text-xs text-slate-500">
            Genereret af AI ud fra basisoplysningerne — I kan altid redigere teksten manuelt her.
          </p>
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
    </div>
  );
}
