"use client";

import { useState } from "react";
import { useTranslation } from "@/components/i18n/language-provider";

interface VapiPromptDraftingSettingsProps {
  initialAssistantId: string | null;
}

// Points Prompt Lab's "Generér prompt" fallback at a Vapi assistant the
// master admin has built and tuned directly in Vapi's own dashboard — see
// lib/llm/vapi-provider.ts. Left empty, the fallback simply never fires and
// an Anthropic failure (e.g. an empty credit balance) shows as it always
// has.
export function VapiPromptDraftingSettings({ initialAssistantId }: VapiPromptDraftingSettingsProps) {
  const { t } = useTranslation();
  const [assistantId, setAssistantId] = useState(initialAssistantId ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleSave() {
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/settings/vapi-prompt-drafting-assistant", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assistantId: assistantId.trim() || null }),
      });

      if (!res.ok) throw new Error(t("adminPages.vapiPromptDrafting.errorSaveFailed"));

      setMessage({ type: "success", text: t("common.saved") });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : t("common.unknownError") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t("adminPages.vapiPromptDrafting.heading")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{t("adminPages.vapiPromptDrafting.description")}</p>
      </div>

      <div>
        <label htmlFor="vapi-prompt-drafting-id" className="mb-1 block text-sm font-medium text-slate-700">
          {t("adminPages.vapiPromptDrafting.idLabel")}
        </label>
        <input
          id="vapi-prompt-drafting-id"
          type="text"
          value={assistantId}
          onChange={(e) => setAssistantId(e.target.value)}
          placeholder={t("adminPages.vapiVoiceTemplates.idPlaceholder")}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </div>

      {message ? (
        <div
          className={`rounded-lg p-3 text-sm ${
            message.type === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {saving ? t("common.saving") : t("common.save")}
      </button>
    </div>
  );
}
