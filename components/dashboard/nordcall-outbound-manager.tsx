"use client";

import { useState } from "react";
import { useTranslation } from "@/components/i18n/language-provider";
import type { NordcallOutboundStatus } from "@/lib/billing/nordcall-outbound";

interface Plan {
  key: "minutes_1000" | "minutes_2000";
  minutes: number;
  monthlyPriceDkk: number;
}

interface NordcallOutboundManagerProps {
  status: NordcallOutboundStatus;
  plans: Plan[];
  nordcallUrl: string;
  checkout: "success" | "cancelled" | null;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" }) : "—";
}

// The Nordcall add-on on the Outbound page: the current plan and minutes, a
// free trial, and the two monthly plans (Stripe Checkout).
export function NordcallOutboundManager({ status, plans, nordcallUrl, checkout }: NordcallOutboundManagerProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(key: string, body: object) {
    setBusy(key);
    setError(null);
    const res = await fetch("/api/billing/nordcall-outbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.url) {
      setBusy(null);
      setError(data?.error?.message ?? t("nordcallOutbound.error"));
      return;
    }
    window.location.href = data.url;
  }

  const hasPaidPlan = (status.plan === "minutes_1000" || status.plan === "minutes_2000")
    && (status.status === "active" || status.status === "past_due");
  const unlimited = status.plan === "internal";
  const percent = status.includedMinutes > 0 ? Math.min(100, Math.round((status.usedMinutes / status.includedMinutes) * 100)) : 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">{t("nordcallOutbound.eyebrow")}</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{t("nordcallOutbound.title")}</h1>
        <p className="mt-2 max-w-2xl text-slate-600">{t("nordcallOutbound.intro")}</p>
      </div>

      {checkout === "success" ? (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">{t("nordcallOutbound.checkoutSuccess")}</p>
      ) : null}
      {checkout === "cancelled" ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{t("nordcallOutbound.checkoutCancelled")}</p>
      ) : null}
      {!status.teamAdmin ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t("nordcallOutbound.notAdmin")}</p>
      ) : null}
      {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {status.plan ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-slate-500">{t("nordcallOutbound.currentTitle")}</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{t(`nordcallOutbound.plan.${status.plan}`)}</p>
              {status.status ? (
                <span className="mt-2 inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                  {t(`nordcallOutbound.status.${status.status}`)}
                </span>
              ) : null}
            </div>
            <a href={nordcallUrl} target="_blank" rel="noreferrer"
              className="rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">
              {t("nordcallOutbound.openNordcall")}
            </a>
          </div>
          {!unlimited ? (
            <div className="mt-5">
              <div className="flex justify-between text-sm text-slate-600">
                <span>{t("nordcallOutbound.usage")}</span>
                <span>{status.usedMinutes.toLocaleString("da-DK")} / {status.includedMinutes.toLocaleString("da-DK")} {t("nordcallOutbound.minutes")}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand-700" style={{ width: `${percent}%` }} />
              </div>
              <p className="mt-2 text-sm text-slate-500">
                {status.plan === "trial"
                  ? `${t("nordcallOutbound.trialEnds")}: ${formatDate(status.trialEndsAt)}`
                  : `${t("nordcallOutbound.renews")}: ${formatDate(status.periodEnd)}`}
              </p>
              {hasPaidPlan ? <a href="/dashboard/billing" className="mt-2 inline-block text-sm text-brand-700 underline">{t("nordcallOutbound.manage")}</a> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {!unlimited && !hasPaidPlan ? (
        <div className="grid gap-4 md:grid-cols-3">
          {status.trialAvailable ? (
            <section className="flex flex-col rounded-lg border border-slate-200 bg-white p-6 shadow">
              <h2 className="text-lg font-semibold text-slate-900">{t("nordcallOutbound.trialTitle")}</h2>
              <p className="mt-2 text-3xl font-bold text-slate-900">0 <span className="text-base font-medium text-slate-500">{t("nordcallOutbound.perMonth")}</span></p>
              <p className="mt-2 flex-1 text-sm text-slate-600">{t("nordcallOutbound.trialDescription")}</p>
              <button type="button" disabled={busy !== null || !status.teamAdmin} onClick={() => act("trial", { action: "trial" })}
                className="mt-4 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60">
                {busy === "trial" ? "…" : t("nordcallOutbound.trialButton")}
              </button>
            </section>
          ) : null}
          {plans.map((plan) => (
            <section key={plan.key} className={`flex flex-col rounded-lg border bg-white p-6 shadow ${plan.key === "minutes_2000" ? "border-brand-700" : "border-slate-200"}`}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-slate-900">{t(`nordcallOutbound.plan.${plan.key}`)}</h2>
                {plan.key === "minutes_2000" ? <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{t("nordcallOutbound.popular")}</span> : null}
              </div>
              <p className="mt-2 text-3xl font-bold text-slate-900">
                {plan.monthlyPriceDkk.toLocaleString("da-DK")} <span className="text-base font-medium text-slate-500">{t("nordcallOutbound.perMonth")}</span>
              </p>
              <p className="mt-2 flex-1 text-sm text-slate-600">{plan.minutes.toLocaleString("da-DK")} {t("nordcallOutbound.minutesPerMonth")}</p>
              <button type="button" disabled={busy !== null || !status.teamAdmin} onClick={() => act(plan.key, { action: "checkout", plan: plan.key })}
                className="mt-4 rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60">
                {busy === plan.key ? t("dashboardPages.shared.openingCheckout") : t("nordcallOutbound.buyButton")}
              </button>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
