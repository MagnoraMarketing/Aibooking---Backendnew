"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Widget, PhoneNumberDirection } from "@/types/database";
import type { PhoneNumberRow } from "@/app/dashboard/inbound/page";
import { CallForwardingInstructions } from "./call-forwarding-instructions";
import { useTranslation } from "@/components/i18n/language-provider";
import { TwilioBalanceCard } from "./twilio-balance-card";

// Inbound is Vapi and nothing else: the agent is handed a number from Vapi,
// wired to its assistant, and the customer forwards the line their customers
// already call to it. Nobody has to own a Twilio account, paste credentials,
// or move an existing number — which is what the two tabs here used to ask
// for.
//
// Numbers attached the old way still appear in the list below and still work;
// outbound campaigns and the dialer are untouched and still use Twilio.
interface SpareNumber {
  id: string;
  number: string;
  name: string | null;
}

interface InboundManagerProps {
  widgets: Widget[];
  initialPhoneNumbers: PhoneNumberRow[];
  // Whether this customer can still start the "/dashboard/inbound/free-trial"
  // paid intro offer (499 kr for 30 days) — false once they've redeemed it
  // or already have a subscription (see app/dashboard/inbound/page.tsx).
  introOfferAvailable: boolean;
  // Whether this customer has an active package — a real inbound number
  // (bought, or handed out free by Vapi) is a paid-plan feature, enforced
  // server-side by requireActivePhoneNumberSubscription
  // (lib/phone-numbers/service.ts). Building and testing an agent stays
  // free regardless — the browser-based Test Call tab needs no number.
  canGetNumber: boolean;
}

export function InboundManager({ widgets, initialPhoneNumbers, introOfferAvailable, canGetNumber }: InboundManagerProps) {
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
  const [showForm, setShowForm] = useState(initialPhoneNumbers.length === 0 && canGetNumber);
  const [widgetId, setWidgetId] = useState(widgets[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Numbers already in the platform's Vapi account that nobody has claimed.
  // Vapi gives one away and charges for the rest, so an idle number that is
  // already paid for is offered before a new one is asked for.
  const [spareNumbers, setSpareNumbers] = useState<SpareNumber[] | null>(null);
  const [chosenSpare, setChosenSpare] = useState<string | null>(null);

  useEffect(() => {
    if (!showForm) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/customer/phone-numbers/vapi/available");
      if (!res.ok || cancelled) return;
      const data = await res.json().catch(() => null);
      if (!cancelled) setSpareNumbers((data?.numbers as SpareNumber[] | undefined) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [showForm]);

  function widgetName(id: string): string {
    return widgets.find((widget) => widget.id === id)?.name ?? "—";
  }

  async function handleGetNumber() {
    if (!widgetId) return;
    setRequesting(true);
    setError(null);

    const res = await fetch("/api/customer/phone-numbers/vapi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        widgetId,
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(chosenSpare ? { vapiPhoneNumberId: chosenSpare } : {}),
      }),
    });
    setRequesting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("dashboardPages.inbound.errorGetNumber"));
      return;
    }

    const { phoneNumber } = await res.json();
    setPhoneNumbers((prev) => [phoneNumber, ...prev]);
    setLabel("");
    setChosenSpare(null);
    setSpareNumbers(null);
    setShowForm(false);
  }

  // Only ever reaches a row left behind by the old Twilio purchase flow — a
  // Vapi number is active the moment it exists or not at all.
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
          <h1 className="text-2xl font-semibold text-slate-900">{t("dashboardPages.inbound.title")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("dashboardPages.inbound.subtitle")}</p>
        </div>
        {!showForm && canGetNumber ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {t("dashboardPages.inbound.newNumber")}
          </button>
        ) : null}
      </div>

      {widgets.length > 0 && !canGetNumber ? (
        <div
          className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5 ${
            introOfferAvailable ? "border-brand-200 bg-brand-50" : "border-slate-200 bg-white"
          }`}
        >
          <div>
            {introOfferAvailable ? (
              <span className="inline-block rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-600">
                {t("dashboardPages.shared.introOfferBadge")}
              </span>
            ) : null}
            <h2 className="mt-1.5 text-base font-semibold text-slate-900">
              {introOfferAvailable ? t("dashboardPages.inbound.introBannerTitle") : t("dashboardPages.inbound.paywallTitle")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {introOfferAvailable
                ? t("dashboardPages.inbound.introBannerSubtitle")
                : t("dashboardPages.inbound.paywallSubtitle")}
            </p>
          </div>
          <Link
            href={introOfferAvailable ? "/dashboard/inbound/free-trial" : "/dashboard/billing"}
            className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {introOfferAvailable ? t("dashboardPages.inbound.introBannerCta") : t("dashboardPages.inbound.paywallCta")}
          </Link>
        </div>
      ) : null}

      {widgets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          {t("dashboardPages.inbound.noAgentsYet")}
        </div>
      ) : showForm ? (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">{t("dashboardPages.inbound.vapiIntro")}</p>

          <div>
            <label htmlFor="inbound-widget" className="mb-1 block text-sm font-medium text-slate-700">
              {t("dashboardPages.shared.agentLabel")}
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

          {/* No area code field: the numbers happen to be American, but which
              US area code a Danish salon's forwarding target sits in is not a
              decision anyone here can make an informed choice about. The
              server picks one (see lib/vapi/phone-numbers.ts). */}
          <div>
            <label htmlFor="phone-label" className="mb-1 block text-sm font-medium text-slate-700">
              {t("dashboardPages.inbound.labelOptional")}
            </label>
            <input
              id="phone-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("dashboardPages.inbound.labelPlaceholder")}
              className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {spareNumbers && spareNumbers.length > 0 ? (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-700">{t("dashboardPages.inbound.spareNumbersTitle")}</p>
              <ul className="space-y-2">
                {spareNumbers.map((spare) => (
                  <li key={spare.id}>
                    <label
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border bg-white p-3 text-sm transition ${
                        chosenSpare === spare.id
                          ? "border-brand-500 ring-1 ring-brand-500"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="spare-number"
                        checked={chosenSpare === spare.id}
                        onChange={() => setChosenSpare(spare.id)}
                      />
                      <span className="font-medium text-slate-800">{spare.number || spare.id}</span>
                      {spare.name ? <span className="text-xs text-slate-500">{spare.name}</span> : null}
                    </label>
                  </li>
                ))}
              </ul>
              {chosenSpare ? (
                <button
                  type="button"
                  onClick={() => setChosenSpare(null)}
                  className="text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  {t("dashboardPages.inbound.spareNumbersClear")}
                </button>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleGetNumber}
              disabled={requesting || !widgetId}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {requesting
                ? t("dashboardPages.inbound.gettingNumber")
                : chosenSpare
                  ? t("dashboardPages.inbound.useNumber")
                  : t("dashboardPages.inbound.getNumber")}
            </button>
            {phoneNumbers.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setError(null);
                }}
                className="text-sm font-medium text-slate-500 hover:text-slate-700"
              >
                {t("common.cancel")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">{t("dashboardPages.inbound.numbersHeading")}</h2>
        {phoneNumbers.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            {t("dashboardPages.inbound.noNumbersYet")}
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
                      {phoneNumber.source === "platform_twilio"
                        ? ` · ${t("dashboardPages.shared.includedInPackage")}`
                        : null}
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
                        {t("dashboardPages.inbound.retry")}
                      </button>
                    ) : null}
                    {phoneNumber.purchase_status !== "released" ? (
                      <button
                        type="button"
                        onClick={() => handleRelease(phoneNumber.id)}
                        disabled={busyId === phoneNumber.id}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                      >
                        {t("dashboardPages.inbound.release")}
                      </button>
                    ) : null}
                  </div>
                </div>
                {phoneNumber.purchase_status === "active" ? (
                  <CallForwardingInstructions phoneNumber={phoneNumber.phone_number} />
                ) : null}
                {phoneNumber.purchase_status === "active" && phoneNumber.source === "byo_twilio" ? (
                  <TwilioBalanceCard phoneNumberId={phoneNumber.id} />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
