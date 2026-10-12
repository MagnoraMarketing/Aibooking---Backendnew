"use client";

import { useCallback, useEffect, useState } from "react";
import type { BookingSetupRequestStatus } from "@/types/database";
import type { WidgetWithExtras } from "../agent-configurator";
import { useTranslation } from "@/components/i18n/language-provider";

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
  // Which agent this calendar is attached to — the only way to tell two of
  // the customer's calendars apart when offering to reuse one.
  widget_name: string | null;
  widget_agent_type: string | null;
}

interface CalcomEventType {
  id: number;
  title: string;
}

// The steps our team works through once booking is ordered. Shown to the
// customer as a progress list so "vi er i gang" is something they can see
// rather than something they have to ask about.
const SETUP_STEP_KEYS = [
  "agent.bookingTab.step.received",
  "agent.bookingTab.step.calendarCreated",
  "agent.bookingTab.step.calendarConnected",
  "agent.bookingTab.step.servicesConfigured",
  "agent.bookingTab.step.voiceAgentConnected",
  "agent.bookingTab.step.tested",
] as const;

// How far through SETUP_STEP_KEYS each status is. 'completed' lights all of them.
const STEPS_DONE: Record<BookingSetupRequestStatus, number> = {
  pending: 1,
  in_progress: 3,
  completed: SETUP_STEP_KEYS.length,
  cancelled: 0,
};

const STATUS_LABEL_KEY: Record<BookingSetupRequestStatus, string> = {
  pending: "agent.bookingTab.status.pending",
  in_progress: "agent.bookingTab.status.inProgress",
  completed: "agent.bookingTab.status.completed",
  cancelled: "agent.bookingTab.status.cancelled",
};

const CALCOM_API_KEYS_URL = "https://app.cal.com/settings/developer/api-keys";
const CALCOM_EVENT_TYPES_URL = "https://app.cal.com/event-types";

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return data?.error?.message ?? fallback;
}

export function BookingTab({ widget }: BookingTabProps) {
  const { t } = useTranslation();
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
  // The customer's other agents' Cal.com calendars. Offered before the paste
  // form, because a second agent booking into the same calendar is the
  // common case — and the key that set the first one up is unrecoverable.
  const [reusable, setReusable] = useState<CalendarConnection[]>([]);
  const [reuseId, setReuseId] = useState<string | null>(null);
  const [showNewCalendar, setShowNewCalendar] = useState(false);
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
      const all = (data.connections as CalendarConnection[] | undefined) ?? [];
      const own = all.find((c) => c.widget_id === widget.id && c.provider === "calcom");
      setConnection(own ?? null);

      // A calendar in an error state is not one to spread to a second agent
      // — it would take the failure with it.
      const others = all.filter(
        (c) => c.widget_id !== widget.id && c.provider === "calcom" && c.status === "connected"
      );
      setReusable(others);
      setReuseId((current) => current ?? others[0]?.id ?? null);

      if (own) await loadEventTypes(own.id);
    }

    setLoading(false);
  }, [widget.id, loadEventTypes]);

  useEffect(() => {
    void load();
  }, [load]);

  // Both ways in — a pasted key and a reused calendar — end the same way:
  // the connection is stored on this agent and booking is live for it.
  function applyConnected(data: { connection: CalendarConnection; eventTypes?: CalcomEventType[] }, notice: string) {
    setConnection(data.connection);
    setEventTypes(data.eventTypes ?? []);
    setApiKey("");
    setEventTypeIdInput("");
    setLive(true);
    setCalendarNotice(notice);
  }

  // Puts this agent on a calendar one of the customer's other agents already
  // books into. The key is never handed to the browser — the server copies
  // the stored one — so this works long after Cal.com stopped showing it.
  async function handleReuse() {
    if (!reuseId) return;
    setConnecting(true);
    setCalendarError(null);
    setCalendarNotice(null);

    const res = await fetch("/api/customer/calendar/calcom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgetId: widget.id, fromConnectionId: reuseId }),
    });
    setConnecting(false);

    if (!res.ok) {
      setCalendarError(await errorMessage(res, t("agent.bookingTab.errorReuseFailed")));
      return;
    }

    applyConnected(await res.json(), t("agent.bookingTab.noticeReuseSuccess"));
  }

  async function handleConnect() {
    if (!apiKey.trim()) {
      setCalendarError(t("agent.bookingTab.errorApiKeyRequired"));
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
      setCalendarError(t("agent.bookingTab.errorEventTypeIdInvalid"));
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
      setCalendarError(await errorMessage(res, t("agent.bookingTab.errorConnectFailed")));
      return;
    }

    applyConnected(await res.json(), t("agent.bookingTab.noticeConnectSuccess"));
  }

  async function handleManualEventTypeSave() {
    const parsed = Number(manualEventTypeId.trim());
    if (!Number.isInteger(parsed) || parsed <= 0) {
      setCalendarError(t("agent.bookingTab.errorManualEventTypeInvalid"));
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
      setCalendarError(await errorMessage(res, t("agent.bookingTab.errorEventTypeChangeFailed")));
      return;
    }
    const data = await res.json();
    setConnection(data.connection);
    setCalendarNotice(t("agent.bookingTab.noticeEventTypeChanged"));
  }

  async function handleTest() {
    if (!connection) return;
    setBusy("test");
    setCalendarError(null);
    setCalendarNotice(null);

    const res = await fetch(`/api/customer/calendar/${connection.id}/test`, { method: "POST" });
    setBusy(null);

    if (!res.ok) {
      setCalendarError(await errorMessage(res, t("agent.bookingTab.errorTestFailed")));
      return;
    }
    const data = await res.json();
    setConnection(data.connection);
    setCalendarNotice(t("agent.bookingTab.noticeTestSuccess"));
  }

  async function handleDisconnect() {
    if (!connection) return;
    setBusy("disconnect");
    setCalendarError(null);
    setCalendarNotice(null);

    const res = await fetch(`/api/customer/calendar/${connection.id}`, { method: "DELETE" });
    setBusy(null);

    if (!res.ok) {
      setCalendarError(await errorMessage(res, t("agent.bookingTab.errorDisconnectFailed")));
      return;
    }
    setConnection(null);
    setEventTypes([]);
    setLive(false);
    setCalendarNotice(t("agent.bookingTab.noticeDisconnectSuccess"));
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
      setError(await errorMessage(res, t("agent.bookingTab.errorOrderFailed")));
      return;
    }
    const data = await res.json();
    setRequest(data.request ?? null);
  }

  if (loading) {
    return <p className="text-sm text-slate-500">{t("common.loading")}</p>;
  }

  // A phone agent's callers never see a website, so the copy that told them
  // bookings happen "fra hjemmesiden" described the wrong product.
  const isPhone = widget.agent_type === "phone";
  const stepsDone = live ? SETUP_STEP_KEYS.length : request ? STEPS_DONE[request.status] : 0;
  const selectedEventTypeId = connection?.calcom_event_type_id ? Number(connection.calcom_event_type_id) : null;
  const conciergeInProgress = !!request && request.status !== "cancelled" && !live;

  return (
    <div className="space-y-6">
      <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t("agent.bookingTab.heading")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{t("agent.bookingTab.description")}</p>
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
            {live ? t("agent.bookingTab.status.completed") : request ? t(STATUS_LABEL_KEY[request.status]) : t("agent.bookingTab.notOptedIn")}
          </span>
        </div>

        {live && connection ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            {t("agent.bookingTab.canBookIntroBefore")} <strong>{t("agent.configurator.tab.testAgent")}</strong>{" "}
            {t("agent.bookingTab.canBookIntroAfter")}
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
              <h3 className="text-sm font-semibold text-slate-900">{t("agent.bookingTab.calcomHeading")}</h3>
              <p className="mt-1 text-sm text-slate-500">
                {connection
                  ? t("agent.bookingTab.calcomDescConnected")
                  : isPhone
                    ? t("agent.bookingTab.calcomDescPhone")
                    : t("agent.bookingTab.calcomDescWidget")}
              </p>
            </div>
            {connection ? (
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                  connection.status === "connected" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                }`}
              >
                {connection.status === "connected"
                  ? t("agent.bookingTab.connectionOk")
                  : t("agent.bookingTab.connectionError")}
              </span>
            ) : null}
          </div>

          {connection ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500">{t("agent.bookingTab.accountLabel")}</dt>
                  <dd className="font-medium text-slate-800">{connection.external_account_email ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t("agent.bookingTab.connectedSinceLabel")}</dt>
                  <dd className="font-medium text-slate-800">
                    {new Date(connection.created_at).toLocaleDateString("da-DK")}
                  </dd>
                </div>
              </dl>

              <div>
                <label htmlFor="calcom-event-type" className="mb-1 block text-sm font-medium text-slate-700">
                  {t("agent.bookingTab.eventTypeLabel")}
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
                      {t("agent.bookingTab.noEventTypes", {
                        idSuffix: selectedEventTypeId
                          ? t("agent.bookingTab.noEventTypesIdSuffix", { id: selectedEventTypeId })
                          : "",
                      })}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        id="calcom-event-type"
                        type="text"
                        inputMode="numeric"
                        value={manualEventTypeId}
                        onChange={(e) => setManualEventTypeId(e.target.value)}
                        placeholder={
                          selectedEventTypeId ? String(selectedEventTypeId) : t("agent.bookingTab.eventTypeIdPlaceholder")
                        }
                        disabled={busy === "eventType"}
                        className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
                      />
                      <button
                        type="button"
                        onClick={() => void handleManualEventTypeSave()}
                        disabled={busy !== null || !manualEventTypeId.trim()}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {busy === "eventType" ? t("common.saving") : t("agent.bookingTab.saveEventType")}
                      </button>
                    </div>
                  </div>
                )}
                <p className="mt-1 text-xs text-slate-500">{t("agent.bookingTab.eventTypeHint")}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={busy !== null}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {busy === "test" ? t("agent.bookingTab.testing") : t("agent.bookingTab.testConnection")}
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={busy !== null}
                  className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  {busy === "disconnect" ? t("agent.bookingTab.disconnecting") : t("agent.bookingTab.disconnect")}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Reuse before paste: a customer adding a phone agent to a
                  business whose widget already books has one calendar, not
                  two, and the key that connected it is not retrievable. */}
              {reusable.length > 0 ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-slate-700">{t("agent.bookingTab.reuseHeading")}</p>
                    <p className="mt-1 text-xs text-slate-500">{t("agent.bookingTab.reuseDescription")}</p>
                  </div>

                  <div className="space-y-2">
                    {reusable.map((other) => (
                      <label
                        key={other.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                          reuseId === other.id ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="radio"
                          name="reuse-calendar"
                          value={other.id}
                          checked={reuseId === other.id}
                          onChange={() => setReuseId(other.id)}
                          className="mt-1"
                        />
                        <span>
                          <span className="font-medium text-slate-800">{other.widget_name ?? t("agent.bookingTab.widgetAgentLabel")}</span>
                          <span className="text-slate-500">
                            {" · "}
                            {other.widget_agent_type === "phone"
                              ? t("agent.bookingTab.phoneAgentLabel")
                              : t("agent.bookingTab.widgetAgentLabel")}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {other.external_account_email ?? "Cal.com"}
                            {other.calcom_event_type_id
                              ? t("agent.bookingTab.reuseEventTypeSuffix", { id: other.calcom_event_type_id })
                              : ""}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleReuse()}
                    disabled={connecting || !reuseId}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    {connecting ? t("agent.bookingTab.connecting") : t("agent.bookingTab.useThisCalendar")}
                  </button>

                  {!showNewCalendar ? (
                    <p className="text-sm text-slate-600">
                      {t("agent.bookingTab.bookElsewherePrompt")}{" "}
                      <button
                        type="button"
                        onClick={() => setShowNewCalendar(true)}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {t("agent.bookingTab.connectNewCalendarLink")}
                      </button>
                      .
                    </p>
                  ) : null}
                </div>
              ) : null}

              {reusable.length === 0 || showNewCalendar ? (
                <div className="space-y-3">
                  {reusable.length > 0 ? (
                    <p className="border-t border-slate-200 pt-4 text-sm font-medium text-slate-700">
                      {t("agent.bookingTab.connectNewCalendarLink")}
                    </p>
                  ) : null}
              <ol className="space-y-2 text-sm text-slate-600">
                <li>
                  <span className="font-medium text-slate-700">{t("agent.bookingTab.step1Title")}</span>{" "}
                  {t("agent.bookingTab.step1BeforeLink")}{" "}
                  <a
                    href={CALCOM_API_KEYS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-brand-600 hover:underline"
                  >
                    Cal.com → Settings → Developer → API keys
                  </a>{" "}
                  {t("agent.bookingTab.step1AfterLink")}{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">cal_live_</code>{" "}
                  {t("agent.bookingTab.step1AfterCode")}
                </li>
                <li>
                  <span className="font-medium text-slate-700">{t("agent.bookingTab.step2Title")}</span>{" "}
                  {t("agent.bookingTab.step2Text")}
                </li>
                <li>
                  <span className="font-medium text-slate-700">{t("agent.bookingTab.step3Title")}</span>{" "}
                  {t("agent.bookingTab.step3BeforeLink")}{" "}
                  <a
                    href={CALCOM_EVENT_TYPES_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-brand-600 hover:underline"
                  >
                    Cal.com → Event Types
                  </a>{" "}
                  {t("agent.bookingTab.step3BetweenLinkAndCode")}{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">app.cal.com/event-types/1234567</code>{" "}
                  {t("agent.bookingTab.step3AfterCode")}
                </li>
                <li>
                  <span className="font-medium text-slate-700">{t("agent.bookingTab.step4Title")}</span>{" "}
                  {t("agent.bookingTab.step4Text")}
                </li>
              </ol>

              <div>
                <label htmlFor="calcom-api-key" className="mb-1 block text-sm font-medium text-slate-700">
                  {t("agent.bookingTab.apiKeyLabel")}
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
                <p className="mt-1 text-xs text-slate-500">{t("agent.bookingTab.apiKeyHint")}</p>
              </div>

              <div>
                <label htmlFor="calcom-event-type-id" className="mb-1 block text-sm font-medium text-slate-700">
                  {t("agent.bookingTab.eventTypeIdLabel")} <span className="font-normal text-slate-500">{t("common.optional")}</span>
                </label>
                <input
                  id="calcom-event-type-id"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={eventTypeIdInput}
                  onChange={(e) => setEventTypeIdInput(e.target.value)}
                  placeholder={t("agent.bookingTab.eventTypeIdPlaceholder")}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
                <p className="mt-1 text-xs text-slate-500">{t("agent.bookingTab.eventTypeIdHint")}</p>
              </div>

              <button
                type="button"
                onClick={handleConnect}
                disabled={connecting}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {connecting ? t("agent.bookingTab.connecting") : t("agent.bookingTab.connectCalendar")}
              </button>
                </div>
              ) : null}
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
            <h3 className="text-sm font-semibold text-slate-900">{t("agent.bookingTab.conciergeHeading")}</h3>
            <ol className="space-y-2">
              {SETUP_STEP_KEYS.map((stepKey, i) => {
                const done = i < stepsDone;
                return (
                  <li key={stepKey} className="flex items-center gap-3 text-sm">
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                        done ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      {done ? "✓" : i + 1}
                    </span>
                    <span className={done ? "text-slate-800" : "text-slate-400"}>{t(stepKey)}</span>
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
                <p className="text-sm text-slate-600">{t("agent.bookingTab.conciergeIntro")}</p>
                <div>
                  <label htmlFor="booking-notes" className="mb-1 block text-sm font-medium text-slate-700">
                    {t("agent.bookingTab.conciergeNotesLabel")} <span className="font-normal text-slate-500">{t("common.optional")}</span>
                  </label>
                  <textarea
                    id="booking-notes"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t("agent.bookingTab.conciergeNotesPlaceholder")}
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
                  {ordering ? t("agent.bookingTab.ordering") : t("agent.bookingTab.orderSetup")}
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                {t("agent.bookingTab.conciergePrompt")}{" "}
                <button
                  type="button"
                  onClick={() => setShowConcierge(true)}
                  className="font-medium text-brand-600 hover:underline"
                >
                  {t("agent.bookingTab.conciergeLinkLabel")}
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
