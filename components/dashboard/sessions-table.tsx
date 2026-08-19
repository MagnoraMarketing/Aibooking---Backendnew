"use client";

import { useState } from "react";
import { SessionDetailsModal } from "./session-details-modal";
import { useTranslation } from "@/components/i18n/language-provider";

export interface SessionRow {
  id: string;
  widgetName: string;
  startedAt: string;
  status: string;
  minutesUsed: number;
}

const PAGE_SIZE = 10;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("da-DK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SessionsTable({ sessions }: { sessions: SessionRow[] }) {
  const [page, setPage] = useState(1);
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const pageCount = Math.max(1, Math.ceil(sessions.length / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const pageRows = sessions.slice(start, start + PAGE_SIZE);

  if (sessions.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Ingen samtaler endnu.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Widget</th>
              <th className="px-5 py-3 font-medium">Dato</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Minutter</th>
              <th className="px-5 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 last:border-0">
                <td className="px-5 py-3 font-medium text-slate-800">{row.widgetName}</td>
                <td className="px-5 py-3 text-slate-500">{formatDate(row.startedAt)}</td>
                <td className="px-5 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      row.status === "ended" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {row.status === "ended" ? "Afsluttet" : "Aktiv"}
                  </span>
                </td>
                <td className="px-5 py-3 text-slate-600">{row.minutesUsed.toFixed(2)}</td>
                <td className="px-5 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setOpenConversationId(row.id)}
                    className="text-sm font-medium text-brand-600 hover:text-brand-700"
                  >
                    Se samtale
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Forrige
        </button>
        <span className="text-sm text-slate-500">
          Side {page} af {pageCount}
        </span>
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          disabled={page === pageCount}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Næste
        </button>
      </div>

      {openConversationId ? (
        <SessionDetailsModal conversationId={openConversationId} onClose={() => setOpenConversationId(null)} />
      ) : null}
    </div>
  );
}
