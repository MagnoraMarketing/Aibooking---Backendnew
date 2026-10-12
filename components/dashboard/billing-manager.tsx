"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Package, Subscription } from "@/types/database";
import { useTranslation } from "@/components/i18n/language-provider";

interface TransactionRow {
  id: string;
  description: string | null;
  amountSeconds: number;
  createdAt: string;
}

interface BillingManagerProps {
  hasStripeCustomer: boolean;
  subscription: Subscription | null;
  currentPackage: Package | null;
  balanceSeconds: number;
  availablePackages: Package[];
  isWithinTrial: boolean;
  trialDaysRemaining: number;
  trialMinutes: number;
  transactions: TransactionRow[];
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

function formatMinutes(seconds: number): string {
  return (Math.round((seconds / 60) * 10) / 10).toFixed(1);
}

export function BillingManager({
  hasStripeCustomer,
  subscription,
  currentPackage,
  balanceSeconds,
  availablePackages,
  isWithinTrial,
  trialDaysRemaining,
  trialMinutes,
  transactions,
}: BillingManagerProps) {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const checkoutResult = searchParams.get("checkout");
  const [checkingOutId, setCheckingOutId] = useState<string | null>(null);
  const [includeSetup, setIncludeSetup] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const balanceMinutes = Math.round((balanceSeconds / 60) * 100) / 100;
  const isActiveSubscription = subscription?.status === "active" || subscription?.status === "trialing";
  const showTrialBanner = isWithinTrial && !isActiveSubscription;
  const paymentFailed = subscription?.status === "past_due" || subscription?.status === "unpaid";

  // Rollover (see subscription-sync.ts) can leave the balance above the
  // package's included_minutes, in which case the bar simply reads as a
  // fresh, untouched pool rather than showing a nonsensical >100% used.
  const includedMinutes = currentPackage?.included_minutes ?? 0;
  const remainingOfCycle = Math.max(0, Math.min(balanceMinutes, includedMinutes));
  const usedOfCycle = Math.max(0, includedMinutes - remainingOfCycle);
  const usedPercent = includedMinutes > 0 ? Math.min(100, Math.round((usedOfCycle / includedMinutes) * 100)) : 0;

  async function handleCheckout(packageId: string) {
    setCheckingOutId(packageId);
    setError(null);

    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId, includeSetup }),
    });

    if (!res.ok) {
      setCheckingOutId(null);
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("dashboardPages.billing.checkoutErrorFallback"));
      return;
    }

    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
      return;
    }

    // A package switch (existing subscription updated in place) has no
    // checkout URL to redirect to — just reflect the new state.
    setCheckingOutId(null);
    window.location.reload();
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

      {paymentFailed ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          <p>{t("dashboardPages.billing.paymentFailedMessage")}</p>
          <button
            type="button"
            onClick={handlePortal}
            disabled={openingPortal}
            className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {t("dashboardPages.billing.updateCard")}
          </button>
        </div>
      ) : null}

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

              {includedMinutes > 0 ? (
                <div className="mt-4">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${usedPercent >= 90 ? "bg-amber-500" : "bg-brand-500"}`}
                      style={{ width: `${usedPercent}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">
                    {t("dashboardPages.billing.minutesUsedOfIncluded", {
                      used: usedOfCycle.toFixed(0),
                      included: includedMinutes,
                    })}
                  </p>
                </div>
              ) : null}

              {isActiveSubscription && subscription?.status !== "past_due" ? (
                <p className="mt-3 text-xs text-slate-500">
                  {t("dashboardPages.billing.autoRechargeNote", {
                    minutes: currentPackage.included_minutes,
                    price: formatCurrency(currentPackage.monthly_price, currentPackage.currency),
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{t("dashboardPages.billing.packagesHeading")}</h2>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={includeSetup}
              onChange={(e) => setIncludeSetup(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            {t("dashboardPages.billing.includeSetupLabel")}
          </label>
        </div>
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
                      : isActiveSubscription
                        ? t("dashboardPages.billing.switchToPackage")
                        : t("dashboardPages.billing.orderPackage")}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">{t("dashboardPages.billing.paymentHistoryHeading")}</h2>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-slate-100">
              {transactions.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500">{t("dashboardPages.billing.noTransactionsYet")}</td>
                </tr>
              ) : (
                transactions.map((txn) => (
                  <tr key={txn.id}>
                    <td className="px-4 py-3 text-slate-700">{txn.description ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900">
                      {txn.amountSeconds >= 0 ? "+" : ""}
                      {formatMinutes(txn.amountSeconds)} {t("adminPages.shared.minutesUnit")}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-slate-500">
                      {new Date(txn.createdAt).toLocaleDateString("da-DK")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
