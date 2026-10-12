"use client";

import { useState } from "react";
import { useTranslation } from "@/components/i18n/language-provider";
import { AgentFormModal, type AgentFormWidget } from "@/components/admin/agent-form-modal";
import type { AdminWidgetRow } from "@/components/admin/widgets-table";

function formatDate(value: string, locale: string): string {
  return new Date(value).toLocaleDateString(locale === "da" ? "da-DK" : "en-US");
}

export function AdminInboundTable({ initialAgents }: { initialAgents: AdminWidgetRow[] }) {
  const { t, locale } = useTranslation();
  const [agents, setAgents] = useState(initialAgents);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editAgent, setEditAgent] = useState<AdminWidgetRow | null>(null);

  async function refresh() {
    const res = await fetch("/api/admin/inbound");
    if (res.ok) {
      const data = await res.json();
      setAgents(data.inboundAgents ?? []);
    }
  }

  async function handleToggleStatus(agent: AdminWidgetRow) {
    setBusyId(agent.id);
    const nextStatus = agent.status === "active" ? "paused" : "active";
    const res = await fetch(`/api/admin/widgets/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    setBusyId(null);
    if (res.ok) setAgents((prev) => prev.map((w) => (w.id === agent.id ? { ...w, status: nextStatus } : w)));
  }

  async function handleDelete(agent: AdminWidgetRow) {
    if (!window.confirm(t("adminPages.widgets.confirmDelete"))) return;
    setBusyId(agent.id);
    const res = await fetch(`/api/admin/widgets/${agent.id}`, { method: "DELETE" });
    setBusyId(null);
    if (res.ok) setAgents((prev) => prev.map((w) => (w.id === agent.id ? { ...w, status: "paused" } : w)));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t("adminShell.nav.inbound")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("adminPages.inbound.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {t("adminPages.inbound.createButton")}
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
            {agents.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  {t("adminPages.inbound.empty")}
                </td>
              </tr>
            ) : (
              agents.map((agent) => (
                <tr key={agent.id}>
                  <td className="px-4 py-3 font-medium text-slate-800">{agent.name}</td>
                  <td className="px-4 py-3 text-slate-600">{agent.customers?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{agent.wapi_agents?.name ?? (agent.wapi_agents?.wapi_agent_id ?? "—")}</td>
                  <td className="px-4 py-3 text-slate-600">{agent.phone_numbers?.[0]?.phone_number ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        agent.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {agent.status === "active" ? t("adminPages.shared.active") : t("adminPages.shared.paused")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(agent.created_at, locale)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setEditAgent(agent)}
                        className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {t("adminPages.widgets.actionEdit")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(agent)}
                        disabled={busyId === agent.id}
                        className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {agent.status === "active" ? t("adminPages.widgets.actionDeactivate") : t("adminPages.widgets.actionActivate")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(agent)}
                        disabled={busyId === agent.id}
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
          agentType="phone"
          createEndpoint="/api/admin/inbound"
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            refresh();
          }}
        />
      ) : null}

      {editAgent ? (
        <AgentFormModal
          agentType="phone"
          createEndpoint="/api/admin/inbound"
          initial={editAgent as unknown as AgentFormWidget}
          onClose={() => setEditAgent(null)}
          onSaved={() => {
            setEditAgent(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
