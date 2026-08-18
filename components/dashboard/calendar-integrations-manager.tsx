"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Widget } from "@/types/database";
import type { CalendarConnectionSummary } from "@/app/dashboard/integrations/page";

interface CalcomEventType {
  id: number;
  title: string;
}

interface CalendarIntegrationsManagerProps {
  widgets: Widget[];
  initialConnections: CalendarConnectionSummary[];
  eventTypesByConnection: Record<string, CalcomEventType[]>;
}

const PROVIDERS = [
  {
    key: "google" as const,
    name: "Google Calendar",
    category: "Kalender",
    popular: true,
    description: "Den mest udbredte kalender blandt danske virksomheder. Forbindes med ét klik via Google.",
    kind: "oauth" as const,
  },
  {
    key: "outlook" as const,
    name: "Outlook",
    category: "Kalender",
    popular: true,
    description: "Til virksomheder der bruger Microsoft 365 eller Outlook som kalender.",
    kind: "oauth" as const,
  },
  {
    key: "calcom" as const,
    name: "Cal.com",
    category: "Kalender",
    popular: false,
    description: "Forbind med jeres Cal.com API-nøgle og vælg hvilken event-type agenten skal booke i.",
    kind: "apikey" as const,
  },
];

// Everything else from aibooking.dk/integrationer's "Populære Integrationer"
// showcase that this app doesn't build yet — shown in the same grid as the
// working calendar providers above so the page reads as one coherent
// roadmap, each clearly labelled "Kommer snart" rather than offering a
// button that would do nothing.
const COMING_SOON = [
  { name: "WhatsApp", category: "Kommunikation", popular: true },
  { name: "Slack", category: "Kommunikation", popular: false },
  { name: "Shopify", category: "E-handel", popular: true },
  { name: "Notion", category: "Produktivitet", popular: false },
  { name: "WordPress", category: "Hjemmeside", popular: true },
  { name: "Zapier", category: "Automatisering", popular: true },
  { name: "Zoom", category: "Video", popular: true },
  { name: "Microsoft Teams", category: "Video", popular: false },
  { name: "Messenger", category: "Kommunikation", popular: false },
  { name: "Discord", category: "Kommunikation", popular: false },
  { name: "Webhooks", category: "Udvikler", popular: true },
  { name: "REST API", category: "Udvikler", popular: true },
  { name: "HubSpot", category: "CRM", popular: false },
  { name: "Salesforce", category: "CRM", popular: false },
  { name: "Pipedrive", category: "CRM", popular: false },
  { name: "CalDAV", category: "Kalender", popular: false },
  { name: "Google Docs", category: "Dokumenter", popular: false },
  { name: "WooCommerce", category: "E-handel", popular: false },
  { name: "Stripe", category: "E-handel", popular: false },
  { name: "Make", category: "Automatisering", popular: false },
];

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function CalendarIntegrationsManager({
  widgets,
  initialConnections,
  eventTypesByConnection,
}: CalendarIntegrationsManagerProps) {
  const [connections, setConnections] = useState(initialConnections);
  const [widgetId, setWidgetId] = useState(widgets[0]?.id ?? "");
  const [calcomForm, setCalcomForm] = useState<{ apiKey: string; open: boolean }>({ apiKey: "", open: false });
  const [calcomConnecting, setCalcomConnecting] = useState(false);
  const [calcomError, setCalcomError] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [changingEventTypeId, setChangingEventTypeId] = useState<string | null>(null);
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

  async function handleTestConnection(connectionId: string) {
    setTestingId(connectionId);
    setTestMessage(null);

    const res = await fetch(`/api/customer/calendar/${connectionId}/test`, { method: "POST" });
    setTestingId(null);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setTestMessage({ id: connectionId, ok: false, text: data?.error?.message ?? "Kunne ikke forbinde til Cal.com." });
      return;
    }

    const { connection } = await res.json();
    setConnections((prev) => prev.map((c) => (c.id === connectionId ? connection : c)));
    setTestMessage({ id: connectionId, ok: true, text: "Forbindelsen virker." });
  }

  async function handleChangeEventType(connectionId: string, eventTypeId: number) {
    setChangingEventTypeId(connectionId);

    const res = await fetch(`/api/customer/calendar/${connectionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventTypeId }),
    });
    setChangingEventTypeId(null);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setTestMessage({ id: connectionId, ok: false, text: data?.error?.message ?? "Kunne ikke skifte event-type." });
      return;
    }

    const { connection } = await res.json();
    setConnections((prev) => prev.map((c) => (c.id === connectionId ? connection : c)));
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-slate-900">Populære Integrationer</h2>
        <p className="mt-1 text-sm text-slate-500">
          Arbejd problemfrit med jeres eksisterende værktøjer — forbind jeres kalender nedenfor, så agenten kan se
          ledige tider og booke direkte.
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
                      ) : provider.popular ? (
                        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-600">
                          Populær
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">{provider.category}</p>
                    <p className="mt-1 text-xs text-slate-500">{provider.description}</p>
                    {connection && connection.provider !== "calcom" && connection.external_account_email ? (
                      <p className="mt-2 text-xs font-medium text-slate-600">{connection.external_account_email}</p>
                    ) : null}

                    {connection && connection.provider === "calcom" ? (
                      <div className="mt-3 space-y-2.5 border-t border-slate-100 pt-3">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              connection.status === "connected" ? "bg-emerald-500" : "bg-red-500"
                            }`}
                          />
                          <span className="font-medium text-slate-700">
                            {connection.status === "connected" ? "Connected" : "Fejl — tjek forbindelsen"}
                          </span>
                        </div>

                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Account</p>
                          <p className="text-xs text-slate-700">{connection.external_account_email ?? "—"}</p>
                        </div>

                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Event Type</p>
                          <select
                            value={connection.calcom_event_type_id ?? ""}
                            onChange={(e) => handleChangeEventType(connection.id, Number(e.target.value))}
                            disabled={changingEventTypeId === connection.id}
                            className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
                          >
                            {(eventTypesByConnection[connection.id] ?? []).map((eventType) => (
                              <option key={eventType.id} value={eventType.id}>
                                {eventType.title}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Timezone</p>
                          <p className="text-xs text-slate-700">{connection.calcom_timezone ?? "—"}</p>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleTestConnection(connection.id)}
                          disabled={testingId === connection.id}
                          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          {testingId === connection.id ? "Tester…" : "Test forbindelse"}
                        </button>
                        {testMessage?.id === connection.id ? (
                          <p className={`text-xs ${testMessage.ok ? "text-emerald-600" : "text-red-600"}`}>{testMessage.text}</p>
                        ) : null}
                      </div>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        {COMING_SOON.map((tool) => (
          <div
            key={tool.name}
            className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 opacity-90"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-xs font-semibold text-slate-600">
              {initials(tool.name)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-sm font-semibold text-slate-800">{tool.name}</p>
                {tool.popular ? (
                  <span className="rounded-full bg-white px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                    Populær
                  </span>
                ) : null}
              </div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">{tool.category}</p>
              <span className="mt-1 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                Kommer snart
              </span>
            </div>
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-slate-500">
        Mangler I en integration? Vi tilføjer løbende nye — skriv til support, så hører I fra os når den lander.
      </p>
    </div>
  );
}
