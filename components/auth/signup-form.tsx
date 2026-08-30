"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getBrowserClient } from "@/lib/database/browser";
import { useTranslation } from "@/components/i18n/language-provider";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/locales";

export function SignupForm({ initialLanguage }: { initialLanguage: Locale }) {
  const router = useRouter();
  const { t, setLocale } = useTranslation();
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [language, setLanguage] = useState<Locale>(initialLanguage);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // The signup form's own language choice both seeds the new account's
  // widget language and becomes the person's own Dashboard language (see
  // lib/customers/self-signup.ts) — so switching it here should also
  // re-render this very form in the chosen language immediately.
  function handleLanguageChange(next: Locale) {
    setLanguage(next);
    setLocale(next);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, email, password, language }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? t("auth.signup.errorGeneric"));
        setLoading(false);
        return;
      }

      const supabase = getBrowserClient();
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 15000)
      );
      const { error: signInError } = await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        timeout,
      ]);

      if (signInError) {
        setLoading(false);
        setError(t("auth.signup.errorLoginAfterCreate"));
        router.push("/login");
        return;
      }

      // Hard navigation, not router.push: guarantees the dashboard's
      // server-side auth check sees the just-set session cookie instead of
      // possibly racing ahead of it (see app/login/page.tsx for the same fix).
      window.location.href = "/dashboard";
    } catch (err) {
      setLoading(false);
      if (err instanceof Error && err.message === "timeout") {
        setError(t("auth.signup.errorTimeout"));
      } else {
        const detail = err instanceof Error ? err.message : t("common.unknownError");
        setError(t("auth.signup.errorUnexpected", { detail }));
      }
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">AIbooking.dk</h1>
        <p className="mt-1 text-sm text-slate-500">{t("auth.signup.tagline")}</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="companyName" className="mb-1 block text-sm font-medium text-slate-700">
              {t("auth.signup.companyName")}
            </label>
            <input
              id="companyName"
              type="text"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div>
            <label htmlFor="language" className="mb-1 block text-sm font-medium text-slate-700">
              {t("auth.signup.language")}
            </label>
            <select
              id="language"
              value={language}
              onChange={(e) => handleLanguageChange(e.target.value as Locale)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            >
              {LOCALES.map((value) => (
                <option key={value} value={value}>
                  {LOCALE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
              {t("auth.signup.email")}
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
              {t("auth.signup.password")}
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
            <p className="mt-1 text-xs text-slate-400">{t("auth.signup.passwordHint")}</p>
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? t("auth.signup.submitting") : t("auth.signup.submit")}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          {t("auth.signup.haveAccount")}{" "}
          <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
            {t("auth.signup.login")}
          </Link>
        </p>
      </div>
    </main>
  );
}
