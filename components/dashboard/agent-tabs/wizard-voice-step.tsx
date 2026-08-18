"use client";

import { useState } from "react";
import type { VoiceModel } from "@/types/database";
import type { SavePatch, WidgetWithExtras } from "../agent-configurator";

// Deliberately a smaller picker than the full Settings tab (which also
// carries a page of "Coming soon" fields) — the creation wizard is meant to
// be the "very simple steps" first-run experience; every other Settings
// field stays reachable afterwards on the full agent config page.
export function WizardVoiceStep({
  widget,
  voiceModels,
  savePatch,
  onNext,
}: {
  widget: WidgetWithExtras;
  voiceModels: VoiceModel[];
  savePatch: SavePatch;
  onNext: () => void;
}) {
  const [voiceModelId, setVoiceModelId] = useState(widget.voice_model_id ?? "");
  const [language, setLanguage] = useState(widget.language);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setSaving(true);
    setError(null);
    const ok = await savePatch({ voiceModelId: voiceModelId || null, language });
    setSaving(false);
    if (!ok) {
      setError("Kunne ikke gemme. Prøv igen.");
      return;
    }
    onNext();
  }

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Stemme &amp; sprog</h2>
        <p className="mt-1 text-sm text-slate-500">Vælg den stemme jeres agent skal tale med.</p>
      </div>

      <div>
        <label htmlFor="wizard-voice-model" className="mb-1 block text-sm font-medium text-slate-700">
          Stemme
        </label>
        <select
          id="wizard-voice-model"
          value={voiceModelId}
          onChange={(e) => setVoiceModelId(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        >
          <option value="">Ingen valgt (brug standard)</option>
          {voiceModels.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.name} ({voice.language})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="wizard-language" className="mb-1 block text-sm font-medium text-slate-700">
          Sprog
        </label>
        <select
          id="wizard-language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        >
          <option value="da">Dansk</option>
          <option value="en">Engelsk</option>
        </select>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="button"
        onClick={handleContinue}
        disabled={saving}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {saving ? "Gemmer…" : "Næste →"}
      </button>
    </div>
  );
}
