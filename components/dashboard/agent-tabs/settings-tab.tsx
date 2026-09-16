"use client";

import { useEffect, useState } from "react";
import type { LLMModel, VoiceModel } from "@/types/database";
import type { SavePatch, WidgetWithExtras } from "../agent-configurator";
import { ComingSoonField } from "../coming-soon-field";
import { ToggleSwitch } from "../toggle-switch";
import { useTranslation } from "@/components/i18n/language-provider";
import { DEFAULT_VOICE_GENDER } from "@/lib/vapi/voice-gender";

interface SettingsTabProps {
  widget: WidgetWithExtras;
  llmModels: LLMModel[];
  voiceModels: VoiceModel[];
  savePatch: SavePatch;
}

export function SettingsTab({ widget, llmModels, voiceModels, savePatch }: SettingsTabProps) {
  const { t } = useTranslation();
  const [voiceModelId, setVoiceModelId] = useState(widget.voice_model_id ?? "");
  const [voiceGender, setVoiceGender] = useState<"male" | "female">(widget.extra.voiceGender ?? DEFAULT_VOICE_GENDER);
  const [language, setLanguage] = useState(widget.language);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  // Vapi's own floor is 10s / 10s; the ceilings here are the useful range for
  // a website agent, well inside what the API accepts.
  const [silenceTimeout, setSilenceTimeout] = useState(widget.extra.silenceTimeoutSeconds ?? 30);
  const [maxDuration, setMaxDuration] = useState(widget.extra.maxDurationSeconds ?? 600);
  // A separate Vapi assistant for outbound campaign calls. Placing a call is
  // not the same conversation as answering one, and this one is written by
  // hand in Vapi — we never sync over it (see lib/vapi/assistant-owner.ts).
  const [outboundAssistant, setOutboundAssistant] = useState(widget.extra.vapiOutboundAssistantId ?? "");
  // The booking connection is configured under the Booking tab; shown here
  // read-only so this page tells the truth about what the agent is set to
  // instead of offering a second, competing input for the same thing.
  const [booking, setBooking] = useState<{ eventTypeId: string | null; timezone: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/customer/calendar");
      if (!res.ok) return;
      const data = await res.json();
      const own = (data.connections as
        | { widget_id: string; provider: string; calcom_event_type_id: string | null; calcom_timezone: string | null }[]
        | undefined)?.find((c) => c.widget_id === widget.id && c.provider === "calcom");
      if (!cancelled) {
        setBooking(own ? { eventTypeId: own.calcom_event_type_id, timezone: own.calcom_timezone } : null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [widget.id]);

  // Picks up a gender auto-defaulted server-side after save (e.g. the
  // model was just switched to Vapi) — the state's initial value only
  // reflects widget.extra at first render.
  useEffect(() => {
    setVoiceGender(widget.extra.voiceGender ?? DEFAULT_VOICE_GENDER);
  }, [widget.extra.voiceGender]);

  const knowledgeCount = (widget.extra.knowledgeBase ?? []).length;
  const selectedModel = llmModels.find((model) => model.id === widget.llm_model_id);
  const isVapiModel = selectedModel?.provider === "vapi";
  // Only a phone agent places campaign calls; a website widget never does.
  const isPhoneAgent = widget.agent_type === "phone";

  async function handleSave() {
    setSaving(true);
    setStatus("idle");
    // The call limits are Vapi-only — there is no equivalent knob on the
    // text pipeline, so sending them for a non-Vapi widget would store a
    // setting nothing reads.
    const ok = await savePatch(
      isVapiModel
        ? {
            language,
            extra: {
              voiceGender,
              silenceTimeoutSeconds: silenceTimeout,
              maxDurationSeconds: maxDuration,
              // Empty clears it, which puts campaigns back on the assistant
              // that answers the phone.
              vapiOutboundAssistantId: outboundAssistant.trim() || null,
            },
          }
        : { voiceModelId: voiceModelId || null, language }
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

        {/* No model picker: the agent always runs on the model configured on
            the Vapi template assistant (see lib/vapi/assistants.ts), the same
            place its voice comes from. The dropdown that used to sit here
            also listed the legacy Standard/Expert engines, so a customer
            could silently move a working voice agent onto a pipeline the
            create flow stopped offering in 0012_vapi_default_model.sql.
            The Vapi assistant id is stored internally and stays hidden too. */}

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

        {/* Live: the knowledge base is fully implemented and has its own tab.
            A disabled dropdown here claimed otherwise. */}
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("agent.settings.knowledgeBaseLabel")}
          </span>
          <p className="text-sm text-slate-600">
            {knowledgeCount === 0
              ? t("agent.settings.knowledgeBaseEmpty")
              : t("agent.settings.knowledgeBaseCount", { count: knowledgeCount })}
          </p>
          <p className="mt-1 text-xs text-slate-500">{t("agent.settings.knowledgeBaseHint")}</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ComingSoonField label={t("agent.settings.autoEndCallLabel")} />
          <ComingSoonField label={t("agent.settings.askCustomerInfoLabel")} />
        </div>

        <ComingSoonField label={t("agent.settings.postCallAnalysisLabel")}>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-400">
            {t("agent.settings.noFieldsAddedYet")}
          </div>
        </ComingSoonField>

        {/* Live: both come from the Cal.com connection made under Booking. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">
              {t("agent.settings.calendarTimezoneLabel")}
            </span>
            <p className="text-sm text-slate-600">{booking?.timezone ?? t("agent.settings.bookingNotConnected")}</p>
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">
              {t("agent.settings.calComEventIdLabel")}
            </span>
            <p className="text-sm text-slate-600">{booking?.eventTypeId ?? t("agent.settings.bookingNotConnected")}</p>
          </div>
        </div>
        <p className="-mt-2 text-xs text-slate-500">{t("agent.settings.bookingManagedHint")}</p>

        {/* Live for Vapi widgets: both are real Vapi assistant settings, sent
            with every assistant sync. Left as "coming soon" on the text
            pipeline, which has no equivalent. */}
        {isVapiModel ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="silence-timeout" className="mb-1 block text-sm font-medium text-slate-700">
                {t("agent.settings.endCallOnSilenceLabel")}{" "}
                <span className="font-normal text-slate-500">({silenceTimeout}s)</span>
              </label>
              <input
                id="silence-timeout"
                type="range"
                min={10}
                max={120}
                step={5}
                value={silenceTimeout}
                onChange={(e) => setSilenceTimeout(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label htmlFor="max-duration" className="mb-1 block text-sm font-medium text-slate-700">
                {t("agent.settings.maxDurationLabel")}{" "}
                <span className="font-normal text-slate-500">({Math.round(maxDuration / 60)} min.)</span>
              </label>
              <input
                id="max-duration"
                type="range"
                min={60}
                max={3600}
                step={60}
                value={maxDuration}
                onChange={(e) => setMaxDuration(Number(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ComingSoonField label={t("agent.settings.endCallOnSilenceLabel")}>
              <input disabled type="range" className="w-full" />
            </ComingSoonField>
            <ComingSoonField label={t("agent.settings.maxDurationLabel")}>
              <input disabled type="range" className="w-full" />
            </ComingSoonField>
          </div>
        )}

        {isPhoneAgent && isVapiModel ? (
          <div>
            <label htmlFor="outbound-assistant" className="mb-1 block text-sm font-medium text-slate-700">
              {t("agent.settings.outboundAssistantLabel")}
            </label>
            <input
              id="outbound-assistant"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={outboundAssistant}
              onChange={(e) => setOutboundAssistant(e.target.value)}
              placeholder={t("agent.settings.outboundAssistantPlaceholder")}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
            <p className="mt-1 text-xs text-slate-500">{t("agent.settings.outboundAssistantHelp")}</p>
          </div>
        ) : null}

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
