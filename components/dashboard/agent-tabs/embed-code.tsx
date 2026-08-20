"use client";

import { useState } from "react";
import type { Package } from "@/types/database";
import type { WidgetWithExtras } from "../agent-configurator";
import { useTranslation } from "@/components/i18n/language-provider";

function featuresFor(t: (key: string) => string): string[] {
  return [
    t("agent.embedCode.feature1"),
    t("agent.embedCode.feature2"),
    t("agent.embedCode.feature3"),
    t("agent.embedCode.feature4"),
    t("agent.embedCode.feature5"),
    t("agent.embedCode.feature6"),
    t("agent.embedCode.feature7"),
  ];
}

interface EmbedCodeTabProps {
  widget: WidgetWithExtras;
  unlocked: boolean;
  trialDaysRemaining: number;
  pkg: Package | null;
}

export function EmbedCodeTab({ widget, unlocked, trialDaysRemaining, pkg }: EmbedCodeTabProps) {
  const { t } = useTranslation();
  const FEATURES = featuresFor(t);
  const [copied, setCopied] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  async function handleCopy() {
    await navigator.clipboard.writeText(widget.embedSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleCheckout() {
    setCheckingOut(true);
    setCheckoutError(null);

    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      setCheckingOut(false);
      setCheckoutError(t("agent.embedCode.checkoutError"));
      return;
    }

    const { url } = await res.json();
    window.location.href = url;
  }

  if (!unlocked) {
    const monthlyPrice = pkg?.monthly_price ?? 999;
    const includedMinutes = pkg?.included_minutes ?? 150;
    const overagePrice = pkg?.overage_price_per_minute ?? 6.66;
    const currency = pkg?.currency ?? "DKK";

    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mx-auto max-w-md text-center">
          <h2 className="text-lg font-semibold text-slate-900">{t("agent.embedCode.unlockTitle")}</h2>
          <p className="mt-2 text-sm text-slate-500">
            {trialDaysRemaining > 0
              ? t("agent.embedCode.trialRemaining", { days: trialDaysRemaining })
              : t("agent.embedCode.trialExpired")}{" "}
            {t("agent.embedCode.orderPackageInstruction")}
          </p>

          <div className="mt-6 rounded-xl border border-slate-200 p-5 text-left">
            <p className="text-3xl font-bold text-slate-900">
              {monthlyPrice} {currency}
              <span className="text-base font-medium text-slate-500"> {t("agent.embedCode.perMonthSuffix")}</span>
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {t("agent.embedCode.includedMinutes", { minutes: includedMinutes, overagePrice, currency })}
            </p>

            <ul className="mt-4 space-y-2">
              {FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="mt-0.5 text-emerald-600">✓</span>
                  <span>{feature}</span>
                </li>
              ))}
              <li className="flex items-start gap-2 text-sm text-slate-700">
                <span className="mt-0.5 text-emerald-600">✓</span>
                <span>{t("agent.embedCode.includedMinutesFeature", { minutes: includedMinutes })}</span>
              </li>
            </ul>

            <p className="mt-4 text-xs text-slate-400">
              {t("agent.embedCode.renewalNote", { minutes: includedMinutes })}
            </p>
          </div>

          {checkoutError ? <p className="mt-4 text-sm text-red-600">{checkoutError}</p> : null}

          <button
            type="button"
            onClick={handleCheckout}
            disabled={checkingOut}
            className="mt-6 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {checkingOut ? t("agent.embedCode.openingCheckout") : t("agent.embedCode.orderNow")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t("agent.embedCode.pasteOnSiteTitle")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {t("agent.embedCode.pasteInstructionBefore")} <code>&lt;/body&gt;</code>{" "}
          {t("agent.embedCode.pasteInstructionAfter")}
        </p>
      </div>

      {trialDaysRemaining > 0 ? (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700">
          {t("agent.embedCode.trialRemaining", { days: trialDaysRemaining })}
        </p>
      ) : null}

      <div className="relative">
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">
          <code>{widget.embedSnippet}</code>
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          className="absolute right-3 top-3 rounded-md bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/20"
        >
          {copied ? t("agent.embedCode.copied") : t("agent.embedCode.copy")}
        </button>
      </div>

      <p className="text-sm text-slate-500">
        {t("agent.embedCode.shareLinkLabel")}{" "}
        <a href={widget.shareUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-600">
          {widget.shareUrl}
        </a>
      </p>
    </div>
  );
}
