"use client";

import { useState } from "react";
import type { WidgetWithExtras } from "../agent-configurator";
import { ComingSoonField } from "../coming-soon-field";
import { ToggleSwitch } from "../toggle-switch";
import { LLM_PRESETS, DEFAULT_LLM_PRESET, VOICE_PRESETS, DEFAULT_VOICE_PRESET, VOICE_PROVIDERS } from "@/lib/vapi/catalog";
import { DEFAULT_AGENT_CAPABILITIES, type AgentCapabilities } from "@/lib/vapi/types";
import { SUPPORTED_LANGUAGES } from "@/lib/widgets/languages";

interface VoiceAgentTabProps {
  widget: WidgetWithExtras;
  createOrSyncVapiAgent: (patch: Record<string, unknown>) => Promise<boolean>;
  removeVapiAgent: () => Promise<boolean>;
}

const CAPABILITY_LABELS: Record<keyof AgentCapabilities, string> = {
  answerQuestions: "Besvar spørgsmål",
  collectContactInfo: "Indsaml kontaktoplysninger",
  bookAppointments: "Book aftaler",
  cancelAppointments: "Aflys aftaler",
  rescheduleAppointments: "Omlæg aftaler",
  sendEmail: "Send e-mail",
  transferToHuman: "Overfør til menneske",
  captureLeads: "Fang leads",
};

const MODES = [
  { value: "voice", label: "Kun tale" },
  { value: "chat", label: "Kun tekst-chat" },
  { value: "both", label: "Tale + chat" },
] as const;

export function VoiceAgentTab({ widget, createOrSyncVapiAgent, removeVapiAgent }: VoiceAgentTabProps) {
  const [businessDescription, setBusinessDescription] = useState(widget.business_description ?? "");
  const [businessPhone, setBusinessPhone] = useState(widget.business_phone ?? "");
  const [businessEmail, setBusinessEmail] = useState(widget.business_email ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(widget.website_url ?? "");
  const [widgetMode, setWidgetMode] = useState(widget.widget_mode);

  const initialLlmPreset =
    LLM_PRESETS.find((p) => p.provider === widget.vapi_llm_provider && p.model === widget.vapi_llm_model) ??
    DEFAULT_LLM_PRESET;
  const [llmPreset, setLlmPreset] = useState(`${initialLlmPreset.provider}:${initialLlmPreset.model}`);

  const initialVoicePreset = VOICE_PRESETS.find(
    (p) => p.provider === widget.vapi_voice_provider && p.voiceId === widget.vapi_voice_id
  );
  const [voiceMode, setVoiceMode] = useState<"preset" | "custom">(
    !widget.vapi_voice_id || initialVoicePreset ? "preset" : "custom"
  );
  const [voicePreset, setVoicePreset] = useState(
    initialVoicePreset ? `${initialVoicePreset.provider}:${initialVoicePreset.voiceId}` : `${DEFAULT_VOICE_PRESET.provider}:${DEFAULT_VOICE_PRESET.voiceId}`
  );
  const [customVoiceProvider, setCustomVoiceProvider] = useState(widget.vapi_voice_provider ?? VOICE_PROVIDERS[1]);
  const [customVoiceId, setCustomVoiceId] = useState(voiceMode === "custom" ? widget.vapi_voice_id ?? "" : "");

  const [capabilities, setCapabilities] = useState<AgentCapabilities>({
    ...DEFAULT_AGENT_CAPABILITIES,
    ...(widget.extra.capabilities ?? {}),
  });

  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function setCapability(key: keyof AgentCapabilities, value: boolean) {
    setCapabilities((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreateOrSync() {
    setSaving(true);
    setStatus("idle");
    setErrorMessage(null);

    const [voiceProvider, voiceId] =
      voiceMode === "preset" ? voicePreset.split(":") : [customVoiceProvider, customVoiceId];
    const [llmProvider, llmModel] = llmPreset.split(":");

    const ok = await createOrSyncVapiAgent({
      businessDescription: businessDescription || null,
      businessPhone: businessPhone || null,
      businessEmail: businessEmail || null,
      websiteUrl: websiteUrl || null,
      widgetMode,
      voiceProvider,
      voiceId,
      llmProvider,
      llmModel,
      capabilities,
    });

    setSaving(false);
    if (!ok) {
      setStatus("error");
      setErrorMessage("Kunne ikke oprette/opdatere voice-agenten. Tjek felterne og prøv igen.");
      return;
    }
    setStatus("saved");
  }

  async function handleRemove() {
    if (!confirm("Fjern voice-agenten? Kunder kan ikke længere ringe/tale med den, før den oprettes igen.")) return;
    setRemoving(true);
    const ok = await removeVapiAgent();
    setRemoving(false);
    if (!ok) {
      setStatus("error");
      setErrorMessage("Kunne ikke fjerne voice-agenten.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Vapi-status</h2>
            <p className="mt-1 text-sm text-slate-600">
              {widget.vapi_assistant_id
                ? `Aktiv — sidst synkroniseret ${widget.vapi_synced_at ? new Date(widget.vapi_synced_at).toLocaleString("da-DK") : "ukendt"}.`
                : "Der er endnu ikke oprettet en voice-agent for denne AI-agent."}
            </p>
          </div>
          {widget.vapi_assistant_id ? (
            <button
              type="button"
              onClick={handleRemove}
              disabled={removing}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              {removing ? "Fjerner…" : "Fjern voice-agent"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Om virksomheden</h2>

        <div>
          <label htmlFor="business-description" className="mb-1 block text-sm font-medium text-slate-700">
            Beskrivelse
          </label>
          <textarea
            id="business-description"
            rows={3}
            value={businessDescription}
            onChange={(e) => setBusinessDescription(e.target.value)}
            placeholder="Kort beskrivelse af virksomheden — bruges i agentens standard-prompt."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="business-phone" className="mb-1 block text-sm font-medium text-slate-700">
              Telefon
            </label>
            <input
              id="business-phone"
              value={businessPhone}
              onChange={(e) => setBusinessPhone(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label htmlFor="business-email" className="mb-1 block text-sm font-medium text-slate-700">
              E-mail
            </label>
            <input
              id="business-email"
              type="email"
              value={businessEmail}
              onChange={(e) => setBusinessEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label htmlFor="website-url" className="mb-1 block text-sm font-medium text-slate-700">
              Hjemmeside
            </label>
            <input
              id="website-url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>

        <p className="text-xs text-slate-500">
          Sprog styres under fanen &quot;Settings&quot;. Understøttede sprog: {SUPPORTED_LANGUAGES.map((l) => l.label).join(", ")}.
        </p>
      </div>

      <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Model &amp; stemme</h2>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">AI-model</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {LLM_PRESETS.map((preset) => {
              const value = `${preset.provider}:${preset.model}`;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLlmPreset(value)}
                  className={`rounded-xl border p-3 text-left text-sm transition ${
                    llmPreset === value ? "border-brand-500 ring-1 ring-brand-500" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  {preset.label}
                  {preset.recommended ? (
                    <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-600">
                      Anbefalet
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Stemme</p>
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => setVoiceMode("preset")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                voiceMode === "preset" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              Indbygget (kræver ingen opsætning)
            </button>
            <button
              type="button"
              onClick={() => setVoiceMode("custom")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                voiceMode === "custom" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              Custom udbyder
            </button>
          </div>

          {voiceMode === "preset" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {VOICE_PRESETS.map((preset) => {
                const value = `${preset.provider}:${preset.voiceId}`;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setVoicePreset(value)}
                    className={`rounded-xl border p-3 text-left text-sm transition ${
                      voicePreset === value ? "border-brand-500 ring-1 ring-brand-500" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <select
                value={customVoiceProvider}
                onChange={(e) => setCustomVoiceProvider(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              >
                {VOICE_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
              <input
                value={customVoiceId}
                onChange={(e) => setCustomVoiceId(e.target.value)}
                placeholder="Voice ID fra udbyderen"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Custom udbydere (11labs, playht, azure, cartesia, deepgram, openai, rime-ai) kræver at kontoen har den
            udbyder konfigureret i Vapi-dashboardet.
          </p>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Widget-type</p>
          <div className="grid grid-cols-3 gap-3">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setWidgetMode(m.value)}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                  widgetMode === m.value ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Egenskaber</h2>

        <ToggleSwitch
          label={CAPABILITY_LABELS.answerQuestions}
          description="Agenten besvarer spørgsmål ud fra system-prompten."
          checked
          disabled
        />

        {(Object.keys(CAPABILITY_LABELS) as (keyof AgentCapabilities)[])
          .filter((key) => key !== "answerQuestions")
          .map((key) => (
            <ComingSoonField key={key} label={CAPABILITY_LABELS[key]}>
              <ToggleSwitch label={CAPABILITY_LABELS[key]} checked={capabilities[key]} disabled />
            </ComingSoonField>
          ))}

        <p className="text-xs text-slate-500">
          Kun &quot;Besvar spørgsmål&quot; er implementeret i denne udgave. De øvrige gemmes til jeres profil, så de
          kan aktiveres uden yderligere opsætning, når de lanceres.
        </p>
      </div>

      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleCreateOrSync}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? "Opretter…" : widget.vapi_assistant_id ? "Opdater voice-agent" : "Opret voice-agent"}
        </button>
        {status === "saved" ? <span className="text-sm text-emerald-600">Gemt.</span> : null}
      </div>
    </div>
  );
}
