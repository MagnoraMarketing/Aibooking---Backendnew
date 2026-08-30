"use client";

import { useState } from "react";
import { useTranslation } from "@/components/i18n/language-provider";

export interface AdminPhoneNumberRow {
  id: string;
  phoneNumber: string;
  label: string | null;
  source: "byo_twilio" | "platform_twilio";
  direction: "inbound" | "outbound" | "both";
  purchaseStatus: "pending_payment" | "payment_confirmed" | "provisioning" | "active" | "failed" | "released";
  failureReason: string | null;
  monthlyPriceDkk: number | null;
  customerName: string;
  customerEmail: string;
  widgetName: string;
  createdAt: string;
}

// Maps each status/direction to its translation key suffix — the actual
// label text is looked up via t() inside the component so it reacts to the
// current locale.
const STATUS_LABEL_KEYS: Record<AdminPhoneNumberRow["purchaseStatus"], string> = {
  pending_payment: "adminPages.phoneNumbers.statusPendingPayment",
  payment_confirmed: "adminPages.phoneNumbers.statusPaymentConfirmed",
  provisioning: "adminPages.phoneNumbers.statusProvisioning",
  active: "adminPages.shared.active",
  failed: "adminPages.phoneNumbers.statusFailed",
  released: "adminPages.phoneNumbers.statusReleased",
};

const STATUS_COLORS: Record<AdminPhoneNumberRow["purchaseStatus"], string> = {
  pending_payment: "bg-slate-100 text-slate-600",
  payment_confirmed: "bg-blue-50 text-blue-700",
  provisioning: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
  released: "bg-slate-100 text-slate-500",
};

const DIRECTION_LABEL_KEYS: Record<AdminPhoneNumberRow["direction"], string> = {
  inbound: "adminPages.phoneNumbers.directionInbound",
  outbound: "adminPages.phoneNumbers.directionOutbound",
  both: "adminPages.phoneNumbers.directionBoth",
};

export function AdminPhoneNumbersTable({ initialRows }: { initialRows: AdminPhoneNumberRow[] }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(initialRows);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleRetry(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/admin/phone-numbers/${id}/retry`, { method: "POST" });
    setBusyId(null);
    if (res.ok) {
      const { phoneNumber } = await res.json();
      setRows((prev) =>
        prev.map((row) => (row.id === id ? { ...row, purchaseStatus: phoneNumber.purchase_status, failureReason: phoneNumber.failure_reason } : row))
      );
    }
  }

  async function handleRelease(id: string) {
    if (!confirm(t("adminPages.phoneNumbers.confirmRelease"))) return;
    setBusyId(id);
    const res = await fetch(`/api/admin/phone-numbers/${id}`, { method: "DELETE" });
    setBusyId(null);
    if (res.ok) {
      setRows((prev) => prev.map((row) => (row.id === id ? { ...row, purchaseStatus: "released" } : row)));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t("adminShell.nav.phoneNumbers")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("adminPages.phoneNumbers.subtitle")}</p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">{t("adminPages.phoneNumbers.tableNumber")}</th>
              <th className="px-4 py-3">{t("adminPages.phoneNumbers.tableCustomer")}</th>
              <th className="px-4 py-3">{t("adminPages.phoneNumbers.tableAgent")}</th>
              <th className="px-4 py-3">{t("adminPages.phoneNumbers.tableDirection")}</th>
              <th className="px-4 py-3">{t("adminPages.phoneNumbers.tableSource")}</th>
              <th className="px-4 py-3">{t("adminPages.shared.statusLabel")}</th>
              <th className="px-4 py-3">{t("adminPages.phoneNumbers.tablePrice")}</th>
              <th className="px-4 py-3">{t("adminPages.phoneNumbers.tableActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  {t("adminPages.phoneNumbers.empty")}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {row.phoneNumber}
                    {row.label ? <span className="block text-xs font-normal text-slate-500">{row.label}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.customerName}
                    <span className="block text-xs text-slate-400">{row.customerEmail}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.widgetName}</td>
                  <td className="px-4 py-3 text-slate-600">{t(DIRECTION_LABEL_KEYS[row.direction])}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.source === "platform_twilio"
                      ? t("adminPages.phoneNumbers.sourcePlatform")
                      : t("adminPages.phoneNumbers.sourceByo")}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[row.purchaseStatus]}`}>
                      {t(STATUS_LABEL_KEYS[row.purchaseStatus])}
                    </span>
                    {row.failureReason ? <span className="block max-w-xs text-xs text-red-600">{row.failureReason}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.monthlyPriceDkk
                      ? t("adminPages.phoneNumbers.priceMonthly", { price: row.monthlyPriceDkk })
                      : t("adminPages.phoneNumbers.noPrice")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {row.purchaseStatus === "failed" ? (
                        <button
                          type="button"
                          onClick={() => handleRetry(row.id)}
                          disabled={busyId === row.id}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          {t("adminPages.phoneNumbers.retry")}
                        </button>
                      ) : null}
                      {row.purchaseStatus !== "released" ? (
                        <button
                          type="button"
                          onClick={() => handleRelease(row.id)}
                          disabled={busyId === row.id}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                        >
                          {t("adminPages.phoneNumbers.release")}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
