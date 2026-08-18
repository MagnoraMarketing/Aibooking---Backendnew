"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Package, Subscription } from "@/types/database";

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

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  active: "Aktivt",
  trialing: "Prøveperiode (Stripe)",
  past_due: "Betaling mangler",
  canceled: "Opsagt",
  incomplete: "Ikke fuldført",
  incomplete_expired: "Udløbet",
  unpaid: "Ikke betalt",
  paused: "Sat på pause",
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
      setError(data?.error?.message ?? "Kunne ikke åbne betaling. Prøv igen.");
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
      setError(data?.error?.message ?? "Kunne ikke åbne betalingsportalen.");
      return;
    }

    const { url } = await res.json();
    window.location.href = url;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Betaling</h1>
        <p className="mt-1 text-sm text-slate-500">Administrer jeres pakke, forbrug og betalingsmetode.</p>
      </div>

      {checkoutResult === "success" ? (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          Betaling gennemført — jeres pakke er nu aktiv.
        </div>
      ) : checkoutResult === "cancelled" ? (
        <div className="rounded-lg bg-slate-100 px-4 py-3 text-sm font-medium text-slate-600">
          Betalingen blev annulleret — der er ikke sket noget.
        </div>
      ) : null}

      {showTrialBanner ? (
        <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700">
          I er i gratis prøveperiode: {trialDaysRemaining} {trialDaysRemaining === 1 ? "dag" : "dage"} tilbage, og{" "}
          {Math.max(0, balanceMinutes).toFixed(1)} af {trialMinutes} prøve-minutter tilbage. Prøveperioden slutter
          når enten dagene eller minutterne er brugt op — alt efter hvad der sker først.
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nuværende pakke</p>
          {currentPackage ? (
            <>
              <p className="mt-2 text-xl font-semibold text-slate-900">{currentPackage.package_name}</p>
              <p className="mt-1 text-sm text-slate-500">
                {formatCurrency(currentPackage.monthly_price, currentPackage.currency)} / md ·{" "}
                {currentPackage.included_minutes} minutter inkluderet
              </p>
              {subscription ? (
                <p className="mt-2 text-xs font-medium text-slate-500">
                  Status: {SUBSCRIPTION_STATUS_LABELS[subscription.status] ?? subscription.status}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Ingen pakke valgt endnu.</p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resterende saldo</p>
          <p className="mt-2 text-xl font-semibold text-slate-900">{balanceMinutes.toFixed(1)} minutter</p>
          <p className="mt-1 text-sm text-slate-500">
            Ubrugte minutter gemmes i op til 3 måneder, når pakken fornyes automatisk.
          </p>
        </div>
      </div>

      {hasStripeCustomer ? (
        <button
          type="button"
          onClick={handlePortal}
          disabled={openingPortal}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {openingPortal ? "Åbner…" : "Administrer betaling / opsig abonnement →"}
        </button>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Pakker</h2>
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
                  <p className="mt-1 text-sm text-slate-500">{pkg.included_minutes} minutter inkluderet</p>
                  {pkg.setup_fee ? (
                    <p className="mt-1 text-xs text-slate-400">
                      Engangspris på {formatCurrency(pkg.setup_fee, pkg.currency)} for opsætning og onboarding
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => handleCheckout(pkg.id)}
                  disabled={isCurrent || checkingOutId === pkg.id}
                  className="mt-4 w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {isCurrent ? "Jeres nuværende pakke" : checkingOutId === pkg.id ? "Åbner betaling…" : "Bestil pakke →"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
