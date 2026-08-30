"use client";

import { useState } from "react";

interface TwilioCallMinutesSummary {
  balance: number;
  currency: string;
  inboundMinutesUsed: number;
  outboundMinutesUsed: number;
  inboundMinutesRemaining: number | null;
  outboundMinutesRemaining: number | null;
}

// Shows a BYO-Twilio number's live account balance and minutes used, split
// inbound/outbound — see app/api/customer/phone-numbers/[id]/twilio-usage.
// Loaded on demand (a button, not automatic) since it costs the customer's
// Twilio account three live API calls every time it's fetched — no reason
// to pay that on every dashboard visit if nobody's looking.
export function TwilioBalanceCard({ phoneNumberId }: { phoneNumberId: string }) {
  const [summary, setSummary] = useState<TwilioCallMinutesSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadSummary() {
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/customer/phone-numbers/${phoneNumberId}/twilio-usage`);
    setLoading(false);
    setLoaded(true);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? "Kunne ikke hente Twilio-forbrug.");
      return;
    }
    setSummary(await res.json());
  }

  if (!loaded) {
    return (
      <button
        type="button"
        onClick={() => void loadSummary()}
        disabled={loading}
        className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-60"
      >
        {loading ? "Henter Twilio-forbrug…" : "Vis Twilio-forbrug →"}
      </button>
    );
  }

  if (error) {
    return (
      <p className="text-xs text-red-600">
        {error}{" "}
        <button type="button" onClick={() => void loadSummary()} className="font-medium underline">
          Prøv igen
        </button>
      </p>
    );
  }

  if (!summary) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
      <div className="flex items-center justify-between">
        <p className="font-medium text-slate-700">
          Twilio-saldo: {summary.balance.toFixed(2)} {summary.currency}
        </p>
        <button
          type="button"
          onClick={() => void loadSummary()}
          disabled={loading}
          className="font-medium text-brand-600 hover:text-brand-700 disabled:opacity-60"
        >
          {loading ? "Opdaterer…" : "Opdater"}
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div>
          <p className="font-medium text-slate-700">Indgående</p>
          <p>{summary.inboundMinutesUsed.toFixed(1)} min brugt</p>
          {summary.inboundMinutesRemaining !== null ? (
            <p className="text-slate-500">ca. {summary.inboundMinutesRemaining} min tilbage</p>
          ) : null}
        </div>
        <div>
          <p className="font-medium text-slate-700">Udgående</p>
          <p>{summary.outboundMinutesUsed.toFixed(1)} min brugt</p>
          {summary.outboundMinutesRemaining !== null ? (
            <p className="text-slate-500">ca. {summary.outboundMinutesRemaining} min tilbage</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
