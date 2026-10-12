"use client";

import { useTranslation } from "@/components/i18n/language-provider";

// The Uber Direct setup fields, shared by the admin agent form and the
// customer's Levering tab so both ask for exactly the same things.

export interface UberDirectFormState {
  enabled: boolean;
  customerId: string;
  clientId: string;
  clientSecret: string;
  webhookSigningKey: string;
  pickupName: string;
  pickupPhone: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  pickupNotes: string;
}

export const EMPTY_UBER_DIRECT: UberDirectFormState = {
  enabled: false,
  customerId: "",
  clientId: "",
  clientSecret: "",
  webhookSigningKey: "",
  pickupName: "",
  pickupPhone: "",
  street: "",
  postalCode: "",
  city: "",
  country: "DK",
  pickupNotes: "",
};

// What the server's summary looks like (never any secret values).
export interface UberDirectSummaryView {
  enabled: boolean;
  customerId: string | null;
  clientId: string | null;
  hasClientSecret: boolean;
  hasWebhookSigningKey: boolean;
  pickup: {
    name?: string;
    phone?: string;
    street?: string;
    postalCode?: string;
    city?: string;
    country?: string;
    notes?: string;
  } | null;
}

export function formStateFromSummary(summary: UberDirectSummaryView | null | undefined): UberDirectFormState {
  if (!summary) return EMPTY_UBER_DIRECT;
  return {
    ...EMPTY_UBER_DIRECT,
    enabled: summary.enabled,
    customerId: summary.customerId ?? "",
    clientId: summary.clientId ?? "",
    pickupName: summary.pickup?.name ?? "",
    pickupPhone: summary.pickup?.phone ?? "",
    street: summary.pickup?.street ?? "",
    postalCode: summary.pickup?.postalCode ?? "",
    city: summary.pickup?.city ?? "",
    country: summary.pickup?.country ?? "DK",
    pickupNotes: summary.pickup?.notes ?? "",
  };
}

// The request body for the API, or null when the form is incomplete.
// Secrets are only sent when typed, so an untouched field keeps the stored one.
export function uberDirectPayload(state: UberDirectFormState, hasStoredSecret: boolean): Record<string, unknown> | null {
  const required = [state.customerId, state.clientId, state.pickupName, state.pickupPhone, state.street, state.postalCode, state.city];
  if (required.some((value) => !value.trim())) return null;
  if (!state.clientSecret.trim() && !hasStoredSecret) return null;
  return {
    enabled: state.enabled,
    customerId: state.customerId.trim(),
    clientId: state.clientId.trim(),
    ...(state.clientSecret.trim() ? { clientSecret: state.clientSecret.trim() } : {}),
    ...(state.webhookSigningKey.trim() ? { webhookSigningKey: state.webhookSigningKey.trim() } : {}),
    pickup: {
      name: state.pickupName.trim(),
      phone: state.pickupPhone.replace(/\s+/g, ""),
      street: state.street.trim(),
      postalCode: state.postalCode.trim(),
      city: state.city.trim(),
      country: (state.country.trim() || "DK").toUpperCase(),
      ...(state.pickupNotes.trim() ? { notes: state.pickupNotes.trim() } : {}),
    },
  };
}

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500";

interface UberDirectFieldsProps {
  value: UberDirectFormState;
  onChange: (next: UberDirectFormState) => void;
  hasClientSecret?: boolean;
  hasWebhookSigningKey?: boolean;
  webhookUrl?: string | null;
}

export function UberDirectFields({ value, onChange, hasClientSecret, hasWebhookSigningKey, webhookUrl }: UberDirectFieldsProps) {
  const { t } = useTranslation();
  const set = (key: keyof UberDirectFormState) => (e: { target: { value: string } }) =>
    onChange({ ...value, [key]: e.target.value });

  const field = (key: keyof UberDirectFormState, labelKey: string, props: Record<string, unknown> = {}) => (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{t(labelKey)}</label>
      <input value={String(value[key])} onChange={set(key)} className={inputClass} {...props} />
    </div>
  );

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
        <input type="checkbox" checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} />
        {t("agent.uberDirect.enabled")}
      </label>

      {value.enabled ? (
        <>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">{t("agent.uberDirect.credentials")}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {field("customerId", "agent.uberDirect.customerId", { autoComplete: "off" })}
              {field("clientId", "agent.uberDirect.clientId", { autoComplete: "off" })}
              {field("clientSecret", "agent.uberDirect.clientSecret", {
                type: "password",
                autoComplete: "off",
                placeholder: hasClientSecret ? t("agent.uberDirect.secretStored") : "",
              })}
              {field("webhookSigningKey", "agent.uberDirect.webhookSigningKey", {
                type: "password",
                autoComplete: "off",
                placeholder: hasWebhookSigningKey ? t("agent.uberDirect.secretStored") : "",
              })}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">{t("agent.uberDirect.pickup")}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {field("pickupName", "agent.uberDirect.pickupName")}
              {field("pickupPhone", "agent.uberDirect.pickupPhone", { inputMode: "tel", placeholder: "+4512345678" })}
              {field("street", "agent.uberDirect.street")}
              <div className="grid grid-cols-3 gap-2">
                {field("postalCode", "agent.uberDirect.postalCode")}
                {field("city", "agent.uberDirect.city")}
                {field("country", "agent.uberDirect.country", { maxLength: 2 })}
              </div>
            </div>
            <div className="mt-3">{field("pickupNotes", "agent.uberDirect.pickupNotes")}</div>
          </div>

          {webhookUrl ? (
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <p>{t("agent.uberDirect.webhookHelp")}</p>
              <code className="mt-1 block break-all font-mono text-slate-800">{webhookUrl}</code>
            </div>
          ) : null}

          <p className="text-xs text-slate-500">{t("agent.uberDirect.availability")}</p>
        </>
      ) : null}
    </div>
  );
}
