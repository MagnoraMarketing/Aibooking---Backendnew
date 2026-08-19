"use client";

import { useState } from "react";
import type { WidgetWithExtras } from "../agent-configurator";
import { useTranslation } from "@/components/i18n/language-provider";

// Lets Cal.com be set up during agent creation itself, not just from the
// separate Integrations page — same POST /api/customer/calendar/calcom
// used there (see calendar-integrations-manager.tsx), just a single-field
// version: paste the API key, and the first event type is picked
// automatically (changeable afterwards under Integrations). Optional —
// "Spring over" leaves the agent bookable via the widget/phone only, no
// calendar wired up yet.
export function WizardCalendarStep({ widget, onNext }: { widget: WidgetWithExtras; onNext: () => void }) {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  async function handleConnect() {
    if (!apiKey.trim()) {
      setError(t("agent.wizardCalendar.errorApiKeyRequired"));
      return;
    }
    setConnecting(true);
    setError(null);

    const res = await fetch("/api/customer/calendar/calcom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgetId: widget.id, apiKey: apiKey.trim() }),
    });

    setConnecting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("agent.wizardCalendar.errorConnectFailed"));
      return;
    }

    setConnected(true);
  }

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Kalender</h2>
        <p className="mt-1 text-sm text-slate-500">
          Forbind Cal.com, så agenten kan tjekke ledige tider og booke møder direkte under samtalen — kan tilføjes
          senere under Integrationer, hvis I springer det over nu.
        </p>
      </div>

      {connected ? (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Cal.com forbundet. I kan vælge event-type og teste forbindelsen under Integrationer.
        </div>
      ) : (
        <div>
          <label htmlFor="wizard-calcom-key" className="mb-1 block text-sm font-medium text-slate-700">
            Cal.com API-nøgle
          </label>
          <input
            id="wizard-calcom-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="cal_live_xxxxxxxxxxxx"
            className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
          <p className="mt-1 text-xs text-slate-500">
            Findes under Cal.com → Settings → Developer → API keys.
          </p>
        </div>
      )}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onNext}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {connected ? "Næste →" : "Spring over"}
        </button>
        {!connected ? (
          <button
            type="button"
            onClick={handleConnect}
            disabled={connecting}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {connecting ? "Forbinder…" : "Forbind Cal.com →"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
