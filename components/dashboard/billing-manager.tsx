"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Package, Subscription } from "@/types/database";
import { useTranslation } from "@/components/i18n/language-provider";

interface BillingManagerProps {
  hasStripeCustomer: boolean;
  subscription: Subscription | null;
  currentPackage: Package | null;
  balanceSeconds: number;
  availablePackages: Package[];
  isWithinTrial: boolean;
  trialDaysRemaining: number;
  trialMinutes: number;
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("da-DK", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

const SUBSCRIPTION_STATUS_KEYS: Record<string, string> = {
  active: "dashboardPages.billing.status.active",
  trialing: "dashboardPages.billing.status.trialing",
  past_due: "dashboardPages.billing.status.pastDue",
  canceled: "dashboardPages.billing.status.canceled",
  incomplete: "dashboardPages.billing.status.incomplete",
  incomplete_expired: "dashboardPages.billing.status.incompleteExpired",
  unpaid: "dashboardPages.billing.status.unpaid",
  paused: "dashboardPages.billing.status.paused",
};

export function BillingManager({
  hasStripeCustomer,
  subscription,
  currentPackage,
  balanceSeconds,
  availablePackages,
  isWithinTrial,
  trialDaysRemaining,
  trialMinutes,
}: BillingManagerProps) {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const checkoutResult = searchParams.get("checkout");
  const [checkingOutId, setCheckingOutId] = useState<string | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const balanceMinutes = Math.round((balanceSeconds / 60) * 100) / 100;
  const isActiveSubscription = subscription?.status === "active" || subscription?.status === "trialing";
  const showTrialBanner = isWithinTrial && !isActiveSubscription;

  async function handleCheckout(packageId: string) {
    setCheckingOutId(packageId);
    setError(null);

    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId }),
    });

    if (!res.ok) {
      setCheckingOutId(null);
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("dashboardPages.billing.checkoutErrorFallback"));
      return;
    }

    const { url } = await res.json();
    window.location.href = url;
  }

  async function handlePortal() {
    setOpeningPortal(true);
    setError(null);

    const res = await fetch("/api/billing/portal", { method: "POST" });

    if (!res.ok) {
      setOpeningPortal(false);
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("dashboardPages.billing.portalErrorFallback"));
      return;
    }

    const { url } = await res.json();
    window.location.href = url;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t("dashboardPages.billing.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("dashboardPages.billing.subtitle")}</p>
      </div>

      {checkoutResult === "success" ? (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {t("dashboardPages.billing.checkoutSuccess")}
        </div>
      ) : checkoutResult === "cancelled" ? (
        <div className="rounded-lg bg-slate-100 px-4 py-3 text-sm font-medium text-slate-600">
          {t("dashboardPages.billing.checkoutCancelled")}
        </div>
      ) : null}

      {showTrialBanner ? (
        <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700">
          {t("dashboardPages.billing.trialBanner", {
            days: trialDaysRemaining,
            dayWord: t(
              trialDaysRemaining === 1 ? "dashboardPages.billing.trialDaySingular" : "dashboardPages.billing.trialDayPlural"
            ),
            minutes: Math.max(0, balanceMinutes).toFixed(1),
            total: trialMinutes,
          })}
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("dashboardPages.billing.currentPackageLabel")}
          </p>
          {currentPackage ? (
            <>
              <p className="mt-2 text-xl font-semibold text-slate-900">{currentPackage.package_name}</p>
              <p className="mt-1 text-sm text-slate-500">
                {t("dashboardPages.billing.currentPackageSubtitle", {
                  price: formatCurrency(currentPackage.monthly_price, currentPackage.currency),
                  minutes: currentPackage.included_minutes,
                })}
              </p>
              {subscription ? (
                <p className="mt-2 text-xs font-medium text-slate-500">
                  {t("dashboardPages.billing.statusLabel", {
                    status: t(SUBSCRIPTION_STATUS_KEYS[subscription.status] ?? "") || subscription.status,
                  })}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">{t("dashboardPages.billing.noPackageYet")}</p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("dashboardPages.billing.remainingBalanceLabel")}
          </p>
          <p className="mt-2 text-xl font-semibold text-slate-900">
            {t("dashboardPages.billing.balanceValue", { value: balanceMinutes.toFixed(1) })}
          </p>
          <p className="mt-1 text-sm text-slate-500">{t("dashboardPages.billing.balanceDescription")}</p>
        </div>
      </div>

      {hasStripeCustomer ? (
        <button
          type="button"
          onClick={handlePortal}
          disabled={openingPortal}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {openingPortal ? t("dashboardPages.billing.openingPortal") : t("dashboardPages.billing.managePayment")}
        </button>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">{t("dashboardPages.billing.packagesHeading")}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {availablePackages.map((pkg) => {
            const isCurrent = currentPackage?.id === pkg.id && isActiveSubscription;
            return (
              <div
                key={pkg.id}
                className={`flex flex-col justify-between rounded-2xl border p-5 shadow-sm ${
                  isCurrent ? "border-brand-500 ring-1 ring-brand-500" : "border-slate-200 bg-white"
                }`}
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">{pkg.package_name}</p>
                  <p className="mt-2 text-2xl font-bold text-slate-900">
                    {formatCurrency(pkg.monthly_price, pkg.currency)}
                    <span className="text-sm font-medium text-slate-500"> /md</span>
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {t("dashboardPages.billing.packageIncludedMinutes", { count: pkg.included_minutes })}
                  </p>
                  {pkg.setup_fee ? (
                    <p className="mt-1 text-xs text-slate-400">
                      {t("dashboardPages.billing.setupFee", {
                        price: formatCurrency(pkg.setup_fee, pkg.currency),
                      })}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => handleCheckout(pkg.id)}
                  disabled={isCurrent || checkingOutId === pkg.id}
                  className="mt-4 w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {isCurrent
                    ? t("dashboardPages.billing.currentPlanButton")
                    : checkingOutId === pkg.id
                      ? t("dashboardPages.shared.openingCheckout")
                      : t("dashboardPages.billing.orderPackage")}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
