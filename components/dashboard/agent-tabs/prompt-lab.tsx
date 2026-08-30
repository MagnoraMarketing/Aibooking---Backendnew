"use client";

import { useState } from "react";
import type { SavePatch, WidgetWithExtras } from "../agent-configurator";
import { useTranslation } from "@/components/i18n/language-provider";

export function PromptLabTab({ widget, savePatch }: { widget: WidgetWithExtras; savePatch: SavePatch }) {
  const { t } = useTranslation();
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
      setGenerateError(t("agent.promptLab.generateErrorMissingDescription"));
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
          ? t("agent.promptLab.generateErrorWithDetail", { detail: data.error.message })
          : t("agent.promptLab.generateErrorGeneric")
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {t("agent.promptLab.sectionTitle")}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{t("agent.promptLab.sectionDescription")}</p>
        </div>

        <div>
          <label htmlFor="business-description" className="mb-1 block text-sm font-medium text-slate-700">
            {t("agent.promptLab.businessDescriptionLabel")}
          </label>
          <input
            id="business-description"
            value={businessDescription}
            onChange={(e) => setBusinessDescription(e.target.value)}
            placeholder={t("agent.promptLab.businessDescriptionPlaceholder")}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="key-services" className="mb-1 block text-sm font-medium text-slate-700">
              {t("agent.promptLab.keyServicesLabel")}
            </label>
            <input
              id="key-services"
              value={keyServices}
              onChange={(e) => setKeyServices(e.target.value)}
              placeholder={t("agent.promptLab.keyServicesPlaceholder")}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label htmlFor="opening-hours" className="mb-1 block text-sm font-medium text-slate-700">
              {t("agent.promptLab.openingHoursLabel")}
            </label>
            <input
              id="opening-hours"
              value={openingHours}
              onChange={(e) => setOpeningHours(e.target.value)}
              placeholder={t("agent.promptLab.openingHoursPlaceholder")}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>

        <div>
          <label htmlFor="other-notes" className="mb-1 block text-sm font-medium text-slate-700">
            {t("agent.promptLab.otherNotesLabel")}
          </label>
          <input
            id="other-notes"
            value={otherNotes}
            onChange={(e) => setOtherNotes(e.target.value)}
            placeholder={t("agent.promptLab.otherNotesPlaceholder")}
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
          {generating ? t("agent.promptLab.generating") : t("agent.promptLab.generateButton")}
        </button>
      </div>

      <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <label htmlFor="system-prompt" className="mb-1 block text-sm font-medium text-slate-700">
            {t("agent.promptLab.systemPromptLabel")}
          </label>
          <textarea
            id="system-prompt"
            rows={8}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder={t("agent.promptLab.systemPromptPlaceholder")}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
          <p className="mt-1 text-xs text-slate-500">{t("agent.promptLab.systemPromptHelp")}</p>
        </div>

        <div>
          <label htmlFor="welcome-message" className="mb-1 block text-sm font-medium text-slate-700">
            {t("agent.promptLab.welcomeMessageLabel")}
          </label>
          <input
            id="welcome-message"
            value={welcomeMessage}
            onChange={(e) => setWelcomeMessage(e.target.value)}
            placeholder={t("agent.promptLab.welcomeMessagePlaceholder")}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div>
          <label htmlFor="opening-message" className="mb-1 block text-sm font-medium text-slate-700">
            {t("agent.promptLab.openingMessageLabel")}
          </label>
          <input
            id="opening-message"
            value={openingMessage}
            onChange={(e) => setOpeningMessage(e.target.value)}
            placeholder={t("agent.promptLab.openingMessagePlaceholder")}
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
            {saving ? t("common.saving") : t("common.save")}
          </button>
          {status === "saved" ? <span className="text-sm text-emerald-600">{t("common.saved")}</span> : null}
          {status === "error" ? <span className="text-sm text-red-600">{t("common.saveFailed")}</span> : null}
        </div>
      </div>
    </div>
  );
}
