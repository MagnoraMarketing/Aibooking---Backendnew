"use client";

import { useMemo, useState } from "react";
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
interface InboundManagerProps {
  widgets: Widget[];
  initialPhoneNumbers: PhoneNumberRow[];
  // Whether this customer can still start the "/dashboard/inbound/free-trial"
  // paid intro offer (499 kr for 30 days) — false once they've redeemed it
  // or already have a subscription (see app/dashboard/inbound/page.tsx).
  introOfferAvailable: boolean;
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
  const [widgetId, setWidgetId] = useState(widgets[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [areaCode, setAreaCode] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
        ...(areaCode.trim() ? { areaCode: areaCode.trim() } : {}),
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
    setAreaCode("");
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
        {!showForm ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {t("dashboardPages.inbound.newNumber")}
          </button>
        ) : null}
      </div>

      {widgets.length > 0 && introOfferAvailable ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-brand-200 bg-brand-50 p-5">
          <div>
            <span className="inline-block rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-600">
              {t("dashboardPages.shared.introOfferBadge")}
            </span>
            <h2 className="mt-1.5 text-base font-semibold text-slate-900">
              {t("dashboardPages.inbound.introBannerTitle")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{t("dashboardPages.inbound.introBannerSubtitle")}</p>
          </div>
          <Link
            href="/dashboard/inbound/free-trial"
            className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {t("dashboardPages.inbound.introBannerCta")}
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="phone-label" className="mb-1 block text-sm font-medium text-slate-700">
                {t("dashboardPages.inbound.labelOptional")}
              </label>
              <input
                id="phone-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t("dashboardPages.inbound.labelPlaceholder")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label htmlFor="area-code" className="mb-1 block text-sm font-medium text-slate-700">
                {t("dashboardPages.inbound.areaCodeLabel")}
              </label>
              <input
                id="area-code"
                value={areaCode}
                onChange={(e) => setAreaCode(e.target.value)}
                inputMode="numeric"
                placeholder="415"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
              <p className="mt-1 text-xs text-slate-500">{t("dashboardPages.inbound.areaCodeHelp")}</p>
            </div>
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleGetNumber}
              disabled={requesting || !widgetId}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {requesting ? t("dashboardPages.inbound.gettingNumber") : t("dashboardPages.inbound.getNumber")}
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
