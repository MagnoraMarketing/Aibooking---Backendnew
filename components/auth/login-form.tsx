"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getBrowserClient } from "@/lib/database/browser";
import { useTranslation } from "@/components/i18n/language-provider";

export function LoginForm() {
  return (
    <Suspense fallback={null}>
      <LoginFormInner />
    </Suspense>
  );
}

function LoginFormInner() {
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
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
        setError(t("auth.login.errorWrongCredentials"));
        return;
      }

      const next = searchParams.get("next") || "/dashboard";
      // A hard navigation (not router.push) so the very next request is
      // guaranteed to carry the just-set auth cookies — a client-side
      // soft navigation can race ahead of the cookie write and hit the
      // dashboard's server-side auth check with no session yet.
      window.location.href = next;
    } catch (err) {
      setLoading(false);
      if (err instanceof Error && err.message === "timeout") {
        setError(t("auth.login.errorTimeout"));
      } else {
        const detail = err instanceof Error ? err.message : t("common.unknownError");
        setError(t("auth.login.errorTechnical", { detail }));
      }
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">AIbooking.dk</h1>
        <p className="mt-1 text-sm text-slate-500">{t("auth.login.tagline")}</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? t("auth.login.submitting") : t("auth.login.submit")}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          {t("auth.login.newHere")}{" "}
          <Link href="/signup" className="font-medium text-brand-600 hover:text-brand-700">
            {t("auth.login.createAccount")}
          </Link>
        </p>
      </div>
    </main>
  );
}
