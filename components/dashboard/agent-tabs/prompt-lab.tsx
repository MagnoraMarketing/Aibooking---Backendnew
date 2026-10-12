"use client";

import { useState } from "react";
import type { PromptInputs, SavePatch, WidgetWithExtras } from "../agent-configurator";
import { useTranslation } from "@/components/i18n/language-provider";

export function PromptLabTab({ widget, savePatch }: { widget: WidgetWithExtras; savePatch: SavePatch }) {
  const { t } = useTranslation();
  const [systemPrompt, setSystemPrompt] = useState(widget.system_prompt ?? "");
  const [welcomeMessage, setWelcomeMessage] = useState(widget.welcome_message ?? "");
  const [openingMessage, setOpeningMessage] = useState(widget.opening_message ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  // Seeded from what was saved last time (widget_settings.extra.promptInputs)
  // rather than starting blank — these answers are what the prompt was
  // generated from, so losing them means the customer has to retype their
  // whole business to change one line of it.
  const savedInputs = widget.extra.promptInputs ?? {};
  const [businessDescription, setBusinessDescription] = useState(savedInputs.businessDescription ?? "");
  const [keyServices, setKeyServices] = useState(savedInputs.keyServices ?? "");
  const [openingHours, setOpeningHours] = useState(savedInputs.openingHours ?? "");
  const [otherNotes, setOtherNotes] = useState(savedInputs.otherNotes ?? "");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateStatus, setGenerateStatus] = useState<"idle" | "saved" | "unsaved">("idle");

  // Drives the "and N sources are added on top" line below — the sources
  // themselves live on the Knowledge Base tab, but their effect shows up
  // here, in the prompt the agent actually runs on.
  const knowledgeBaseCount = widget.extra.knowledgeBase?.length ?? 0;

  function currentPromptInputs(): PromptInputs {
    return { businessDescription, keyServices, openingHours, otherNotes };
  }

  async function handleSave() {
    setSaving(true);
    setStatus("idle");
    const ok = await savePatch({
      systemPrompt,
      welcomeMessage,
      openingMessage,
      extra: { promptInputs: currentPromptInputs() },
    });
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
    setGenerateStatus("idle");

    const res = await fetch(`/api/customer/widgets/${widget.id}/generate-prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessDescription, keyServices, openingHours, otherNotes }),
    });

    if (!res.ok) {
      setGenerating(false);
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

    // Persist it straight away rather than leaving the draft sitting in an
    // unsaved textarea: the same PATCH also pushes the prompt to the agent's
    // Vapi assistant (see app/api/customer/widgets/[id]/route.ts), so the
    // voice agent actually speaks from the generated prompt instead of the
    // default one. The answers that produced it are saved alongside, so the
    // prompt stays regenerable instead of the inputs being thrown away. The
    // textarea stays editable, and the Save button below still saves any
    // later hand-edits.
    const saved = await savePatch({
      systemPrompt: data.systemPrompt,
      extra: { promptInputs: currentPromptInputs() },
    });
    setGenerating(false);
    setGenerateStatus(saved ? "saved" : "unsaved");
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
        {generateStatus === "saved" ? (
          <p className="text-sm text-emerald-600">{t("agent.promptLab.generatedAndSaved")}</p>
        ) : null}
        {generateStatus === "unsaved" ? (
          <p className="text-sm text-amber-600">{t("agent.promptLab.generatedNotSaved")}</p>
        ) : null}

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
        {/* The prompt field looks like the only thing the agent knows, which
            leads people to paste opening hours and prices into it — where
            they freeze and go stale. Say plainly what each half is for: this
            box is behaviour, the knowledge base is facts, and the two are
            joined behind the scenes at every call (see lib/vapi/sync.ts and
            lib/conversation/handle-turn.ts). */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-700">{t("agent.promptLab.howItFitsTitle")}</p>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
            <li className="flex gap-2">
              <span className="mt-0.5 text-brand-600">1.</span>
              <span>{t("agent.promptLab.howItFitsPrompt")}</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 text-brand-600">2.</span>
              <span>
                {knowledgeBaseCount > 0
                  ? t("agent.promptLab.howItFitsKnowledgeWithCount", { count: knowledgeBaseCount })
                  : t("agent.promptLab.howItFitsKnowledgeEmpty")}
              </span>
            </li>
          </ul>
          <p className="mt-2 text-xs text-slate-500">{t("agent.promptLab.howItFitsNote")}</p>
        </div>

        {/* What to actually put in the prompt. This guidance is addressed to
            the person configuring the agent, so it belongs here, on screen,
            next to the field it describes — not inside the default system
            prompt, which is the agent's OWN instructions and would have the
            agent reading "enter the business's opening hours" as a job to
            do, and passing it on to a visitor. */}
        <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
          <p className="text-sm font-medium text-slate-700">{t("agent.promptLab.checklistTitle")}</p>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
            {[
              "agent.promptLab.checklistOpeningHours",
              "agent.promptLab.checklistFaq",
              "agent.promptLab.checklistGeneral",
              "agent.promptLab.checklistPrices",
              "agent.promptLab.checklistBooking",
              "agent.promptLab.checklistShopify",
            ].map((key) => (
              <li key={key} className="flex gap-2">
                <span className="mt-0.5 text-brand-600">•</span>
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
        </div>

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
