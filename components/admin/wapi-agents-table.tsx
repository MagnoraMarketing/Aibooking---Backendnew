"use client";

import { Fragment, useState } from "react";
import { useTranslation } from "@/components/i18n/language-provider";
import type { WapiAgent } from "@/types/database";

interface ConnectableWidget {
  id: string;
  name: string;
  wapi_agent_id: string | null;
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(locale === "da" ? "da-DK" : "en-US");
}

export function AdminWapiAgentsTable({ initialAgents, initialLastSyncedAt }: { initialAgents: WapiAgent[]; initialLastSyncedAt: string | null }) {
  const { t, locale } = useTranslation();
  const [agents, setAgents] = useState(initialAgents);
  const [lastSyncedAt, setLastSyncedAt] = useState(initialLastSyncedAt);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [connectedWidgets, setConnectedWidgets] = useState<ConnectableWidget[]>([]);
  const [allWidgets, setAllWidgets] = useState<ConnectableWidget[]>([]);
  const [connectTargetId, setConnectTargetId] = useState<string | null>(null);
  const [pickerAgentId, setPickerAgentId] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    const res = await fetch("/api/admin/wapi/agents", { method: "POST" });
    setSyncing(false);
    if (!res.ok) {
      setError(t("adminPages.wapiAgents.loadError"));
      return;
    }
    const data = await res.json();
    setAgents(data.agents ?? []);
    setLastSyncedAt(data.lastSyncedAt ?? null);
  }

  async function handleRefreshRow(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/admin/wapi/agents/${id}`);
    setBusyId(null);
    if (!res.ok) return;
    const data = await res.json();
    setAgents((prev) => prev.map((a) => (a.id === id ? data.agent : a)));
  }

  async function handleExpand(agent: WapiAgent) {
    if (expandedId === agent.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(agent.id);
    const res = await fetch(`/api/admin/widgets?wapiAgentId=${agent.id}`);
    if (res.ok) {
      const data = await res.json();
      setConnectedWidgets(
        (data.widgets ?? []).map((w: { id: string; name: string; wapi_agent_id: string | null }) => ({
          id: w.id,
          name: w.name,
          wapi_agent_id: w.wapi_agent_id,
        }))
      );
    }
  }

  async function openConnectPicker(agentId: string) {
    setPickerAgentId(agentId);
    setConnectTargetId(null);
    const res = await fetch("/api/admin/widgets");
    if (res.ok) {
      const data = await res.json();
      setAllWidgets(
        (data.widgets ?? []).map((w: { id: string; name: string; wapi_agent_id: string | null }) => ({
          id: w.id,
          name: w.name,
          wapi_agent_id: w.wapi_agent_id,
        }))
      );
    }
  }

  async function handleConnect() {
    if (!pickerAgentId || !connectTargetId) return;
    setBusyId(pickerAgentId);
    await fetch(`/api/admin/widgets/${connectTargetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wapiAgentId: pickerAgentId }),
    });
    setBusyId(null);
    setPickerAgentId(null);
    if (expandedId) await handleExpand({ id: expandedId } as WapiAgent);
  }

  async function handleDisconnect(widgetId: string) {
    setBusyId(widgetId);
    await fetch(`/api/admin/widgets/${widgetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wapiAgentId: null, wapiAgentExternalId: null }),
    });
    setBusyId(null);
    setConnectedWidgets((prev) => prev.filter((w) => w.id !== widgetId));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t("adminShell.nav.wapiAgents")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{t("adminPages.wapiAgents.pageHint")}</p>
          <p className="mt-1 text-xs text-slate-400">
            {t("adminPages.wapiAgents.lastSynced")}: {formatDate(lastSyncedAt, locale)}
          </p>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {syncing ? t("adminPages.wapiAgents.syncing") : t("adminPages.wapiAgents.syncAgents")}
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}{" "}
          <button type="button" onClick={handleSync} className="ml-2 font-medium underline">
            {t("common.tryAgain")}
          </button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">{t("adminPages.wapiAgents.tableName")}</th>
              <th className="px-4 py-3">{t("adminPages.wapiAgents.tableId")}</th>
              <th className="px-4 py-3">{t("adminPages.wapiAgents.tableLanguage")}</th>
              <th className="px-4 py-3">{t("adminPages.wapiAgents.tableVoice")}</th>
              <th className="px-4 py-3">{t("adminPages.shared.statusLabel")}</th>
              <th className="px-4 py-3">{t("adminPages.wapiAgents.tableLastSynced")}</th>
              <th className="px-4 py-3">{t("adminPages.phoneNumbers.tableActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {agents.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  {t("adminPages.wapiAgents.noAgentsFound")}
                </td>
              </tr>
            ) : (
              agents.map((agent) => (
                <Fragment key={agent.id}>
                  <tr>
                    <td className="px-4 py-3 font-medium text-slate-800">{agent.name || t("adminPages.wapiAgents.unnamedAgent")}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{agent.wapi_agent_id}</td>
                    <td className="px-4 py-3 text-slate-600">{agent.language || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{agent.voice || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                        {agent.status || t("adminPages.shared.active")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(agent.last_synced_at, locale)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleRefreshRow(agent.id)}
                          disabled={busyId === agent.id}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          {t("adminPages.wapiAgents.refresh")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExpand(agent)}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          {t("adminPages.wapiAgents.view")}
                        </button>
                        <button
                          type="button"
                          onClick={() => navigator.clipboard?.writeText(agent.wapi_agent_id)}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          {t("adminPages.wapiAgents.copyId")}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === agent.id ? (
                    <tr>
                      <td colSpan={7} className="bg-slate-50 px-4 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {t("adminPages.wapiAgents.connectedWidgets")}
                          </h3>
                          <button
                            type="button"
                            onClick={() => openConnectPicker(agent.id)}
                            className="text-xs font-medium text-brand-600 hover:text-brand-700"
                          >
                            {t("adminPages.wapiAgents.connect")}
                          </button>
                        </div>
                        {connectedWidgets.length === 0 ? (
                          <p className="mt-2 text-sm text-slate-500">{t("adminPages.wapiAgents.noConnectedWidgets")}</p>
                        ) : (
                          <ul className="mt-2 space-y-1">
                            {connectedWidgets.map((w) => (
                              <li key={w.id} className="flex items-center justify-between text-sm">
                                <span className="text-slate-700">{w.name}</span>
                                <button
                                  type="button"
                                  onClick={() => handleDisconnect(w.id)}
                                  disabled={busyId === w.id}
                                  className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-60"
                                >
                                  {t("adminPages.wapiAgents.disconnect")}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}

                        {pickerAgentId === agent.id ? (
                          <div className="mt-3 flex items-center gap-2">
                            <select
                              value={connectTargetId ?? ""}
                              onChange={(e) => setConnectTargetId(e.target.value || null)}
                              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                            >
                              <option value="">{t("adminPages.wapiAgents.selectPlaceholder")}</option>
                              {allWidgets.map((w) => (
                                <option key={w.id} value={w.id}>
                                  {w.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={handleConnect}
                              disabled={!connectTargetId || busyId === pickerAgentId}
                              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                            >
                              {t("adminPages.clientPortal.confirm")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPickerAgentId(null)}
                              className="text-xs font-medium text-slate-500 hover:text-slate-700"
                            >
                              {t("common.cancel")}
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
