"use client";

import { useState } from "react";
import { useTranslation } from "@/components/i18n/language-provider";
import { AgentFormModal, type AgentFormWidget } from "@/components/admin/agent-form-modal";

export interface AdminWidgetRow {
  id: string;
  name: string;
  public_id: string;
  status: "active" | "paused";
  deployment_type: "customer_website" | "aibooking_website";
  business_name: string | null;
  system_prompt: string | null;
  opening_message: string | null;
  language: string;
  customer_id: string;
  wapi_agent_id: string | null;
  created_at: string;
  customers: { id: string; name: string; email: string } | null;
  wapi_agents: { id: string; wapi_agent_id: string; name: string | null } | null;
  phone_numbers: { id: string; phone_number: string }[] | null;
  shareUrl: string;
  embedSnippet: string;
}

function formatDate(value: string, locale: string): string {
  return new Date(value).toLocaleDateString(locale === "da" ? "da-DK" : "en-US");
}

export function AdminWidgetsTable({ initialWidgets }: { initialWidgets: AdminWidgetRow[] }) {
  const { t, locale } = useTranslation();
  const [widgets, setWidgets] = useState(initialWidgets);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editWidget, setEditWidget] = useState<AdminWidgetRow | null>(null);
  const [embedFor, setEmbedFor] = useState<AdminWidgetRow | null>(null);

  async function refresh() {
    const res = await fetch("/api/admin/widgets?agentType=widget");
    if (res.ok) {
      const data = await res.json();
      setWidgets(data.widgets ?? []);
    }
  }

  async function handleToggleStatus(widget: AdminWidgetRow) {
    setBusyId(widget.id);
    const nextStatus = widget.status === "active" ? "paused" : "active";
    const res = await fetch(`/api/admin/widgets/${widget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    setBusyId(null);
    if (res.ok) setWidgets((prev) => prev.map((w) => (w.id === widget.id ? { ...w, status: nextStatus } : w)));
  }

  async function handleDelete(widget: AdminWidgetRow) {
    if (!window.confirm(t("adminPages.widgets.confirmDelete"))) return;
    setBusyId(widget.id);
    const res = await fetch(`/api/admin/widgets/${widget.id}`, { method: "DELETE" });
    setBusyId(null);
    if (res.ok) setWidgets((prev) => prev.map((w) => (w.id === widget.id ? { ...w, status: "paused" } : w)));
  }

  async function handleDuplicate(widget: AdminWidgetRow) {
    setBusyId(widget.id);
    const res = await fetch(`/api/admin/widgets/${widget.id}/duplicate`, { method: "POST" });
    setBusyId(null);
    if (res.ok) await refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t("adminShell.nav.widgets")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("adminPages.widgets.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {t("adminPages.widgets.createButton")}
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">{t("adminPages.widgets.tableName")}</th>
              <th className="px-4 py-3">{t("adminShell.nav.customers")}</th>
              <th className="px-4 py-3">{t("adminShell.nav.wapiAgents")}</th>
              <th className="px-4 py-3">{t("adminPages.widgets.tablePhoneNumber")}</th>
              <th className="px-4 py-3">{t("adminPages.shared.statusLabel")}</th>
              <th className="px-4 py-3">{t("adminPages.widgets.tableCreated")}</th>
              <th className="px-4 py-3">{t("adminPages.phoneNumbers.tableActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {widgets.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  {t("adminPages.widgets.empty")}
                </td>
              </tr>
            ) : (
              widgets.map((widget) => (
                <tr key={widget.id}>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {widget.name}
                    {widget.deployment_type === "aibooking_website" ? (
                      <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
                        {t("adminPages.widgets.deploymentAibooking")}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{widget.customers?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{widget.wapi_agents?.name ?? (widget.wapi_agents?.wapi_agent_id ?? "—")}</td>
                  <td className="px-4 py-3 text-slate-600">{widget.phone_numbers?.[0]?.phone_number ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        widget.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {widget.status === "active" ? t("adminPages.shared.active") : t("adminPages.shared.paused")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(widget.created_at, locale)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setEditWidget(widget)}
                        className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {t("adminPages.widgets.actionEdit")}
                      </button>
                      <a
                        href={`/widget/${widget.public_id}/preview`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {t("adminPages.widgets.actionOpen")}
                      </a>
                      <button
                        type="button"
                        onClick={() => setEmbedFor(widget)}
                        className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {t("adminPages.widgets.actionEmbed")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDuplicate(widget)}
                        disabled={busyId === widget.id}
                        className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {t("adminPages.widgets.actionDuplicate")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(widget)}
                        disabled={busyId === widget.id}
                        className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {widget.status === "active" ? t("adminPages.widgets.actionDeactivate") : t("adminPages.widgets.actionActivate")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(widget)}
                        disabled={busyId === widget.id}
                        className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreate ? (
        <AgentFormModal
          agentType="widget"
          createEndpoint="/api/admin/widgets"
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            refresh();
          }}
        />
      ) : null}

      {editWidget ? (
        <AgentFormModal
          agentType="widget"
          createEndpoint="/api/admin/widgets"
          initial={editWidget as unknown as AgentFormWidget}
          onClose={() => setEditWidget(null)}
          onSaved={() => {
            setEditWidget(null);
            refresh();
          }}
        />
      ) : null}

      {embedFor ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">{t("adminPages.widgets.embedTitle")}</h2>
              <button type="button" onClick={() => setEmbedFor(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{embedFor.embedSnippet}</pre>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(embedFor.embedSnippet)}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                {t("adminPages.widgets.copyEmbedCode")}
              </button>
              <a
                href={`/widget/${embedFor.public_id}/preview`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {t("adminPages.widgets.actionOpen")}
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
