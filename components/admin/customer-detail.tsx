"use client";

import { useState } from "react";
import type { Widget } from "@/types/database";
import { useTranslation } from "@/components/i18n/language-provider";

export function CustomerWidgetList({
  initialWidgets,
  outboundAssistantIds,
}: {
  initialWidgets: Widget[];
  // Per agent: the Vapi assistant its outbound campaigns use, if it has one
  // of its own. Support needs to set this without a database console — see
  // lib/vapi/assistant-owner.ts for what it does.
  outboundAssistantIds: Record<string, string>;
}) {
  const { t } = useTranslation();
  const [widgets, setWidgets] = useState(initialWidgets);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outbound, setOutbound] = useState(outboundAssistantIds);
  const [savedId, setSavedId] = useState<string | null>(null);

  async function saveOutboundAssistant(widgetId: string) {
    setBusyId(widgetId);
    setSavedId(null);

    const res = await fetch(`/api/admin/widgets/${widgetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // Empty clears it, which puts campaigns back on the assistant that
      // answers the phone.
      body: JSON.stringify({ extra: { vapiOutboundAssistantId: (outbound[widgetId] ?? "").trim() || null } }),
    });

    setBusyId(null);
    if (res.ok) setSavedId(widgetId);
  }

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
        <li key={widget.id} className="space-y-3 rounded-lg border border-slate-200 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
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
          </div>

          {widget.agent_type === "phone" ? (
            <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
              <div className="min-w-[18rem] flex-1">
                <label
                  htmlFor={`outbound-assistant-${widget.id}`}
                  className="mb-1 block text-xs font-medium text-slate-600"
                >
                  {t("adminPages.customerDetail.outboundAssistantLabel")}
                </label>
                <input
                  id={`outbound-assistant-${widget.id}`}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={outbound[widget.id] ?? ""}
                  onChange={(e) => setOutbound((prev) => ({ ...prev, [widget.id]: e.target.value }))}
                  placeholder={t("adminPages.customerDetail.outboundAssistantPlaceholder")}
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <button
                type="button"
                onClick={() => saveOutboundAssistant(widget.id)}
                disabled={busyId === widget.id}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {t("adminPages.shared.save")}
              </button>
              {savedId === widget.id ? (
                <span className="text-xs text-emerald-600">{t("adminPages.shared.saved")}</span>
              ) : null}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
