"use client";

import { useState } from "react";
import type { WidgetWithExtras } from "../agent-configurator";
import { useTranslation } from "@/components/i18n/language-provider";
import { StepFooter, StepHeader, secondaryButtonClass } from "../agent-flow-ui";

// Lets Cal.com be set up during agent creation itself, not just from the
// separate Integrations page — same POST /api/customer/calendar/calcom
// used there (see calendar-integrations-manager.tsx), just a single-field
// version: paste the API key, and the first event type is picked
// automatically (changeable afterwards under Integrations). Optional —
// "Spring over" leaves the agent bookable via the widget/phone only, no
// calendar wired up yet.
export function WizardCalendarStep({
  widget,
  onNext,
  onBack,
}: {
  widget: WidgetWithExtras;
  onNext: () => void;
  onBack?: () => void;
}) {
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
    <div className="space-y-5">
      <StepHeader title={t("agent.wizardCalendar.title")} description={t("agent.wizardCalendar.description")} />

      {connected ? (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {t("agent.wizardCalendar.connectedMessage")}
        </div>
      ) : (
        <div>
          <label htmlFor="wizard-calcom-key" className="mb-1 block text-sm font-medium text-slate-700">
            {t("agent.wizardCalendar.apiKeyLabel")}
          </label>
          <input
            id="wizard-calcom-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="cal_live_xxxxxxxxxxxx"
            className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-3 text-base outline-none sm:py-2 sm:text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
          <p className="mt-1 text-xs text-slate-500">{t("agent.wizardCalendar.apiKeyHelp")}</p>
        </div>
      )}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {/* Connecting is the step's own action; moving on is the shared
          footer's. Skipping is fine — a calendar can be connected later
          under Integrations. */}
      {!connected ? (
        <button type="button" onClick={handleConnect} disabled={connecting} className={secondaryButtonClass}>
          {connecting ? t("agent.wizardCalendar.connecting") : t("agent.wizardCalendar.connectButton")}
        </button>
      ) : null}

      <StepFooter
        onBack={onBack}
        onSkip={connected ? undefined : onNext}
        primary={connected ? { label: t("agent.wizard.nextArrow"), onClick: onNext } : undefined}
      />
    </div>
  );
}
