"use client";

import { useState } from "react";
import type { LLMModel, VoiceModel } from "@/types/database";
import type { SavePatch, WidgetWithExtras } from "../agent-configurator";
import { ComingSoonField } from "../coming-soon-field";
import { ToggleSwitch } from "../toggle-switch";
import { SUPPORTED_LANGUAGES } from "@/lib/widgets/languages";

interface SettingsTabProps {
  widget: WidgetWithExtras;
  llmModels: LLMModel[];
  voiceModels: VoiceModel[];
  savePatch: SavePatch;
}

export function SettingsTab({ widget, llmModels, voiceModels, savePatch }: SettingsTabProps) {
  const [voiceModelId, setVoiceModelId] = useState(widget.voice_model_id ?? "");
  const [llmModelId, setLlmModelId] = useState(widget.llm_model_id ?? "");
  const [language, setLanguage] = useState(widget.language);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  async function handleSave() {
    setSaving(true);
    setStatus("idle");
    const ok = await savePatch({
      voiceModelId: voiceModelId || null,
      llmModelId: llmModelId || null,
      language,
    });
    setSaving(false);
    setStatus(ok ? "saved" : "error");
  }

  return (
    <div className="space-y-6">
      <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Stemme &amp; sprog</h2>

        <div>
          <label htmlFor="voice-model" className="mb-1 block text-sm font-medium text-slate-700">
            Stemme
          </label>
          <select
            id="voice-model"
            value={voiceModelId}
            onChange={(e) => setVoiceModelId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Ingen valgt</option>
            {voiceModels.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name} ({voice.language})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="llm-model" className="mb-1 block text-sm font-medium text-slate-700">
            Model
          </label>
          <select
            id="llm-model"
            value={llmModelId}
            onChange={(e) => setLlmModelId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Ingen valgt</option>
            {llmModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.display_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="language" className="mb-1 block text-sm font-medium text-slate-700">
            Sprog
          </label>
          <select
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>

        <ToggleSwitch
          label="Gem opsummering"
          description="Samtaler opsummeres og gemmes altid automatisk i denne udgave."
          checked
          disabled
        />

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

      <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Videre funktioner</h2>

        <ComingSoonField label="Knowledge Base">
          <select disabled className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <option>Vælg for at tilføje…</option>
          </select>
        </ComingSoonField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ComingSoonField label="Automatisk afslut opkald" />
          <ComingSoonField label="Spørg om kundeoplysninger" />
        </div>

        <ComingSoonField label="Post Call Analysis Schema / Tags">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-400">
            Ingen felter tilføjet endnu.
          </div>
        </ComingSoonField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ComingSoonField label="Kalender-tidszone">
            <select disabled className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <option>UTC</option>
            </select>
          </ComingSoonField>
          <ComingSoonField label="Cal.com Event ID" />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ComingSoonField label="Afslut opkald ved stilhed (sekunder)">
            <input disabled type="range" className="w-full" />
          </ComingSoonField>
          <ComingSoonField label="Maks. varighed (minutter)">
            <input disabled type="range" className="w-full" />
          </ComingSoonField>
        </div>

        <ComingSoonField label="LeadConnector">
          <button
            type="button"
            disabled
            className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-400"
          >
            Forbind LeadConnector
          </button>
        </ComingSoonField>
      </div>
    </div>
  );
}
