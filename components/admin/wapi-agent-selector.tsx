"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/components/i18n/language-provider";
import type { WapiAgent } from "@/types/database";

export interface WapiAgentSelection {
  wapiAgentId: string | null;
  wapiAgentExternalId: string | null;
}

interface WapiAgentSelectorProps {
  value: WapiAgentSelection;
  onChange: (value: WapiAgentSelection) => void;
  // The currently-connected agent's display name, so a widget that's already
  // connected shows something meaningful before the catalog has loaded.
  currentLabel?: string | null;
}

// The searchable "Vælg Wapi Agent" dropdown (spec section 17), with the
// "Enter Wapi Agent ID manually" fallback (spec sections 4 and 19) always
// available — even while the catalog is loading fine, since an assistant
// built directly in Vapi's dashboard after the last sync won't be in it yet.
export function WapiAgentSelector({ value, onChange, currentLabel }: WapiAgentSelectorProps) {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<WapiAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [manualId, setManualId] = useState(value.wapiAgentExternalId ?? "");
  const [open, setOpen] = useState(false);

  async function loadAgents() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/wapi/agents");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setAgents(data.agents ?? []);
    } catch {
      setError(t("adminPages.wapiAgents.loadError"));
    } finally {
      setLoading(false);
    }
  }

  async function syncAgents() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/wapi/agents", { method: "POST" });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setAgents(data.agents ?? []);
    } catch {
      setError(t("adminPages.wapiAgents.loadError"));
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    loadAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) => (a.name ?? "").toLowerCase().includes(q) || a.wapi_agent_id.toLowerCase().includes(q)
    );
  }, [agents, query]);

  const selectedAgent = agents.find((a) => a.id === value.wapiAgentId);
  const displayLabel = selectedAgent?.name || currentLabel || (value.wapiAgentExternalId ? value.wapiAgentExternalId : null);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-slate-700">{t("adminPages.wapiAgents.selectorLabel")}</label>
        <button
          type="button"
          onClick={syncAgents}
          disabled={syncing}
          className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-60"
        >
          {syncing ? t("adminPages.wapiAgents.syncing") : t("adminPages.wapiAgents.refreshAgents")}
        </button>
      </div>

      {!manualMode ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-300 px-3 py-2 text-left text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            <span className={displayLabel ? "text-slate-800" : "text-slate-400"}>
              {displayLabel ?? t("adminPages.wapiAgents.selectPlaceholder")}
            </span>
            <span className="text-slate-400">▾</span>
          </button>

          {open ? (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
              <div className="border-b border-slate-100 p-2">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("adminPages.wapiAgents.searchPlaceholder")}
                  className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                />
              </div>
              <div className="max-h-64 overflow-y-auto">
                {loading ? (
                  <p className="p-3 text-sm text-slate-500">{t("common.loading")}</p>
                ) : error ? (
                  <div className="p-3">
                    <p className="text-sm text-red-600">{error}</p>
                    <button
                      type="button"
                      onClick={loadAgents}
                      className="mt-1 text-sm font-medium text-brand-600 hover:text-brand-700"
                    >
                      {t("common.tryAgain")}
                    </button>
                  </div>
                ) : filtered.length === 0 ? (
                  <p className="p-3 text-sm text-slate-500">{t("adminPages.wapiAgents.noAgentsFound")}</p>
                ) : (
                  filtered.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => {
                        onChange({ wapiAgentId: agent.id, wapiAgentExternalId: null });
                        setOpen(false);
                      }}
                      className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                        value.wapiAgentId === agent.id ? "bg-brand-50" : ""
                      }`}
                    >
                      <span className="block font-medium text-slate-800">{agent.name || t("adminPages.wapiAgents.unnamedAgent")}</span>
                      <span className="block text-xs text-slate-500">
                        ID: {agent.wapi_agent_id}
                        {agent.language ? ` · ${agent.language}` : ""}
                        {agent.status ? ` · ${agent.status}` : ""}
                      </span>
                    </button>
                  ))
                )}
              </div>
              {value.wapiAgentId ? (
                <div className="border-t border-slate-100 p-2">
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ wapiAgentId: null, wapiAgentExternalId: null });
                      setOpen(false);
                    }}
                    className="text-xs font-medium text-red-600 hover:text-red-700"
                  >
                    {t("adminPages.wapiAgents.clearSelection")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <input
          value={manualId}
          onChange={(e) => {
            setManualId(e.target.value);
            onChange({ wapiAgentId: null, wapiAgentExternalId: e.target.value.trim() || null });
          }}
          placeholder={t("adminPages.wapiAgents.manualIdPlaceholder")}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      )}

      {error && manualMode ? <p className="text-xs text-amber-600">{t("adminPages.wapiAgents.loadError")}</p> : null}

      <button
        type="button"
        onClick={() => {
          setManualMode((v) => !v);
          if (manualMode) {
            setManualId("");
          } else {
            onChange({ wapiAgentId: null, wapiAgentExternalId: manualId.trim() || null });
          }
        }}
        className="text-xs font-medium text-slate-500 hover:text-slate-700 underline"
      >
        {manualMode ? t("adminPages.wapiAgents.useDropdownInstead") : t("adminPages.wapiAgents.enterManually")}
      </button>
    </div>
  );
}
