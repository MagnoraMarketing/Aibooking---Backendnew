"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/components/i18n/language-provider";
import {
  UberDirectFields,
  formStateFromSummary,
  uberDirectPayload,
  EMPTY_UBER_DIRECT,
  type UberDirectFormState,
  type UberDirectSummaryView,
} from "@/components/uber-direct/uber-direct-fields";
import type { WidgetWithExtras } from "../agent-configurator";

// Levering: lets the agent order an Uber Direct delivery — quote, the
// customer's yes, create, then status/tracking — on the widget and the phone.

interface DeliveryTabProps {
  widget: WidgetWithExtras;
}

export function DeliveryTab({ widget }: DeliveryTabProps) {
  const { t } = useTranslation();
  const endpoint = `/api/customer/widgets/${widget.id}/uber-direct`;

  const [summary, setSummary] = useState<UberDirectSummaryView | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [form, setForm] = useState<UberDirectFormState>(EMPTY_UBER_DIRECT);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(endpoint);
    if (!res.ok) return;
    const data = await res.json();
    setSummary(data.uberDirect ?? null);
    setWebhookUrl(data.webhookUrl ?? null);
    setForm(formStateFromSummary(data.uberDirect));
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const payload = uberDirectPayload(form, Boolean(summary?.hasClientSecret));
    if (!payload) {
      setNotice({ kind: "error", text: t("agent.uberDirect.incomplete") });
      return;
    }
    setBusy(true);
    setNotice(null);
    const res = await fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setNotice({ kind: "error", text: data?.error?.message || t("agent.uberDirect.saveError") });
      return;
    }
    setSummary(data.uberDirect);
    setForm({ ...formStateFromSummary(data.uberDirect) });
    setNotice({ kind: "ok", text: t("agent.uberDirect.saved") });
  }

  async function remove() {
    setBusy(true);
    await fetch(endpoint, { method: "DELETE" });
    setBusy(false);
    setSummary(null);
    setForm(EMPTY_UBER_DIRECT);
    setNotice(null);
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">🚚 {t("agent.uberDirect.title")}</h2>
      <p className="mt-1 mb-5 text-sm text-slate-600">{t("agent.uberDirect.intro")}</p>

      <UberDirectFields
        value={form}
        onChange={setForm}
        hasClientSecret={summary?.hasClientSecret}
        hasWebhookSigningKey={summary?.hasWebhookSigningKey}
        webhookUrl={webhookUrl}
      />

      {notice ? (
        <p className={`mt-4 text-sm ${notice.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>{notice.text}</p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-3">
        {form.enabled || summary ? (
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {t("agent.uberDirect.save")}
          </button>
        ) : null}
        {summary ? (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {t("agent.uberDirect.remove")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
