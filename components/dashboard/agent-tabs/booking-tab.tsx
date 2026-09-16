"use client";

import { useCallback, useEffect, useState } from "react";
import type { BookingSetupRequestStatus } from "@/types/database";
import type { WidgetWithExtras } from "../agent-configurator";

interface BookingTabProps {
  widget: WidgetWithExtras;
}

interface SetupRequest {
  id: string;
  status: BookingSetupRequestStatus;
  notes: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface CalendarConnection {
  id: string;
  widget_id: string;
  provider: "google" | "outlook" | "calcom";
  status: "connected" | "error";
  external_account_email: string | null;
  calcom_event_type_id: string | null;
  created_at: string;
}

interface CalcomEventType {
  id: number;
  title: string;
}

// The steps our team works through once booking is ordered. Shown to the
// customer as a progress list so "vi er i gang" is something they can see
// rather than something they have to ask about.
const SETUP_STEPS = [
  "Bestilling modtaget",
  "Kalender oprettet",
  "Jeres kalender forbundet",
  "Ydelser og tider sat op",
  "Stemmeagent forbundet",
  "Booking testet",
] as const;

// How far through SETUP_STEPS each status is. 'completed' lights all of them.
const STEPS_DONE: Record<BookingSetupRequestStatus, number> = {
  pending: 1,
  in_progress: 3,
  completed: SETUP_STEPS.length,
  cancelled: 0,
};

const STATUS_LABEL: Record<BookingSetupRequestStatus, string> = {
  pending: "Bestilt — vi går i gang",
  in_progress: "Under opsætning",
  completed: "Aktiv",
  cancelled: "Annulleret",
};

const CALCOM_API_KEYS_URL = "https://app.cal.com/settings/developer/api-keys";
const CALCOM_EVENT_TYPES_URL = "https://app.cal.com/event-types";

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return data?.error?.message ?? fallback;
}

export function BookingTab({ widget }: BookingTabProps) {
  const [request, setRequest] = useState<SetupRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [ordering, setOrdering] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showConcierge, setShowConcierge] = useState(false);

  // Cal.com is where bookings actually land, so connecting it is what makes
  // the agent able to book. `live` mirrors widgets.booking_enabled, which the
  // connect/disconnect endpoints flip server-side — kept in local state so
  // the tab reflects the change without a page reload.
  const [live, setLive] = useState(widget.booking_enabled);
  const [connection, setConnection] = useState<CalendarConnection | null>(null);
  const [eventTypes, setEventTypes] = useState<CalcomEventType[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [eventTypeIdInput, setEventTypeIdInput] = useState("");
  // Separate from the one above: that one is part of the connect form, this
  // one is the fallback shown on an already-connected calendar whose event
  // types Cal.com won't list.
  const [manualEventTypeId, setManualEventTypeId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarNotice, setCalendarNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"test" | "eventType" | "disconnect" | null>(null);

  const loadEventTypes = useCallback(async (connectionId: string) => {
    const res = await fetch(`/api/customer/calendar/${connectionId}/event-types`);
    if (!res.ok) {
      // A key that has since been revoked just yields no choices — the
      // "Test forbindelse" button is what explains that clearly.
      setEventTypes([]);
      return;
    }
    const data = await res.json();
    setEventTypes(data.eventTypes ?? []);
  }, []);

  const load = useCallback(async () => {
    const [setupRes, calendarRes] = await Promise.all([
      fetch(`/api/customer/widgets/${widget.id}/booking-setup`),
      fetch("/api/customer/calendar"),
    ]);

    if (setupRes.ok) {
      const data = await setupRes.json();
      setRequest(data.request ?? null);
    }

    if (calendarRes.ok) {
      const data = await calendarRes.json();
      const own = (data.connections as CalendarConnection[] | undefined)?.find(
        (c) => c.widget_id === widget.id && c.provider === "calcom"
      );
      setConnection(own ?? null);
      if (own) await loadEventTypes(own.id);
    }

    setLoading(false);
  }, [widget.id, loadEventTypes]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleConnect() {
    if (!apiKey.trim()) {
      setCalendarError("Indsæt jeres Cal.com API-nøgle først.");
      return;
    }
    setConnecting(true);
    setCalendarError(null);
    setCalendarNotice(null);

    // The event type decides WHICH calendar and which service the agent
    // books — left blank the server picks the account's first one, which is a
    // guess, and a shop with several event types would have the agent booking
    // into the wrong one.
    const trimmedEventTypeId = eventTypeIdInput.trim();
    const parsedEventTypeId = trimmedEventTypeId ? Number(trimmedEventTypeId) : undefined;
    if (trimmedEventTypeId && (!Number.isInteger(parsedEventTypeId) || (parsedEventTypeId ?? 0) <= 0)) {
      setCalendarError("Event-type ID skal være et tal — det står i URL'en på Cal.com under Event Types.");
      setConnecting(false);
      return;
    }

    const res = await fetch("/api/customer/calendar/calcom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        widgetId: widget.id,
        apiKey: apiKey.trim(),
        ...(parsedEventTypeId ? { eventTypeId: parsedEventTypeId } : {}),
      }),
    });
    setConnecting(false);

    if (!res.ok) {
      setCalendarError(await errorMessage(res, "Kunne ikke forbinde til Cal.com. Tjek nøglen og prøv igen."));
      return;
    }

    const data = await res.json();
    setConnection(data.connection);
    setEventTypes(data.eventTypes ?? []);
    setApiKey("");
    setEventTypeIdInput("");
    setLive(true);
    setCalendarNotice("Kalenderen er forbundet, og agenten kan nu booke tider.");
  }

  async function handleManualEventTypeSave() {
    const parsed = Number(manualEventTypeId.trim());
    if (!Number.isInteger(parsed) || parsed <= 0) {
      setCalendarError("Event-type ID skal være et positivt heltal — det står i Cal.com-URL'en for event-typen.");
      return;
    }
    await handleEventTypeChange(parsed);
    setManualEventTypeId("");
  }

  async function handleEventTypeChange(eventTypeId: number) {
    if (!connection) return;
    setBusy("eventType");
    setCalendarError(null);
    setCalendarNotice(null);

    const res = await fetch(`/api/customer/calendar/${connection.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventTypeId }),
    });
    setBusy(null);

    if (!res.ok) {
      setCalendarError(await errorMessage(res, "Kunne ikke skifte event-type."));
      return;
    }
    const data = await res.json();
    setConnection(data.connection);
    setCalendarNotice("Agenten booker nu på den valgte event-type.");
  }

  async function handleTest() {
    if (!connection) return;
    setBusy("test");
    setCalendarError(null);
    setCalendarNotice(null);

    const res = await fetch(`/api/customer/calendar/${connection.id}/test`, { method: "POST" });
    setBusy(null);

    if (!res.ok) {
      setCalendarError(await errorMessage(res, "Forbindelsen svarede ikke. Tjek jeres API-nøgle på Cal.com."));
      return;
    }
    const data = await res.json();
    setConnection(data.connection);
    setCalendarNotice("Forbindelsen til Cal.com virker.");
  }

  async function handleDisconnect() {
    if (!connection) return;
    setBusy("disconnect");
    setCalendarError(null);
    setCalendarNotice(null);

    const res = await fetch(`/api/customer/calendar/${connection.id}`, { method: "DELETE" });
    setBusy(null);

    if (!res.ok) {
      setCalendarError(await errorMessage(res, "Kunne ikke afbryde forbindelsen."));
      return;
    }
    setConnection(null);
    setEventTypes([]);
    setLive(false);
    setCalendarNotice("Kalenderen er afbrudt, og agenten booker ikke længere.");
  }

  async function handleOrder() {
    setOrdering(true);
    setError(null);
    const res = await fetch(`/api/customer/widgets/${widget.id}/booking-setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(notes.trim() ? { notes: notes.trim() } : {}),
    });
    setOrdering(false);

    if (!res.ok) {
      setError(await errorMessage(res, "Bestillingen kunne ikke sendes. Prøv igen."));
      return;
    }
    const data = await res.json();
    setRequest(data.request ?? null);
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Henter…</p>;
  }

  const stepsDone = live ? SETUP_STEPS.length : request ? STEPS_DONE[request.status] : 0;
  const selectedEventTypeId = connection?.calcom_event_type_id ? Number(connection.calcom_event_type_id) : null;
  const conciergeInProgress = !!request && request.status !== "cancelled" && !live;

  return (
    <div className="space-y-6">
      <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Booking</h2>
            <p className="mt-1 text-sm text-slate-600">
              Lader agenten finde ledige tider og booke, flytte og aflyse aftaler i jeres kalender.
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
              live
                ? "bg-emerald-50 text-emerald-700"
                : conciergeInProgress
                  ? "bg-amber-50 text-amber-700"
                  : "bg-slate-100 text-slate-500"
            }`}
          >
            {live ? "Aktiv" : request ? STATUS_LABEL[request.status] : "Ikke tilvalgt"}
          </span>
        </div>

        {live && connection ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            Agenten kan booke tider. Prøv den under <strong>Test Agent</strong> — bed om en tid og se at
            den kun tilbyder tidspunkter der faktisk er ledige i jeres kalender.
          </p>
        ) : null}

        {/* -------------------------------------------------------------
            Cal.com — the self-service path. One pasted API key is all the
            agent needs: the server verifies it against Cal.com, stores it
            encrypted, picks up the event types, and turns booking on.
        ------------------------------------------------------------- */}
        <div className="space-y-4 rounded-xl border border-slate-200 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Cal.com-kalender</h3>
              <p className="mt-1 text-sm text-slate-500">
                {connection
                  ? "Agenten booker i denne kalender."
                  : "Forbind jeres Cal.com-konto, så agenten kan booke møder direkte fra hjemmesiden."}
              </p>
            </div>
            {connection ? (
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                  connection.status === "connected" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                }`}
              >
                {connection.status === "connected" ? "Forbundet" : "Fejl på forbindelsen"}
              </span>
            ) : null}
          </div>

          {connection ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500">Konto</dt>
                  <dd className="font-medium text-slate-800">{connection.external_account_email ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Forbundet</dt>
                  <dd className="font-medium text-slate-800">
                    {new Date(connection.created_at).toLocaleDateString("da-DK")}
                  </dd>
                </div>
              </dl>

              <div>
                <label htmlFor="calcom-event-type" className="mb-1 block text-sm font-medium text-slate-700">
                  Event-type agenten booker
                </label>
                {eventTypes.length > 0 ? (
                  <select
                    id="calcom-event-type"
                    value={selectedEventTypeId ?? ""}
                    disabled={busy === "eventType"}
                    onChange={(e) => void handleEventTypeChange(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
                  >
                    {eventTypes.map((eventType) => (
                      <option key={eventType.id} value={eventType.id}>
                        {eventType.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-slate-500">
                      Cal.com viser ingen event-typer for denne nøgle
                      {selectedEventTypeId ? ` — agenten booker på id ${selectedEventTypeId}` : ""}. Det sker blandt andet
                      for team-nøgler. Indtast event-type ID&apos;et herunder, så ved agenten hvilken kalender den skal
                      booke i.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        id="calcom-event-type"
                        type="text"
                        inputMode="numeric"
                        value={manualEventTypeId}
                        onChange={(e) => setManualEventTypeId(e.target.value)}
                        placeholder={selectedEventTypeId ? String(selectedEventTypeId) : "fx 1234567"}
                        disabled={busy === "eventType"}
                        className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
                      />
                      <button
                        type="button"
                        onClick={() => void handleManualEventTypeSave()}
                        disabled={busy !== null || !manualEventTypeId.trim()}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {busy === "eventType" ? "Gemmer…" : "Gem event-type"}
                      </button>
                    </div>
                  </div>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  Event-typen bestemmer mødets længde, sted og hvilke spørgsmål kunden får stillet — det sættes op på Cal.com.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={busy !== null}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {busy === "test" ? "Tester…" : "Test forbindelse"}
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={busy !== null}
                  className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  {busy === "disconnect" ? "Afbryder…" : "Afbryd"}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <ol className="space-y-2 text-sm text-slate-600">
                <li>
                  <span className="font-medium text-slate-700">1. Hent en API-nøgle.</span> Åbn{" "}
                  <a
                    href={CALCOM_API_KEYS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-brand-600 hover:underline"
                  >
                    Cal.com → Settings → Developer → API keys
                  </a>{" "}
                  og tryk <span className="font-medium">Add</span>. Vælg <span className="font-medium">Never expires</span>,
                  så forbindelsen ikke holder op med at virke af sig selv. Kopiér nøglen med det samme — den starter med{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">cal_live_</code> og vises kun én gang.
                </li>
                <li>
                  <span className="font-medium text-slate-700">2. Indsæt nøglen</span> i feltet herunder.
                </li>
                <li>
                  <span className="font-medium text-slate-700">3. Find event-type ID&apos;et.</span> Åbn{" "}
                  <a
                    href={CALCOM_EVENT_TYPES_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-brand-600 hover:underline"
                  >
                    Cal.com → Event Types
                  </a>{" "}
                  og klik på den ydelse agenten skal booke. ID&apos;et er tallet sidst i adressen —{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">app.cal.com/event-types/1234567</code>{" "}
                  betyder <span className="font-medium">1234567</span>. Lader I feltet stå tomt, vælges jeres første
                  event-type, og I kan skifte bagefter.
                </li>
                <li>
                  <span className="font-medium text-slate-700">4. Tjek event-typens Placering.</span> Under{" "}
                  <span className="font-medium">Event Setup → Placering</span> skal der stå noget agenten selv kan
                  udfylde: <span className="font-medium">In Person (Organizer Address)</span> med jeres egen adresse,{" "}
                  <span className="font-medium">Cal Video</span> eller et telefonnummer. Vælger I{" "}
                  <span className="font-medium">Attendee Address</span> eller{" "}
                  <span className="font-medium">Attendee Phone Number</span>, kræver Cal.com at kunden selv oplyser
                  adressen, og så afviser den hver eneste booking agenten prøver at lave.
                </li>
              </ol>

              <div>
                <label htmlFor="calcom-api-key" className="mb-1 block text-sm font-medium text-slate-700">
                  Cal.com API-nøgle
                </label>
                <input
                  id="calcom-api-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="cal_live_…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Nøglen gemmes krypteret og vises aldrig igen — hverken her eller andre steder i dashboardet.
                </p>
              </div>

              <div>
                <label htmlFor="calcom-event-type-id" className="mb-1 block text-sm font-medium text-slate-700">
                  Cal.com event-type ID <span className="font-normal text-slate-500">(valgfrit)</span>
                </label>
                <input
                  id="calcom-event-type-id"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={eventTypeIdInput}
                  onChange={(e) => setEventTypeIdInput(e.target.value)}
                  placeholder="fx 1234567"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Bestemmer hvilken kalender og ydelse agenten booker i. Findes i Cal.com under Event Types — ID&apos;et
                  står sidst i adressen, fx …/event-types/1234567.
                </p>
              </div>

              <button
                type="button"
                onClick={handleConnect}
                disabled={connecting}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {connecting ? "Forbinder…" : "Forbind kalender"}
              </button>
            </div>
          )}

          {calendarError ? <p className="text-sm text-red-600">{calendarError}</p> : null}
          {calendarNotice ? <p className="text-sm text-emerald-600">{calendarNotice}</p> : null}
        </div>

        {/* -------------------------------------------------------------
            The concierge path we already offered. Still here — some
            customers would rather we did the whole setup — but secondary
            now that connecting a calendar takes one pasted key.
        ------------------------------------------------------------- */}
        {conciergeInProgress ? (
          <div className="space-y-3 rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-900">Vi sætter det op for jer</h3>
            <ol className="space-y-2">
              {SETUP_STEPS.map((step, i) => {
                const done = i < stepsDone;
                return (
                  <li key={step} className="flex items-center gap-3 text-sm">
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                        done ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      {done ? "✓" : i + 1}
                    </span>
                    <span className={done ? "text-slate-800" : "text-slate-400"}>{step}</span>
                  </li>
                );
              })}
            </ol>
            {request?.notes ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">{request.notes}</p>
            ) : null}
          </div>
        ) : null}

        {!live && !conciergeInProgress ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
            {showConcierge ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  Vi sætter det hele op for jer — kalender, jeres ydelser, åbningstider og test.
                </p>
                <div>
                  <label htmlFor="booking-notes" className="mb-1 block text-sm font-medium text-slate-700">
                    Noget vi skal vide? (valgfrit)
                  </label>
                  <textarea
                    id="booking-notes"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Fx hvilke ydelser I tilbyder, hvor lang tid de tager, og jeres åbningstider."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                {error ? <p className="text-sm text-red-600">{error}</p> : null}
                <button
                  type="button"
                  onClick={handleOrder}
                  disabled={ordering}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {ordering ? "Sender…" : "Bestil opsætning"}
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                Har I ikke en Cal.com-konto, eller vil I hellere have os til det?{" "}
                <button
                  type="button"
                  onClick={() => setShowConcierge(true)}
                  className="font-medium text-brand-600 hover:underline"
                >
                  Bed os om at sætte booking op
                </button>
                .
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
