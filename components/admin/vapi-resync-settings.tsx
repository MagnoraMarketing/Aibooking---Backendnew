"use client";

import { useState } from "react";
import { useTranslation } from "@/components/i18n/language-provider";

interface ResyncFailure {
  widgetId: string;
  name: string;
  detail?: string;
}

interface ResyncResult {
  total: number;
  synced: number;
  skipped: number;
  failed: number;
  failures: ResyncFailure[];
}

// Pushes the current platform configuration out to every existing Vapi
// assistant at once.
//
// An assistant normally only picks up a platform-level change the next time
// its own widget is edited — so replacing a voice template leaves every
// existing agent on the old voice until its owner happens to touch
// something, which for a quiet widget can be never. This is the button that
// closes that gap, and it is deliberately manual: a master admin decides
// when the estate gets rewritten, rather than a save silently fanning out to
// every customer's live agent.
export function VapiResyncSettings() {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ResyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleResync() {
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/admin/vapi/resync", { method: "POST" });
      if (!res.ok) {
        setError(t("adminPages.vapiResync.failed"));
        return;
      }
      setResult((await res.json()) as ResyncResult);
    } catch {
      // A timeout lands here. The operation is idempotent, so the honest
      // advice is simply to press it again.
      setError(t("adminPages.vapiResync.failed"));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t("adminPages.vapiResync.title")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{t("adminPages.vapiResync.description")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleResync}
          disabled={running}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {running ? t("adminPages.vapiResync.running") : t("adminPages.vapiResync.button")}
        </button>
        {error ? <span className="text-sm text-red-600">{error}</span> : null}
        {result ? (
          <span className={result.failed > 0 ? "text-sm text-amber-700" : "text-sm text-emerald-600"}>
            {t("adminPages.vapiResync.summary", {
              synced: result.synced,
              total: result.total,
              failed: result.failed,
            })}
          </span>
        ) : null}
      </div>

      {result && result.failures.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">{t("adminPages.vapiResync.failuresTitle")}</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {result.failures.map((failure) => (
              <li key={failure.widgetId}>
                <span className="font-medium">{failure.name}</span>
                {failure.detail ? <span className="text-amber-800"> — {failure.detail}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
