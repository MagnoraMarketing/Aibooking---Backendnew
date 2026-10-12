"use client";

import { useTranslation } from "@/components/i18n/language-provider";

// The Just Eat (JET Go) setup fields for the customer's Levering tab. The
// pickup address asks for the same things as Uber Direct's (and reuses its
// labels), so a business setting up both recognises the form.

export interface JustEatFormState {
  enabled: boolean;
  apiKey: string;
  pickupName: string;
  pickupPhone: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  pickupNotes: string;
}

export const EMPTY_JUST_EAT: JustEatFormState = {
  enabled: false,
  apiKey: "",
  pickupName: "",
  pickupPhone: "",
  street: "",
  postalCode: "",
  city: "",
  country: "DK",
  pickupNotes: "",
};

// What the server's summary looks like (never the API key itself).
export interface JustEatSummaryView {
  enabled: boolean;
  hasApiKey: boolean;
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

export function justEatFormFromSummary(summary: JustEatSummaryView | null | undefined): JustEatFormState {
  if (!summary) return EMPTY_JUST_EAT;
  return {
    ...EMPTY_JUST_EAT,
    enabled: summary.enabled,
    pickupName: summary.pickup?.name ?? "",
    pickupPhone: summary.pickup?.phone ?? "",
    street: summary.pickup?.street ?? "",
    postalCode: summary.pickup?.postalCode ?? "",
    city: summary.pickup?.city ?? "",
    country: summary.pickup?.country ?? "DK",
    pickupNotes: summary.pickup?.notes ?? "",
  };
}

// The request body for the API, or null when the form is incomplete. The
// API key is only sent when typed, so an untouched field keeps the stored one.
export function justEatPayload(state: JustEatFormState, hasStoredKey: boolean): Record<string, unknown> | null {
  const required = [state.pickupName, state.pickupPhone, state.street, state.postalCode, state.city];
  if (required.some((value) => !value.trim())) return null;
  if (!state.apiKey.trim() && !hasStoredKey) return null;
  return {
    enabled: state.enabled,
    ...(state.apiKey.trim() ? { apiKey: state.apiKey.trim() } : {}),
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

interface JustEatFieldsProps {
  value: JustEatFormState;
  onChange: (next: JustEatFormState) => void;
  hasApiKey?: boolean;
  webhookUrl?: string | null;
}

export function JustEatFields({ value, onChange, hasApiKey, webhookUrl }: JustEatFieldsProps) {
  const { t } = useTranslation();
  const set = (key: keyof JustEatFormState) => (e: { target: { value: string } }) =>
    onChange({ ...value, [key]: e.target.value });

  const field = (key: keyof JustEatFormState, labelKey: string, props: Record<string, unknown> = {}) => (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{t(labelKey)}</label>
      <input value={String(value[key])} onChange={set(key)} className={inputClass} {...props} />
    </div>
  );

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
        <input type="checkbox" checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} />
        {t("agent.justEat.enabled")}
      </label>

      {value.enabled ? (
        <>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">{t("agent.uberDirect.credentials")}</p>
            {field("apiKey", "agent.justEat.apiKey", {
              type: "password",
              autoComplete: "off",
              placeholder: hasApiKey ? t("agent.uberDirect.secretStored") : "",
            })}
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
            <div className="mt-3">{field("pickupNotes", "agent.uberDirect.pickupNotes", { maxLength: 275 })}</div>
          </div>

          {webhookUrl ? (
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <p>{t("agent.justEat.webhookHelp")}</p>
              <code className="mt-1 block break-all font-mono text-slate-800">{webhookUrl}</code>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
