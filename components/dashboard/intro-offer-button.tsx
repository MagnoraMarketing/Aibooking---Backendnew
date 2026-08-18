"use client";

import { useState, type ReactNode } from "react";

// Starts the Inbound page's "30 dage til 499 kr, derefter 999 kr" intro
// offer — POSTs to the checkout route and redirects to the Stripe URL it
// returns. Used both on the free-trial landing page and the Inbound page's
// promo banner, so the "start paying" step lives in exactly one place.
export function IntroOfferButton({ className, children }: { className: string; children: ReactNode }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);

    const res = await fetch("/api/billing/intro-offer", { method: "POST" });

    if (!res.ok) {
      setLoading(false);
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? "Kunne ikke starte betalingen. Prøv igen.");
      return;
    }

    const { url } = await res.json();
    window.location.href = url;
  }

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={loading} className={className}>
        {loading ? "Åbner betaling…" : children}
      </button>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
