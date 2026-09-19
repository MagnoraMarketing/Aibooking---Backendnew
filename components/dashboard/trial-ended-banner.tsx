"use client";

import Link from "next/link";
import { useTranslation } from "@/components/i18n/language-provider";

// Shown across every dashboard page once a customer's free trial (7 days or
// 5 minutes, whichever ran out first — see lib/billing/trial.ts) is over and
// they haven't converted to a paid package or the one-off Voice Widget
// launch offer. app/dashboard/layout.tsx decides whether to render this with
// the same hasEmbedCodeAccess check the embed-code tab itself uses, so the
// two never disagree about whether the trial is actually over. Building and
// testing an agent stays free indefinitely — this only reminds them that
// going live and making real calls needs a package, and points at Billing to
// pick one.
export function TrialEndedBanner() {
  const { t } = useTranslation();

  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div>
          <p className="text-sm font-semibold text-amber-900">{t("dashboardShell.trialEndedBanner.title")}</p>
          <p className="mt-0.5 text-xs text-amber-800">{t("dashboardShell.trialEndedBanner.body")}</p>
        </div>
        <Link
          href="/dashboard/billing"
          className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {t("dashboardShell.trialEndedBanner.cta")}
        </Link>
      </div>
    </div>
  );
}
