"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Widget, PhoneNumberDirection } from "@/types/database";
import type { PhoneNumberRow } from "@/app/dashboard/inbound/page";
import { CallForwardingInstructions } from "./call-forwarding-instructions";
import { useTranslation } from "@/components/i18n/language-provider";

interface InboundManagerProps {
  widgets: Widget[];
  initialPhoneNumbers: PhoneNumberRow[];
  // Whether this customer can still start the "/dashboard/inbound/free-trial"
  // paid intro offer (499 kr for 30 days) — false once they've redeemed it
  // or already have a subscription (see app/dashboard/inbound/page.tsx).
  introOfferAvailable: boolean;
}

interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string | null;
  region: string | null;
  monthlyPriceDkk: number;
}

interface OwnedNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
}

type Mode = "buy" | "byo";

function DirectionPicker({
  value,
  onChange,
  t,
}: {
  value: PhoneNumberDirection;
  onChange: (v: PhoneNumberDirection) => void;
  t: (key: string) => string;
}) {
  const options: { value: PhoneNumberDirection; label: string }[] = [
    { value: "inbound", label: t("dashboardPages.inbound.directionInbound") },
    { value: "outbound", label: t("dashboardPages.inbound.directionOutbound") },
    { value: "both", label: t("dashboardPages.inbound.directionBoth") },
  ];
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-700">{t("dashboardPages.inbound.directionRoleLabel")}</p>
      <div className="flex gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              value === option.value
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function InboundManager({ widgets, initialPhoneNumbers, introOfferAvailable }: InboundManagerProps) {
  const { t } = useTranslation();

  const STATUS_LABELS: Record<PhoneNumberRow["purchase_status"], string> = useMemo(
    () => ({
      pending_payment: t("dashboardPages.inbound.statusPendingPayment"),
      payment_confirmed: t("dashboardPages.inbound.statusPaymentConfirmed"),
      provisioning: t("dashboardPages.inbound.statusProvisioning"),
      active: t("dashboardPages.shared.statusActive"),
      failed: t("dashboardPages.inbound.statusFailed"),
      released: t("dashboardPages.inbound.statusReleased"),
    }),
    [t]
  );

  const DIRECTION_LABELS: Record<PhoneNumberDirection, string> = useMemo(
    () => ({
      inbound: t("dashboardPages.inbound.directionInbound"),
      outbound: t("dashboardPages.inbound.directionOutbound"),
      both: t("dashboardPages.inbound.directionBoth"),
    }),
    [t]
  );

  const [phoneNumbers, setPhoneNumbers] = useState(initialPhoneNumbers);
  const [showForm, setShowForm] = useState(initialPhoneNumbers.length === 0);
  const [mode, setMode] = useState<Mode>("buy");
  const [showTrialModal, setShowTrialModal] = useState(false);
  const [widgetId, setWidgetId] = useState(widgets[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [direction, setDirection] = useState<PhoneNumberDirection>("both");

  // Buy-a-number state
  const [searching, setSearching] = useState(false);
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[] | null>(null);
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);

  // BYO-Twilio state
  const [twilioAccountSid, setTwilioAccountSid] = useState("");
  const [twilioAuthToken, setTwilioAuthToken] = useState("");
  const [twilioPhoneNumber, setTwilioPhoneNumber] = useState("");
  const [importing, setImporting] = useState(false);
  const [fetchingByoNumbers, setFetchingByoNumbers] = useState(false);
  const [byoNumbers, setByoNumbers] = useState<OwnedNumber[] | null>(null);
  const [byoManualEntry, setByoManualEntry] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function widgetName(id: string): string {
    return widgets.find((w) => w.id === id)?.name ?? t("dashboardPages.shared.unknownAgent");
  }

  function handleOpenTrialModal() {
    setMode("byo");
    setShowForm(true);
    setShowTrialModal(true);
    setError(null);
  }

  // Lets the descriptive "/dashboard/inbound/free-trial" landing page deep-link
  // straight into the popup (?openTrial=1) instead of duplicating the
  // SID/Token + number-fetch/import flow on a second page.
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("openTrial") === "1" && widgets.length > 0) {
      handleOpenTrialModal();
      window.history.replaceState(null, "", "/dashboard/inbound");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetBuyState() {
    setAvailableNumbers(null);
    setSelectedNumber(null);
  }

  async function handleSearch() {
    setSearching(true);
    setError(null);
    resetBuyState();

    const res = await fetch("/api/customer/phone-numbers/search");
    setSearching(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("dashboardPages.inbound.errorSearchNumbers"));
      return;
    }

    const { numbers } = await res.json();
    setAvailableNumbers(numbers);
  }

  async function handlePurchase() {
    if (!widgetId || !selectedNumber) {
      setError(t("dashboardPages.inbound.errorSelectAgentAndNumber"));
      return;
    }
    setPurchasing(true);
    setError(null);

    const res = await fetch("/api/customer/phone-numbers/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgetId, phoneNumber: selectedNumber, label: label.trim() || undefined, direction }),
    });

    setPurchasing(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("dashboardPages.inbound.errorPurchase"));
      return;
    }

    const { phoneNumber } = await res.json();
    setPhoneNumbers((prev) => [phoneNumber, ...prev]);
    resetBuyState();
    setLabel("");
    setShowForm(false);
  }

  async function handleFetchByoNumbers() {
    if (!twilioAccountSid.trim() || !twilioAuthToken.trim()) {
      setError(t("dashboardPages.inbound.errorFillTwilioCredentials"));
      return;
    }
    setFetchingByoNumbers(true);
    setError(null);
    setByoNumbers(null);

    const res = await fetch("/api/customer/phone-numbers/byo/numbers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        twilioAccountSid: twilioAccountSid.trim(),
        twilioAuthToken: twilioAuthToken.trim(),
      }),
    });

    setFetchingByoNumbers(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("dashboardPages.inbound.errorFetchTwilioNumbers"));
      return;
    }

    const { numbers } = await res.json();
    setByoNumbers(numbers);
    if (numbers.length > 0) setTwilioPhoneNumber(numbers[0].phoneNumber);
  }

  async function handleImport() {
    if (!widgetId || !twilioAccountSid.trim() || !twilioAuthToken.trim() || !twilioPhoneNumber.trim()) {
      setError(t("dashboardPages.inbound.errorFillAllTwilioFields"));
      return;
    }
    setImporting(true);
    setError(null);

    const res = await fetch("/api/customer/phone-numbers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        widgetId,
        twilioAccountSid: twilioAccountSid.trim(),
        twilioAuthToken: twilioAuthToken.trim(),
        twilioPhoneNumber: twilioPhoneNumber.trim(),
        label: label.trim() || undefined,
        direction,
      }),
    });

    setImporting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("dashboardPages.inbound.errorImport"));
      return;
    }

    const { phoneNumber } = await res.json();
    setPhoneNumbers((prev) => [phoneNumber, ...prev]);
    setTwilioAccountSid("");
    setTwilioAuthToken("");
    setTwilioPhoneNumber("");
    setByoNumbers(null);
    setByoManualEntry(false);
    setLabel("");
    setShowForm(false);
    setShowTrialModal(false);
  }

  async function handleRetry(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/customer/phone-numbers/${id}/retry`, { method: "POST" });
    setBusyId(null);
    if (res.ok) {
      const { phoneNumber } = await res.json();
      setPhoneNumbers((prev) => prev.map((p) => (p.id === id ? phoneNumber : p)));
    }
  }

  async function handleRelease(id: string) {
    if (!confirm(t("dashboardPages.inbound.confirmRelease"))) return;
    setBusyId(id);
    const res = await fetch(`/api/customer/phone-numbers/${id}`, { method: "DELETE" });
    setBusyId(null);
    if (res.ok) {
      setPhoneNumbers((prev) => prev.map((p) => (p.id === id ? { ...p, purchase_status: "released" } : p)));
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Inbound</h1>
          <p className="mt-1 text-sm text-slate-500">
            Få et telefonnummer, og viderestil jeres eksisterende nummer til det, så AI-agenten svarer kunderne.
          </p>
        </div>
        {!showForm ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + Nyt nummer
          </button>
        ) : null}
      </div>

      {widgets.length > 0 && introOfferAvailable ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-brand-200 bg-brand-50 p-5">
          <div>
            <span className="inline-block rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-600">
              Introtilbud
            </span>
            <h2 className="mt-1.5 text-base font-semibold text-slate-900">
              Prøv AIbooking.dk Reception i 30 dage for 499 kr
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Testnummer, ~75 min taletid og fuld PRO-adgang — derefter 999 kr/md.
            </p>
          </div>
          <Link
            href="/dashboard/inbound/free-trial"
            className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Se tilbuddet →
          </Link>
        </div>
      ) : null}

      {widgets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Opret en agent under &quot;Agent&quot; f&oslash;rst &mdash; et telefonnummer skal knyttes til en agent.
        </div>
      ) : showForm && !showTrialModal ? (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm">
            <button
              type="button"
              onClick={() => {
                setMode("buy");
                setError(null);
              }}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
                mode === "buy" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Køb nummer gennem os
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("byo");
                setError(null);
              }}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
                mode === "byo" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Brug eget Twilio-nummer
            </button>
          </div>

          <div>
            <label htmlFor="inbound-widget" className="mb-1 block text-sm font-medium text-slate-700">
              Agent
            </label>
            <select
              id="inbound-widget"
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

          <DirectionPicker value={direction} onChange={setDirection} t={t} />

          <div>
            <label htmlFor="phone-label" className="mb-1 block text-sm font-medium text-slate-700">
              Label (valgfrit)
            </label>
            <input
              id="phone-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Fx Hovednummer"
              className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {mode === "buy" ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">
                Vi køber et dansk nummer til jer og forbinder det med agenten med det samme. Nummeret er inkluderet i
                jeres pakke — ingen ekstra betaling.
              </p>

              {availableNumbers === null ? (
                <button
                  type="button"
                  onClick={handleSearch}
                  disabled={searching}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {searching ? "Søger…" : "Søg ledige numre →"}
                </button>
              ) : availableNumbers.length === 0 ? (
                <p className="text-sm text-slate-500">Ingen ledige numre lige nu. Prøv igen om lidt.</p>
              ) : (
                <ul className="space-y-2">
                  {availableNumbers.map((n) => (
                    <li key={n.phoneNumber}>
                      <label
                        className={`flex cursor-pointer items-center justify-between gap-4 rounded-lg border p-3 text-sm transition ${
                          selectedNumber === n.phoneNumber
                            ? "border-brand-500 ring-1 ring-brand-500"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <span className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="available-number"
                            checked={selectedNumber === n.phoneNumber}
                            onChange={() => setSelectedNumber(n.phoneNumber)}
                          />
                          <span>
                            <span className="font-medium text-slate-800">{n.phoneNumber}</span>
                            {n.locality ? <span className="ml-2 text-xs text-slate-500">{n.locality}</span> : null}
                          </span>
                        </span>
                        <span className="text-xs font-medium text-emerald-600">Inkluderet i pakke</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                I bringer jeres eget Twilio-nummer med. Find Account SID og Auth Token i jeres Twilio-konsol.
              </p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="twilio-sid" className="mb-1 block text-sm font-medium text-slate-700">
                    Twilio Account SID
                  </label>
                  <input
                    id="twilio-sid"
                    value={twilioAccountSid}
                    onChange={(e) => {
                      setTwilioAccountSid(e.target.value);
                      setByoNumbers(null);
                    }}
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label htmlFor="twilio-token" className="mb-1 block text-sm font-medium text-slate-700">
                    Twilio Auth Token
                  </label>
                  <input
                    id="twilio-token"
                    type="password"
                    value={twilioAuthToken}
                    onChange={(e) => {
                      setTwilioAuthToken(e.target.value);
                      setByoNumbers(null);
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleFetchByoNumbers}
                disabled={fetchingByoNumbers || !twilioAccountSid.trim() || !twilioAuthToken.trim()}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {fetchingByoNumbers ? "Henter…" : "Hent numre fra Twilio →"}
              </button>

              {byoNumbers && byoNumbers.length === 0 ? (
                <p className="text-sm text-amber-600">
                  Ingen numre fundet på denne Twilio-konto. Indtast nummeret manuelt herunder.
                </p>
              ) : null}

              {byoNumbers && byoNumbers.length > 0 && !byoManualEntry ? (
                <div>
                  <label htmlFor="twilio-number-select" className="mb-1 block text-sm font-medium text-slate-700">
                    Telefonnummer
                  </label>
                  <select
                    id="twilio-number-select"
                    value={twilioPhoneNumber}
                    onChange={(e) => setTwilioPhoneNumber(e.target.value)}
                    className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  >
                    {byoNumbers.map((n) => (
                      <option key={n.sid} value={n.phoneNumber}>
                        {n.friendlyName ? `${n.friendlyName} (${n.phoneNumber})` : n.phoneNumber}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setByoManualEntry(true)}
                    className="mt-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                  >
                    Indtast nummer manuelt i stedet
                  </button>
                </div>
              ) : (
                <div>
                  <label htmlFor="twilio-number" className="mb-1 block text-sm font-medium text-slate-700">
                    Telefonnummer
                  </label>
                  <input
                    id="twilio-number"
                    value={twilioPhoneNumber}
                    onChange={(e) => setTwilioPhoneNumber(e.target.value)}
                    placeholder="+4512345678"
                    className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                  {byoNumbers && byoNumbers.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setByoManualEntry(false)}
                      className="mt-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                    >
                      Vælg fra listen i stedet
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          )}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex gap-3">
            {phoneNumbers.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Annuller
              </button>
            ) : null}
            {mode === "buy" ? (
              <button
                type="button"
                onClick={handlePurchase}
                disabled={purchasing || !selectedNumber}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {purchasing ? "Køber…" : "Køb nummer →"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleImport}
                disabled={importing}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {importing ? "Importerer…" : "Importér nummer →"}
              </button>
            )}
          </div>
        </div>
      ) : null}

      {showTrialModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Sidste trin — forbind jeres Twilio-nummer</h2>
                <p className="mt-1 text-sm text-slate-500">
                  I viderestiller blot jeres eksisterende firmanummer til testnummeret. Jeres rigtige opsætning
                  rører vi ikke ved, og I kan stille viderestillingen tilbage når som helst.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowTrialModal(false)}
                className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Luk"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 space-y-5">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-800">Trin 1 — Har I ikke allerede en Twilio-konto?</p>
                <p className="mt-1 text-sm text-slate-600">
                  Opret en gratis konto hos Twilio (ingen betalingskort krævet for et testnummer), og find jeres
                  Account SID og Auth Token under &quot;Account Info&quot; på deres dashboard.
                </p>
                <a
                  href="https://www.twilio.com/try-twilio"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-2 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  Opret gratis Twilio-konto →
                </a>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-slate-800">Trin 2 — Forbind kontoen</p>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="trial-widget" className="mb-1 block text-sm font-medium text-slate-700">
                      Agent
                    </label>
                    <select
                      id="trial-widget"
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

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="trial-twilio-sid" className="mb-1 block text-sm font-medium text-slate-700">
                        Twilio Account SID
                      </label>
                      <input
                        id="trial-twilio-sid"
                        value={twilioAccountSid}
                        onChange={(e) => {
                          setTwilioAccountSid(e.target.value);
                          setByoNumbers(null);
                        }}
                        placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                    <div>
                      <label htmlFor="trial-twilio-token" className="mb-1 block text-sm font-medium text-slate-700">
                        Twilio Auth Token
                      </label>
                      <input
                        id="trial-twilio-token"
                        type="password"
                        value={twilioAuthToken}
                        onChange={(e) => {
                          setTwilioAuthToken(e.target.value);
                          setByoNumbers(null);
                        }}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleFetchByoNumbers}
                    disabled={fetchingByoNumbers || !twilioAccountSid.trim() || !twilioAuthToken.trim()}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {fetchingByoNumbers ? "Henter…" : "Hent numre fra Twilio →"}
                  </button>

                  {byoNumbers && byoNumbers.length === 0 ? (
                    <p className="text-sm text-amber-600">
                      Ingen numre fundet på denne Twilio-konto. Indtast nummeret manuelt herunder.
                    </p>
                  ) : null}

                  {byoNumbers && byoNumbers.length > 0 && !byoManualEntry ? (
                    <div>
                      <label htmlFor="trial-twilio-number-select" className="mb-1 block text-sm font-medium text-slate-700">
                        Telefonnummer
                      </label>
                      <select
                        id="trial-twilio-number-select"
                        value={twilioPhoneNumber}
                        onChange={(e) => setTwilioPhoneNumber(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                      >
                        {byoNumbers.map((n) => (
                          <option key={n.sid} value={n.phoneNumber}>
                            {n.friendlyName ? `${n.friendlyName} (${n.phoneNumber})` : n.phoneNumber}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setByoManualEntry(true)}
                        className="mt-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        Indtast nummer manuelt i stedet
                      </button>
                    </div>
                  ) : (
                    <div>
                      <label htmlFor="trial-twilio-number" className="mb-1 block text-sm font-medium text-slate-700">
                        Telefonnummer
                      </label>
                      <input
                        id="trial-twilio-number"
                        value={twilioPhoneNumber}
                        onChange={(e) => setTwilioPhoneNumber(e.target.value)}
                        placeholder="+4512345678"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                      />
                      {byoNumbers && byoNumbers.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setByoManualEntry(false)}
                          className="mt-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Vælg fra listen i stedet
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              {error ? <p className="text-sm text-red-600">{error}</p> : null}

              <button
                type="button"
                onClick={handleImport}
                disabled={importing}
                className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {importing ? "Forbinder…" : "Forbind nummer →"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Jeres numre</h2>
        {phoneNumbers.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Ingen telefonnumre endnu.
          </div>
        ) : (
          <div className="space-y-6">
            {phoneNumbers.map((phoneNumber) => (
              <div key={phoneNumber.id} className="space-y-3">
                <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {phoneNumber.label || phoneNumber.phone_number}
                    </p>
                    <p className="text-xs text-slate-500">
                      {phoneNumber.phone_number} · {widgetName(phoneNumber.widget_id)} ·{" "}
                      {DIRECTION_LABELS[phoneNumber.direction]}
                      {phoneNumber.source === "platform_twilio" ? " · Inkluderet i pakke" : null}
                    </p>
                    <p className="mt-1 text-xs font-medium text-slate-500">
                      {STATUS_LABELS[phoneNumber.purchase_status]}
                      {phoneNumber.failure_reason ? (
                        <span className="ml-2 text-red-600">{phoneNumber.failure_reason}</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {phoneNumber.purchase_status === "failed" ? (
                      <button
                        type="button"
                        onClick={() => handleRetry(phoneNumber.id)}
                        disabled={busyId === phoneNumber.id}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        Prøv igen
                      </button>
                    ) : null}
                    {phoneNumber.purchase_status !== "released" ? (
                      <button
                        type="button"
                        onClick={() => handleRelease(phoneNumber.id)}
                        disabled={busyId === phoneNumber.id}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                      >
                        Frigiv
                      </button>
                    ) : null}
                  </div>
                </div>
                {phoneNumber.purchase_status === "active" ? (
                  <CallForwardingInstructions phoneNumber={phoneNumber.phone_number} />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
