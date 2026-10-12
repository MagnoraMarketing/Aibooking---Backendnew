"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "@/components/i18n/language-provider";
import {
  UberDirectFields,
  formStateFromSummary,
  uberDirectPayload,
  EMPTY_UBER_DIRECT,
  type UberDirectFormState,
  type UberDirectSummaryView,
} from "@/components/uber-direct/uber-direct-fields";
import {
  JustEatFields,
  justEatFormFromSummary,
  justEatPayload,
  EMPTY_JUST_EAT,
  type JustEatFormState,
  type JustEatSummaryView,
} from "@/components/just-eat/just-eat-fields";
import type { WidgetWithExtras } from "../agent-configurator";

// Levering: the delivery services the agent may order — Uber Direct and Just
// Eat (JET Go), each with its own account — on the widget and the phone. Both
// follow the same flow: price first, the customer's yes, then the order.

interface DeliveryTabProps {
  widget: WidgetWithExtras;
}

type Notice = { kind: "ok" | "error"; text: string } | null;

function ProviderCard({
  title,
  intro,
  badge,
  connected,
  children,
}: {
  title: string;
  intro: string;
  badge?: string;
  connected: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          {connected ? t("agent.delivery.statusActive") : t("agent.delivery.statusOff")}
        </span>
        {badge ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{badge}</span> : null}
      </div>
      <p className="mt-1 mb-5 text-sm text-slate-600">{intro}</p>
      {children}
    </section>
  );
}

function Actions({
  show,
  canRemove,
  busy,
  onSave,
  onRemove,
  notice,
}: {
  show: boolean;
  canRemove: boolean;
  busy: boolean;
  onSave: () => void;
  onRemove: () => void;
  notice: Notice;
}) {
  const { t } = useTranslation();
  return (
    <>
      {notice ? (
        <p className={`mt-4 text-sm ${notice.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>{notice.text}</p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-3">
        {show ? (
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {t("agent.uberDirect.save")}
          </button>
        ) : null}
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {t("agent.uberDirect.remove")}
          </button>
        ) : null}
      </div>
    </>
  );
}

function UberDirectCard({ widgetId }: { widgetId: string }) {
  const { t } = useTranslation();
  const endpoint = `/api/customer/widgets/${widgetId}/uber-direct`;
  const [summary, setSummary] = useState<UberDirectSummaryView | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [form, setForm] = useState<UberDirectFormState>(EMPTY_UBER_DIRECT);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

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
    const res = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
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
    <ProviderCard title={t("agent.uberDirect.title")} intro={t("agent.uberDirect.intro")} connected={Boolean(summary?.enabled)}>
      <UberDirectFields
        value={form}
        onChange={setForm}
        hasClientSecret={summary?.hasClientSecret}
        hasWebhookSigningKey={summary?.hasWebhookSigningKey}
        webhookUrl={webhookUrl}
      />
      <Actions show={form.enabled || Boolean(summary)} canRemove={Boolean(summary)} busy={busy} onSave={save} onRemove={remove} notice={notice} />
    </ProviderCard>
  );
}

function JustEatCard({ widgetId }: { widgetId: string }) {
  const { t } = useTranslation();
  const endpoint = `/api/customer/widgets/${widgetId}/just-eat`;
  const [summary, setSummary] = useState<JustEatSummaryView | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [form, setForm] = useState<JustEatFormState>(EMPTY_JUST_EAT);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    const res = await fetch(endpoint);
    if (!res.ok) return;
    const data = await res.json();
    setSummary(data.justEat ?? null);
    setWebhookUrl(data.webhookUrl ?? null);
    setForm(justEatFormFromSummary(data.justEat));
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const payload = justEatPayload(form, Boolean(summary?.hasApiKey));
    if (!payload) {
      setNotice({ kind: "error", text: t("agent.justEat.incomplete") });
      return;
    }
    setBusy(true);
    setNotice(null);
    const res = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setNotice({ kind: "error", text: data?.error?.message || t("agent.uberDirect.saveError") });
      return;
    }
    setSummary(data.justEat);
    setWebhookUrl(data.webhookUrl ?? null);
    setForm({ ...justEatFormFromSummary(data.justEat) });
    setNotice({ kind: "ok", text: t("agent.uberDirect.saved") });
  }

  async function remove() {
    setBusy(true);
    await fetch(endpoint, { method: "DELETE" });
    setBusy(false);
    setSummary(null);
    setWebhookUrl(null);
    setForm(EMPTY_JUST_EAT);
    setNotice(null);
  }

  return (
    <ProviderCard
      title={t("agent.justEat.title")}
      intro={t("agent.justEat.intro")}
      badge={t("agent.justEat.partnerBadge")}
      connected={Boolean(summary?.enabled)}
    >
      <JustEatFields value={form} onChange={setForm} hasApiKey={summary?.hasApiKey} webhookUrl={webhookUrl} />
      <p className="mt-4 text-xs text-slate-500">{t("agent.justEat.partnerHelp")}</p>
      <Actions show={form.enabled || Boolean(summary)} canRemove={Boolean(summary)} busy={busy} onSave={save} onRemove={remove} notice={notice} />
    </ProviderCard>
  );
}

export function DeliveryTab({ widget }: DeliveryTabProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">🚚 {t("agent.delivery.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("agent.delivery.intro")}</p>
      </div>
      <UberDirectCard widgetId={widget.id} />
      <JustEatCard widgetId={widget.id} />
    </div>
  );
}
