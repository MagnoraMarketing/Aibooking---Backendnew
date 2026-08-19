"use client";

import { useState } from "react";
import { useTranslation } from "@/components/i18n/language-provider";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/locales";

export function LanguageSettings({ currentLanguage }: { currentLanguage: Locale }) {
  const { t, setLocale } = useTranslation();
  const [language, setLanguage] = useState<Locale>(currentLanguage);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  async function handleSave() {
    setSaving(true);
    setStatus("idle");
    const res = await fetch("/api/profile/language", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language }),
    });
    setSaving(false);
    if (res.ok) {
      setLocale(language);
      setStatus("saved");
    } else {
      setStatus("error");
    }
  }

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t("profile.languageSectionTitle")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{t("profile.languageSectionDescription")}</p>
      </div>

      <div>
        <label htmlFor="profile-language" className="mb-1 block text-sm font-medium text-slate-700">
          {t("profile.languageLabel")}
        </label>
        <select
          id="profile-language"
          value={language}
          onChange={(e) => setLanguage(e.target.value as Locale)}
          className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        >
          {LOCALES.map((value) => (
            <option key={value} value={value}>
              {LOCALE_LABELS[value]}
            </option>
          ))}
        </select>
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
  );
}
