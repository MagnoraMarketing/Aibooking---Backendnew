"use client";

import { useState } from "react";
import type { Package } from "@/types/database";
import type { WidgetWithExtras } from "../agent-configurator";
import { useTranslation } from "@/components/i18n/language-provider";
import { WIDGET_LAUNCH_MINUTES } from "@/lib/billing/widget-launch-offer";
import { EmbedCodeTab } from "./embed-code";

// The wizard's closing step: the agent is built and has just been tried out
// in the Test step, so the only thing left is paying to put it on a real
// website. Payment is a Stripe Payment Link rather than a Checkout Session
// we build — /api/billing/widget-launch only stamps the customer (and this
// widget) onto it, so the price and its terms stay editable in Stripe.
//
// Customers who already have access — an active subscription, or a launch
// purchase from an earlier agent — never see the pitch: they go straight to
// the embed code, since making them pay twice for a second widget would be
// wrong.
interface WizardPaymentStepProps {
  widget: WidgetWithExtras;
  unlocked: boolean;
  trialDaysRemaining: number;
  pkg: Package | null;
}

export function WizardPaymentStep({ widget, unlocked, trialDaysRemaining, pkg }: WizardPaymentStepProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (unlocked) {
    return <EmbedCodeTab widget={widget} unlocked trialDaysRemaining={trialDaysRemaining} pkg={pkg} />;
  }

  async function handlePay() {
    setLoading(true);
    setError(null);

    const res = await fetch("/api/billing/widget-launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgetId: widget.id }),
    });

    if (!res.ok) {
      setLoading(false);
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("agent.wizardPayment.error"));
      return;
    }

    const { url } = await res.json();
    window.location.href = url;
  }

  const minutes = WIDGET_LAUNCH_MINUTES;
  const features = [
    t("agent.wizardPayment.feature1"),
    t("agent.wizardPayment.feature2"),
    t("agent.wizardPayment.feature3"),
    t("agent.wizardPayment.feature4"),
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="mx-auto max-w-md">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-slate-900">{t("agent.wizardPayment.title")}</h2>
          <p className="mt-2 text-sm text-slate-500">{t("agent.wizardPayment.subtitle")}</p>
        </div>

        <div className="mt-6 rounded-xl border border-brand-200 bg-brand-50 p-5">
          <p className="text-3xl font-bold text-slate-900">
            {minutes}
            <span className="text-base font-medium text-slate-500"> {t("agent.wizardPayment.minutesSuffix")}</span>
          </p>
          <p className="mt-1 text-sm text-slate-600">{t("agent.wizardPayment.minutesDescription", { minutes })}</p>

          <ul className="mt-4 space-y-2">
            {features.map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-sm text-slate-700">
                <span className="mt-0.5 text-emerald-600">✓</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

        <button
          type="button"
          onClick={handlePay}
          disabled={loading}
          className="mt-6 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {loading ? t("agent.wizardPayment.opening") : t("agent.wizardPayment.cta")}
        </button>

        <p className="mt-3 text-center text-xs text-slate-500">
          {t("agent.wizardPayment.returnNote", { minutes })}
        </p>
        <p className="mt-1 text-center text-xs text-slate-400">{t("agent.wizardPayment.stripeNote")}</p>
      </div>
    </div>
  );
}
