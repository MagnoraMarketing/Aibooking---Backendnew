"use client";

import { useState, type FormEvent } from "react";
import { getBrowserClient } from "@/lib/database/browser";
import { useTranslation } from "@/components/i18n/language-provider";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/locales";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500";

// A signed-in login without an AIbooking account (e.g. a Nordcall user)
// creates its own, separate AIbooking account — see app/account-incomplete.
export function CompleteSignupForm({ email, initialLanguage }: { email: string; initialLanguage: Locale }) {
  const { t, setLocale } = useTranslation();
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState<Locale>(initialLanguage);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/auth/complete-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName, phone: phone.trim() || undefined, language }),
    }).catch(() => null);
    if (!res?.ok) {
      const body = await res?.json().catch(() => null);
      setError(body?.error?.message ?? t("auth.signup.errorGeneric"));
      setLoading(false);
      return;
    }
    // Hard navigation so the dashboard's server-side check sees the new profile.
    window.location.href = "/dashboard";
  }

  async function signOut() {
    await getBrowserClient().auth.signOut();
    window.location.href = "/login";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">{t("auth.completeSignup.title")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">{t("auth.completeSignup.intro", { email })}</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="companyName" className="mb-1 block text-sm font-medium text-slate-700">
              {t("auth.signup.companyName")}
            </label>
            <input id="companyName" type="text" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="language" className="mb-1 block text-sm font-medium text-slate-700">
              {t("auth.signup.language")}
            </label>
            <select
              id="language"
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value as Locale);
                setLocale(e.target.value as Locale);
              }}
              className={inputClass}
            >
              {LOCALES.map((value) => (
                <option key={value} value={value}>
                  {LOCALE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="phone" className="mb-1 block text-sm font-medium text-slate-700">
              {t("auth.signup.phone")}
            </label>
            <input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("auth.signup.phonePlaceholder")} className={inputClass} />
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? t("auth.signup.submitting") : t("auth.completeSignup.submit")}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          <button type="button" onClick={() => void signOut()} className="font-medium text-brand-600 hover:text-brand-700">
            {t("auth.completeSignup.otherLogin")}
          </button>
        </p>
      </div>
    </main>
  );
}
