"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Widget } from "@/types/database";
import type { CalendarConnectionSummary } from "@/app/dashboard/integrations/page";

interface CalendarIntegrationsManagerProps {
  widgets: Widget[];
  initialConnections: CalendarConnectionSummary[];
}

const PROVIDERS = [
  {
    key: "google" as const,
    name: "Google Kalender",
    description: "Den mest udbredte kalender blandt danske virksomheder. Forbindes med ét klik via Google.",
    kind: "oauth" as const,
  },
  {
    key: "outlook" as const,
    name: "Outlook / Microsoft 365",
    description: "Til virksomheder der bruger Microsoft 365 eller Outlook som kalender.",
    kind: "oauth" as const,
  },
  {
    key: "calcom" as const,
    name: "Cal.com",
    description: "Forbind med jeres Cal.com API-nøgle og vælg hvilken event-type agenten skal booke i.",
    kind: "apikey" as const,
  },
];

export function CalendarIntegrationsManager({ widgets, initialConnections }: CalendarIntegrationsManagerProps) {
  const [connections, setConnections] = useState(initialConnections);
  const [widgetId, setWidgetId] = useState(widgets[0]?.id ?? "");
  const [calcomForm, setCalcomForm] = useState<{ apiKey: string; open: boolean }>({ apiKey: "", open: false });
  const [calcomConnecting, setCalcomConnecting] = useState(false);
  const [calcomError, setCalcomError] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const searchParams = useSearchParams();

  const banner = useMemo(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("calendarError");
    if (connected) return { type: "success" as const, provider: connected };
    if (error) return { type: "error" as const, provider: error };
    return null;
  }, [searchParams]);

  const connectionForProvider = (provider: string) =>
    connections.find((c) => c.widget_id === widgetId && c.provider === provider) ?? null;

  async function handleDisconnect(connectionId: string) {
    setDisconnectingId(connectionId);
    const res = await fetch(`/api/customer/calendar/${connectionId}`, { method: "DELETE" });
    setDisconnectingId(null);
    if (res.ok) {
      setConnections((prev) => prev.filter((c) => c.id !== connectionId));
    }
  }

  async function handleCalcomConnect() {
    if (!calcomForm.apiKey.trim()) {
      setCalcomError("Indsæt jeres Cal.com API-nøgle.");
      return;
    }
    setCalcomConnecting(true);
    setCalcomError(null);

    const res = await fetch("/api/customer/calendar/calcom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgetId, apiKey: calcomForm.apiKey.trim() }),
    });

    setCalcomConnecting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setCalcomError(data?.error?.message ?? "Kunne ikke forbinde Cal.com.");
      return;
    }

    const { connection } = await res.json();
    setConnections((prev) => [connection, ...prev.filter((c) => c.id !== connection.id)]);
    setCalcomForm({ apiKey: "", open: false });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Integrationer</h1>
        <p className="mt-1 text-sm text-slate-500">
          Forbind jeres kalender, så agenten kan se ledige tider og booke direkte i jeres kalender.
        </p>
      </div>

      {banner ? (
        <div
          className={`rounded-lg px-4 py-3 text-sm font-medium ${
            banner.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {banner.type === "success"
            ? `Kalenderen blev forbundet (${banner.provider}).`
            : `Kunne ikke forbinde kalenderen (${banner.provider}). Prøv igen.`}
        </div>
      ) : null}

      {widgets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Opret en agent under &quot;Agent&quot; f&oslash;rst &mdash; en kalender skal knyttes til en agent.
        </div>
      ) : (
        <>
          <div className="max-w-sm">
            <label htmlFor="calendar-widget" className="mb-1 block text-sm font-medium text-slate-700">
              Agent
            </label>
            <select
              id="calendar-widget"
              value={widgetId}
              onChange={(e) => setWidgetId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            >
              {widgets.map((widget) => (
                <option key={widget.id} value={widget.id}>
                  {widget.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {PROVIDERS.map((provider) => {
              const connection = connectionForProvider(provider.key);
              return (
                <div key={provider.key} className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div>
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-slate-900">{provider.name}</h2>
                      {connection ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          Forbundet
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{provider.description}</p>
                    {connection?.external_account_email ? (
                      <p className="mt-2 text-xs font-medium text-slate-600">{connection.external_account_email}</p>
                    ) : null}
                    {connection?.provider === "calcom" && connection.calcom_event_type_id ? (
                      <p className="mt-2 text-xs font-medium text-slate-600">
                        Event-type-id: {connection.calcom_event_type_id}
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-4">
                    {connection ? (
                      <button
                        type="button"
                        onClick={() => handleDisconnect(connection.id)}
                        disabled={disconnectingId === connection.id}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {disconnectingId === connection.id ? "Fjerner…" : "Fjern forbindelse"}
                      </button>
                    ) : provider.kind === "oauth" ? (
                      <a
                        href={`/api/customer/calendar/${provider.key}/connect?widgetId=${widgetId}`}
                        className="block w-full rounded-lg bg-brand-600 px-3 py-2 text-center text-xs font-medium text-white hover:bg-brand-700"
                      >
                        Forbind {provider.name} →
                      </a>
                    ) : calcomForm.open ? (
                      <div className="space-y-2">
                        <input
                          value={calcomForm.apiKey}
                          onChange={(e) => setCalcomForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                          type="password"
                          placeholder="cal_live_xxxxxxxxxxxx"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                        />
                        {calcomError ? <p className="text-xs text-red-600">{calcomError}</p> : null}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setCalcomForm({ apiKey: "", open: false })}
                            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Annuller
                          </button>
                          <button
                            type="button"
                            onClick={handleCalcomConnect}
                            disabled={calcomConnecting}
                            className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                          >
                            {calcomConnecting ? "Forbinder…" : "Forbind"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setCalcomForm({ apiKey: "", open: true })}
                        className="w-full rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700"
                      >
                        Forbind {provider.name} →
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
