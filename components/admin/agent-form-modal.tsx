"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "@/components/i18n/language-provider";
import {
  UberDirectFields,
  EMPTY_UBER_DIRECT,
  formStateFromSummary,
  uberDirectPayload,
  type UberDirectFormState,
  type UberDirectSummaryView,
} from "@/components/uber-direct/uber-direct-fields";
import { WapiAgentSelector, type WapiAgentSelection } from "@/components/admin/wapi-agent-selector";
import type { Customer, WidgetDeploymentType } from "@/types/database";

interface AvailablePhoneNumber {
  id: string;
  number: string;
  name: string | null;
}

interface CalcomEventType {
  id: number;
  title: string;
}

export interface AgentFormWidget {
  id: string;
  name: string;
  business_name: string | null;
  status: "active" | "paused";
  deployment_type: WidgetDeploymentType;
  customer_id: string;
  wapi_agent_id: string | null;
  system_prompt: string | null;
  opening_message: string | null;
  language: string;
}

interface AgentFormModalProps {
  agentType: "widget" | "phone";
  createEndpoint: string;
  onClose: () => void;
  onSaved: () => void;
  initial?: AgentFormWidget | null;
}

// Shared create/edit form for both Voice Widgets (spec section 4) and
// Inbound agents (spec section 7) — the two differ only in agent_type and
// which endpoint creates them; everything else (deployment type, Wapi agent
// picker, phone number attach) is identical, so this is the one place both
// pages render.
export function AgentFormModal({ agentType, createEndpoint, onClose, onSaved, initial }: AgentFormModalProps) {
  const { t } = useTranslation();
  const isEdit = Boolean(initial);

  const [name, setName] = useState(initial?.name ?? "");
  const [businessName, setBusinessName] = useState(initial?.business_name ?? "");
  const [status, setStatus] = useState<"active" | "paused">(initial?.status ?? "active");
  const [deploymentType, setDeploymentType] = useState<WidgetDeploymentType>(initial?.deployment_type ?? "customer_website");
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt ?? "");
  const [openingMessage, setOpeningMessage] = useState(initial?.opening_message ?? "");
  const [agentSelection, setAgentSelection] = useState<WapiAgentSelection>({ wapiAgentId: initial?.wapi_agent_id ?? null, wapiAgentExternalId: null });
  const [phoneNumberId, setPhoneNumberId] = useState<string | null>(null);
  const [calcomApiKey, setCalcomApiKey] = useState("");
  const [calcomEventTypeId, setCalcomEventTypeId] = useState("");
  const [calcomEventTypes, setCalcomEventTypes] = useState<CalcomEventType[]>([]);
  const [calcomAccountLabel, setCalcomAccountLabel] = useState<string | null>(null);
  const [calcomFetching, setCalcomFetching] = useState(false);
  const [calcomFetchError, setCalcomFetchError] = useState<string | null>(null);

  const [uberDirect, setUberDirect] = useState<UberDirectFormState>(EMPTY_UBER_DIRECT);
  const [uberSummary, setUberSummary] = useState<UberDirectSummaryView | null>(null);
  const [uberWebhookUrl, setUberWebhookUrl] = useState<string | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [availableNumbers, setAvailableNumbers] = useState<AvailablePhoneNumber[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new agent starts from the platform's default prompt, so the admin
  // edits a working prompt instead of guessing at a blank box. Editing an
  // existing agent keeps its own.
  useEffect(() => {
    if (isEdit) return;
    fetch("/api/admin/settings/default-prompt")
      .then((res) => res.json())
      .then((data) => {
        if (typeof data?.prompt === "string") setSystemPrompt((current) => current || data.prompt);
      })
      .catch(() => {});
  }, [isEdit]);

  // Editing: load the agent's current Uber Direct setup (never its secrets).
  useEffect(() => {
    if (!initial?.id) return;
    fetch(`/api/admin/widgets/${initial.id}`)
      .then((res) => res.json())
      .then((data) => {
        setUberSummary(data?.uberDirect ?? null);
        setUberWebhookUrl(data?.uberDirectWebhookUrl ?? null);
        setUberDirect(formStateFromSummary(data?.uberDirect));
      })
      .catch(() => {});
  }, [initial?.id]);

  useEffect(() => {
    fetch("/api/admin/customers")
      .then((res) => res.json())
      .then((data) => setCustomers((data.customers ?? []).filter((c: Customer) => !c.is_platform_owned)))
      .catch(() => {});
    fetch("/api/admin/phone-numbers/available")
      .then((res) => res.json())
      .then((data) => setAvailableNumbers(data.numbers ?? []))
      .catch(() => {});
  }, []);

  // Proves the pasted key works and lists what it can book against — the
  // same "pick an event type from a list" step the customer dashboard offers
  // (components/dashboard/calendar-integrations-manager.tsx), so the admin
  // doesn't have to already know the numeric event-type id. Nothing is
  // persisted here; the actual connect happens on save (Gem), same as the
  // Wapi agent picker's "Opdater agenter".
  async function fetchCalcomEventTypes() {
    if (!calcomApiKey.trim()) return;
    setCalcomFetching(true);
    setCalcomFetchError(null);
    try {
      const res = await fetch("/api/admin/calendar/calcom/event-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: calcomApiKey.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || "failed");
      setCalcomEventTypes(data.eventTypes ?? []);
      setCalcomAccountLabel(data.account?.email || data.account?.username || null);
      if (!calcomEventTypeId.trim() && data.eventTypes?.[0]) {
        setCalcomEventTypeId(String(data.eventTypes[0].id));
      }
    } catch (err) {
      setCalcomEventTypes([]);
      setCalcomAccountLabel(null);
      setCalcomFetchError(err instanceof Error ? err.message : t("adminPages.widgets.calcomFetchError"));
    } finally {
      setCalcomFetching(false);
    }
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setError(t("adminPages.widgets.formErrorName"));
      return;
    }
    if (deploymentType === "customer_website" && !customerId && !isEdit) {
      setError(t("adminPages.widgets.formErrorCustomer"));
      return;
    }
    if (Boolean(calcomApiKey.trim()) !== Boolean(calcomEventTypeId.trim())) {
      setError(t("adminPages.widgets.formErrorCalcom"));
      return;
    }

    // Uber Direct: sent only when switched on (complete) or switched off
    // after having been set up (removes it).
    let uberDirectBody: Record<string, unknown> | null | undefined;
    if (uberDirect.enabled) {
      const payload = uberDirectPayload(uberDirect, Boolean(uberSummary?.hasClientSecret));
      if (!payload) {
        setError(t("agent.uberDirect.incomplete"));
        return;
      }
      uberDirectBody = payload;
    } else if (uberSummary) {
      uberDirectBody = null;
    }

    setSaving(true);
    setError(null);

    const body: Record<string, unknown> = {
      name: name.trim(),
      businessName: businessName.trim() || null,
      status,
      deploymentType,
      systemPrompt: systemPrompt.trim() || null,
      openingMessage: openingMessage.trim() || null,
      wapiAgentId: agentSelection.wapiAgentId,
      wapiAgentExternalId: agentSelection.wapiAgentExternalId,
      phoneNumberId: phoneNumberId || undefined,
      ...(uberDirectBody !== undefined ? { uberDirect: uberDirectBody } : {}),
    };
    if (calcomApiKey.trim()) {
      body.calcomApiKey = calcomApiKey.trim();
      body.calcomEventTypeId = Number(calcomEventTypeId.trim());
    }
    if (!isEdit) {
      body.agentType = agentType;
      if (deploymentType === "customer_website") body.customerId = customerId;
    }

    const url = isEdit ? `/api/admin/widgets/${initial!.id}` : createEndpoint;
    const method = isEdit ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setSaving(false);

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error?.message || t("adminPages.widgets.formErrorSave"));
      return;
    }

    // Saved either way; if Vapi refused the prompt, say so instead of
    // closing as if the agent were already running on it.
    if (data?.vapiSync?.status === "failed") {
      setError(`${t("adminPages.widgets.vapiSyncFailed")} ${data.vapiSync.error ?? ""}`.trim());
      return;
    }

    onSaved();
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-10">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {isEdit
              ? t(agentType === "phone" ? "adminPages.inbound.editTitle" : "adminPages.widgets.editTitle")
              : t(agentType === "phone" ? "adminPages.inbound.createTitle" : "adminPages.widgets.createTitle")}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">{t("adminPages.widgets.nameLabel")}</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">{t("adminPages.widgets.descriptionLabel")}</label>
              <input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">{t("adminPages.widgets.deploymentTypeLabel")}</label>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={deploymentType === "customer_website"}
                  onChange={() => setDeploymentType("customer_website")}
                />
                {t("adminPages.widgets.deploymentCustomer")}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={deploymentType === "aibooking_website"}
                  onChange={() => setDeploymentType("aibooking_website")}
                />
                {t("adminPages.widgets.deploymentAibooking")}
              </label>
            </div>
          </div>

          {deploymentType === "customer_website" ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">{t("adminShell.nav.customers")}</label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                disabled={isEdit}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50"
              >
                <option value="">{t("adminPages.wapiAgents.selectPlaceholder")}</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.email})
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">{t("adminPages.shared.statusLabel")}</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "active" | "paused")}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            >
              <option value="active">{t("adminPages.shared.active")}</option>
              <option value="paused">{t("adminPages.shared.paused")}</option>
            </select>
          </div>

          <WapiAgentSelector value={agentSelection} onChange={setAgentSelection} />

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">{t("adminPages.widgets.phoneNumberLabel")}</label>
            <select
              value={phoneNumberId ?? ""}
              onChange={(e) => setPhoneNumberId(e.target.value || null)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            >
              <option value="">{t("adminPages.widgets.noPhoneNumber")}</option>
              {availableNumbers.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.number} {n.name ? `(${n.name})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-sm font-medium text-slate-700">{t("adminPages.widgets.calcomSectionLabel")}</p>
            <p className="mb-2 text-xs text-slate-500">{t("adminPages.widgets.calcomHelpText")}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">{t("adminPages.widgets.calcomApiKeyLabel")}</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={calcomApiKey}
                    onChange={(e) => {
                      setCalcomApiKey(e.target.value);
                      setCalcomEventTypes([]);
                      setCalcomAccountLabel(null);
                      setCalcomFetchError(null);
                    }}
                    placeholder={t("adminPages.widgets.calcomApiKeyPlaceholder")}
                    autoComplete="off"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                  <button
                    type="button"
                    onClick={fetchCalcomEventTypes}
                    disabled={!calcomApiKey.trim() || calcomFetching}
                    className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {calcomFetching ? t("adminPages.wapiAgents.syncing") : t("adminPages.widgets.calcomFetchButton")}
                  </button>
                </div>
                {calcomAccountLabel ? (
                  <p className="mt-1 text-xs text-emerald-600">{t("adminPages.widgets.calcomConnectedAs")}: {calcomAccountLabel}</p>
                ) : null}
                {calcomFetchError ? <p className="mt-1 text-xs text-red-600">{calcomFetchError}</p> : null}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">{t("adminPages.widgets.calcomEventTypeIdLabel")}</label>
                {calcomEventTypes.length > 0 ? (
                  <select
                    value={calcomEventTypeId}
                    onChange={(e) => setCalcomEventTypeId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  >
                    {calcomEventTypes.map((eventType) => (
                      <option key={eventType.id} value={eventType.id}>
                        {eventType.title} (#{eventType.id})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={calcomEventTypeId}
                    onChange={(e) => setCalcomEventTypeId(e.target.value)}
                    inputMode="numeric"
                    placeholder={t("adminPages.widgets.calcomEventTypeIdPlaceholder")}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-1 text-sm font-medium text-slate-700">🚚 {t("agent.uberDirect.title")}</p>
            <p className="mb-3 text-xs text-slate-500">{t("agent.uberDirect.intro")}</p>
            <UberDirectFields
              value={uberDirect}
              onChange={setUberDirect}
              hasClientSecret={uberSummary?.hasClientSecret}
              hasWebhookSigningKey={uberSummary?.hasWebhookSigningKey}
              webhookUrl={uberWebhookUrl}
            />
          </div>

          <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3 space-y-3">
            <div>
              <p className="text-sm font-medium text-slate-800">{t("adminPages.widgets.promptSectionLabel")}</p>
              <p className="mt-1 text-xs text-slate-500">{t("adminPages.widgets.promptSectionHelp")}</p>
            </div>
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">{t("adminPages.inbound.greetingLabel")}</label>
                <input
                  value={openingMessage}
                  onChange={(e) => setOpeningMessage(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">{t("adminPages.inbound.systemPromptLabel")}</label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={10}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </>
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? t("adminPages.shared.save") : t("adminPages.shared.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
