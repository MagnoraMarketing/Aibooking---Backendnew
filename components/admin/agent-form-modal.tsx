"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "@/components/i18n/language-provider";
import { WapiAgentSelector, type WapiAgentSelection } from "@/components/admin/wapi-agent-selector";
import type { Customer, WidgetDeploymentType } from "@/types/database";

interface AvailablePhoneNumber {
  id: string;
  number: string;
  name: string | null;
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

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [availableNumbers, setAvailableNumbers] = useState<AvailablePhoneNumber[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function handleSubmit() {
    if (!name.trim()) {
      setError(t("adminPages.widgets.formErrorName"));
      return;
    }
    if (deploymentType === "customer_website" && !customerId && !isEdit) {
      setError(t("adminPages.widgets.formErrorCustomer"));
      return;
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
    };
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

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message || t("adminPages.widgets.formErrorSave"));
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

          {agentType === "phone" ? (
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
                  rows={4}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </>
          ) : null}
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
