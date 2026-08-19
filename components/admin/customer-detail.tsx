"use client";

import { useState } from "react";
import type { Widget } from "@/types/database";
import { useTranslation } from "@/components/i18n/language-provider";

export function CustomerWidgetList({ initialWidgets }: { initialWidgets: Widget[] }) {
  const { t } = useTranslation();
  const [widgets, setWidgets] = useState(initialWidgets);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleStatus(widget: Widget) {
    setBusyId(widget.id);
    const nextStatus = widget.status === "active" ? "paused" : "active";

    const res = await fetch(`/api/admin/widgets/${widget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });

    setBusyId(null);
    if (res.ok) {
      setWidgets((prev) => prev.map((w) => (w.id === widget.id ? { ...w, status: nextStatus } : w)));
    }
  }

  if (widgets.length === 0) {
    return <p className="text-sm text-slate-500">{t("adminPages.customerDetail.noAgentsYet")}</p>;
  }

  return (
    <ul className="space-y-2">
      {widgets.map((widget) => (
        <li
          key={widget.id}
          className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3"
        >
          <div>
            <p className="text-sm font-medium text-slate-800">{widget.name}</p>
            <p className="text-xs text-slate-500">{widget.public_id}</p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                widget.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
              }`}
            >
              {widget.status === "active" ? t("adminPages.shared.active") : t("adminPages.shared.paused")}
            </span>
            <button
              type="button"
              onClick={() => toggleStatus(widget)}
              disabled={busyId === widget.id}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {widget.status === "active"
                ? t("adminPages.customerDetail.pauseAction")
                : t("adminPages.customerDetail.activateAction")}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
