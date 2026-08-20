"use client";

import { useState } from "react";
import type { LLMModel, VoiceModel } from "@/types/database";
import type { SavePatch, WidgetWithExtras } from "../agent-configurator";
import { useTranslation } from "@/components/i18n/language-provider";

// Deliberately a smaller picker than the full Settings tab (which also
// carries a page of "Coming soon" fields) — the creation wizard is meant to
// be the "very simple steps" first-run experience; every other Settings
// field stays reachable afterwards on the full agent config page.
export function WizardVoiceStep({
  widget,
  llmModels,
  voiceModels,
  savePatch,
  onNext,
}: {
  widget: WidgetWithExtras;
  llmModels: LLMModel[];
  voiceModels: VoiceModel[];
  savePatch: SavePatch;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const isVapiModel = llmModels.find((m) => m.id === widget.llm_model_id)?.provider === "vapi";
  const [voiceModelId, setVoiceModelId] = useState(widget.voice_model_id ?? "");
  const [voiceGender, setVoiceGender] = useState<"male" | "female">(widget.extra.voiceGender ?? "female");
  const [language, setLanguage] = useState(widget.language);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setSaving(true);
    setError(null);
    const ok = await savePatch(
      isVapiModel ? { language, extra: { voiceGender } } : { voiceModelId: voiceModelId || null, language }
    );
    setSaving(false);
    if (!ok) {
      setError(`${t("common.saveFailed")} ${t("common.tryAgain")}`);
      return;
    }
    onNext();
  }

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t("agent.wizardVoice.title")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{t("agent.wizardVoice.description")}</p>
      </div>

      {isVapiModel ? (
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">{t("agent.wizardVoice.voiceLabel")}</span>
          <div className="grid grid-cols-2 gap-3">
            {(["female", "male"] as const).map((gender) => (
              <button
                key={gender}
                type="button"
                onClick={() => setVoiceGender(gender)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  voiceGender === gender
                    ? "border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500"
                    : "border-slate-300 text-slate-600 hover:border-slate-400"
                }`}
              >
                {gender === "female" ? t("agent.wizardVoice.voiceFemale") : t("agent.wizardVoice.voiceMale")}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <label htmlFor="wizard-voice-model" className="mb-1 block text-sm font-medium text-slate-700">
            {t("agent.wizardVoice.voiceLabel")}
          </label>
          <select
            id="wizard-voice-model"
            value={voiceModelId}
            onChange={(e) => setVoiceModelId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            <option value="">{t("agent.wizardVoice.noneSelectedDefault")}</option>
            {voiceModels.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name} ({voice.language})
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="wizard-language" className="mb-1 block text-sm font-medium text-slate-700">
          {t("agent.wizardVoice.languageLabel")}
        </label>
        <select
          id="wizard-language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        >
          <option value="da">{t("agent.wizardVoice.languageDanish")}</option>
          <option value="en">{t("agent.wizardVoice.languageEnglish")}</option>
        </select>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="button"
        onClick={handleContinue}
        disabled={saving}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {saving ? t("common.saving") : t("agent.wizard.nextArrow")}
      </button>
    </div>
  );
}
