"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getBrowserClient } from "@/lib/database/browser";
import { useTranslation } from "@/components/i18n/language-provider";

// The invite link's #access_token/#refresh_token hash is picked up
// automatically by createBrowserClient (detectSessionInUrl) the moment
// this page loads — no code here needs to parse the URL itself, just wait
// for the session to appear before letting the customer set a password.
export function AcceptInviteForm() {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sessionReady, setSessionReady] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = getBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      setSessionReady(!!data.session);
    });
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("auth.acceptInvite.errorMismatch"));
      return;
    }

    setSaving(true);
    const supabase = getBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (updateError) {
      setError(t("auth.acceptInvite.errorGeneric"));
      return;
    }

    // Hard navigation so the dashboard's server-side auth check sees the
    // just-updated session cookie — same reasoning as login/signup.
    window.location.href = "/dashboard";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">AIbooking.dk</h1>
        <p className="mt-1 text-sm text-slate-500">{t("auth.acceptInvite.tagline")}</p>

        {sessionReady === false ? (
          <p className="mt-6 text-sm text-red-600">{t("auth.acceptInvite.errorInvalidLink")}</p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
                {t("auth.acceptInvite.passwordLabel")}
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

            <div>
              <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium text-slate-700">
                {t("auth.acceptInvite.confirmPasswordLabel")}
              </label>
              <input
                id="confirm-password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <button
              type="submit"
              disabled={saving || sessionReady !== true}
              className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? t("auth.acceptInvite.submitting") : t("auth.acceptInvite.submit")}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
