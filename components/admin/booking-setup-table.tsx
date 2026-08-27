"use client";

import { useState } from "react";
import type { BookingSetupRequestStatus } from "@/types/database";

export interface AdminBookingSetupRow {
  id: string;
  status: BookingSetupRequestStatus;
  notes: string | null;
  requestNotes: string | null;
  customerName: string;
  customerEmail: string;
  widgetName: string;
  bookingEnabled: boolean;
  calendarConnected: boolean;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

const STATUS_STYLE: Record<BookingSetupRequestStatus, string> = {
  pending: "bg-amber-50 text-amber-700",
  in_progress: "bg-blue-50 text-blue-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-500",
};

const STATUS_LABEL: Record<BookingSetupRequestStatus, string> = {
  pending: "Afventer",
  in_progress: "I gang",
  completed: "Færdig",
  cancelled: "Annulleret",
};

// What a status may move to next. Completing is what actually switches the
// customer's agent on (the API flips widgets.booking_enabled and re-syncs the
// Vapi assistant), so it is deliberately not offered before the calendar is
// connected — see the guard in the row below.
const NEXT_STATUSES: Record<BookingSetupRequestStatus, BookingSetupRequestStatus[]> = {
  pending: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: ["in_progress"],
  cancelled: ["pending"],
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" });
}

export function AdminBookingSetupTable({ initialRows }: { initialRows: AdminBookingSetupRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateStatus(row: AdminBookingSetupRow, status: BookingSetupRequestStatus) {
    setBusyId(row.id);
    setError(null);

    const res = await fetch("/api/admin/booking-setup-requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, status }),
    });
    setBusyId(null);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? "Kunne ikke opdatere status.");
      return;
    }

    const { request } = await res.json();
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? {
              ...r,
              status: request.status,
              startedAt: request.started_at,
              completedAt: request.completed_at,
              bookingEnabled: request.status === "completed",
            }
          : r
      )
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Booking-opsætninger</h1>
        <p className="mt-1 text-sm text-slate-500">
          Kunder der har bestilt booking. At markere en som færdig slår booking til på deres agent og
          giver stemmeagenten booking-værktøjerne.
        </p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Ingen bestillinger endnu.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Kunde</th>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Kalender</th>
                <th className="px-4 py-3">Bestilt</th>
                <th className="px-4 py-3">Handling</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{row.customerName}</p>
                    <p className="text-xs text-slate-500">{row.customerEmail}</p>
                    {row.requestNotes ? (
                      <p className="mt-1 max-w-xs text-xs text-slate-500">{row.requestNotes}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row.widgetName}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLE[row.status]}`}>
                      {STATUS_LABEL[row.status]}
                    </span>
                    {row.bookingEnabled ? (
                      <p className="mt-1 text-xs text-emerald-600">Booking er slået til</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className={row.calendarConnected ? "text-emerald-600" : "text-slate-400"}>
                      {row.calendarConnected ? "Forbundet" : "Ikke forbundet"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    <p>Bestilt: {formatDate(row.createdAt)}</p>
                    <p>Startet: {formatDate(row.startedAt)}</p>
                    <p>Færdig: {formatDate(row.completedAt)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {NEXT_STATUSES[row.status].map((next) => {
                        // Completing without a connected calendar would turn
                        // booking on for an agent whose tools have nothing to
                        // call — it would tell callers it can book and then
                        // fail every time.
                        const blocked = next === "completed" && !row.calendarConnected;
                        return (
                          <button
                            key={next}
                            type="button"
                            onClick={() => updateStatus(row, next)}
                            disabled={busyId === row.id || blocked}
                            title={blocked ? "Forbind kundens kalender først" : undefined}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {STATUS_LABEL[next]}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
