"use client";

import { useState } from "react";

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

const STATUS_LABELS: Record<AdminPhoneNumberRow["purchaseStatus"], string> = {
  pending_payment: "Afventer betaling",
  payment_confirmed: "Betaling bekræftet",
  provisioning: "Provisionerer…",
  active: "Aktiv",
  failed: "Fejlet",
  released: "Frigivet",
};

const STATUS_COLORS: Record<AdminPhoneNumberRow["purchaseStatus"], string> = {
  pending_payment: "bg-slate-100 text-slate-600",
  payment_confirmed: "bg-blue-50 text-blue-700",
  provisioning: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
  released: "bg-slate-100 text-slate-500",
};

const DIRECTION_LABELS: Record<AdminPhoneNumberRow["direction"], string> = {
  inbound: "Inbound",
  outbound: "Outbound",
  both: "Inbound + Outbound",
};

export function AdminPhoneNumbersTable({ initialRows }: { initialRows: AdminPhoneNumberRow[] }) {
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
    if (!confirm("Frigiv dette nummer fra Twilio? Det kan ikke gendannes.")) return;
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
        <h1 className="text-2xl font-semibold text-slate-900">Telefonnumre</h1>
        <p className="mt-1 text-sm text-slate-500">Alle telefonnumre på tværs af kunder.</p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Nummer</th>
              <th className="px-4 py-3">Kunde</th>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Retning</th>
              <th className="px-4 py-3">Kilde</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Pris</th>
              <th className="px-4 py-3">Handlinger</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  Ingen telefonnumre endnu.
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
                  <td className="px-4 py-3 text-slate-600">{DIRECTION_LABELS[row.direction]}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.source === "platform_twilio" ? "Købt gennem os" : "Eget Twilio"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[row.purchaseStatus]}`}>
                      {STATUS_LABELS[row.purchaseStatus]}
                    </span>
                    {row.failureReason ? <span className="block max-w-xs text-xs text-red-600">{row.failureReason}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.monthlyPriceDkk ? `${row.monthlyPriceDkk} DKK/md` : "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {row.purchaseStatus === "failed" ? (
                        <button
                          type="button"
                          onClick={() => handleRetry(row.id)}
                          disabled={busyId === row.id}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Prøv igen
                        </button>
                      ) : null}
                      {row.purchaseStatus !== "released" ? (
                        <button
                          type="button"
                          onClick={() => handleRelease(row.id)}
                          disabled={busyId === row.id}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                        >
                          Frigiv
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
