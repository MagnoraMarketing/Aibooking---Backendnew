"use client";

import { useEffect, useState } from "react";
import type { LLMModel, VoiceModel } from "@/types/database";
import type { SavePatch, WidgetWithExtras } from "../agent-configurator";
import { ComingSoonField } from "../coming-soon-field";
import { ToggleSwitch } from "../toggle-switch";
import { useTranslation } from "@/components/i18n/language-provider";

interface SettingsTabProps {
  widget: WidgetWithExtras;
  llmModels: LLMModel[];
  voiceModels: VoiceModel[];
  savePatch: SavePatch;
}

export function SettingsTab({ widget, llmModels, voiceModels, savePatch }: SettingsTabProps) {
  const { t } = useTranslation();
  const [voiceModelId, setVoiceModelId] = useState(widget.voice_model_id ?? "");
  const [voiceGender, setVoiceGender] = useState<"male" | "female">(widget.extra.voiceGender ?? "female");
  const [llmModelId, setLlmModelId] = useState(widget.llm_model_id ?? "");
  const [language, setLanguage] = useState(widget.language);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  // Picks up a gender auto-defaulted server-side after save (e.g. the
  // model was just switched to Vapi) — the state's initial value only
  // reflects widget.extra at first render.
  useEffect(() => {
    setVoiceGender(widget.extra.voiceGender ?? "female");
  }, [widget.extra.voiceGender]);

  const selectedModel = llmModels.find((model) => model.id === llmModelId);
  const isVapiModel = selectedModel?.provider === "vapi";

  async function handleSave() {
    setSaving(true);
    setStatus("idle");
    const ok = await savePatch(
      isVapiModel
        ? { llmModelId: llmModelId || null, language, extra: { voiceGender } }
        : { voiceModelId: voiceModelId || null, llmModelId: llmModelId || null, language }
    );
    setSaving(false);
    setStatus(ok ? "saved" : "error");
  }

  return (
    <div className="space-y-6">
      <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t("agent.settings.voiceLanguageTitle")}
        </h2>

        {isVapiModel ? (
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">{t("agent.settings.voiceLabel")}</span>
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
                  {gender === "female" ? t("agent.settings.voiceFemale") : t("agent.settings.voiceMale")}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor="voice-model" className="mb-1 block text-sm font-medium text-slate-700">
              {t("agent.settings.voiceLabel")}
            </label>
            <select
              id="voice-model"
              value={voiceModelId}
              onChange={(e) => setVoiceModelId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            >
              <option value="">{t("common.noneSelected")}</option>
              {voiceModels.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name} ({voice.language})
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label htmlFor="llm-model" className="mb-1 block text-sm font-medium text-slate-700">
            {t("agent.settings.modelLabel")}
          </label>
          <select
            id="llm-model"
            value={llmModelId}
            onChange={(e) => setLlmModelId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            <option value="">{t("common.noneSelected")}</option>
            {llmModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.display_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="language" className="mb-1 block text-sm font-medium text-slate-700">
            {t("agent.settings.languageLabel")}
          </label>
          <select
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            <option value="da">{t("agent.settings.languageDanish")}</option>
            <option value="en">{t("agent.settings.languageEnglish")}</option>
          </select>
        </div>

        <ToggleSwitch
          label={t("agent.settings.saveSummaryLabel")}
          description={t("agent.settings.saveSummaryDescription")}
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
            {saving ? t("common.saving") : t("common.save")}
          </button>
          {status === "saved" ? <span className="text-sm text-emerald-600">{t("common.saved")}</span> : null}
          {status === "error" ? <span className="text-sm text-red-600">{t("common.saveFailed")}</span> : null}
        </div>
      </div>

      <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t("agent.settings.advancedFeaturesTitle")}
        </h2>

        <ComingSoonField label={t("agent.settings.knowledgeBaseComingSoon")}>
          <select disabled className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <option>{t("agent.settings.selectToAddPlaceholder")}</option>
          </select>
        </ComingSoonField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ComingSoonField label={t("agent.settings.autoEndCallLabel")} />
          <ComingSoonField label={t("agent.settings.askCustomerInfoLabel")} />
        </div>

        <ComingSoonField label={t("agent.settings.postCallAnalysisLabel")}>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-400">
            {t("agent.settings.noFieldsAddedYet")}
          </div>
        </ComingSoonField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ComingSoonField label={t("agent.settings.calendarTimezoneLabel")}>
            <select disabled className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <option>UTC</option>
            </select>
          </ComingSoonField>
          <ComingSoonField label={t("agent.settings.calComEventIdLabel")} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ComingSoonField label={t("agent.settings.endCallOnSilenceLabel")}>
            <input disabled type="range" className="w-full" />
          </ComingSoonField>
          <ComingSoonField label={t("agent.settings.maxDurationLabel")}>
            <input disabled type="range" className="w-full" />
          </ComingSoonField>
        </div>

        <ComingSoonField label={t("agent.settings.leadConnectorLabel")}>
          <button
            type="button"
            disabled
            className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-400"
          >
            {t("agent.settings.connectLeadConnectorButton")}
          </button>
        </ComingSoonField>
      </div>
    </div>
  );
}
