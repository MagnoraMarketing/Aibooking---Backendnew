"use client";

import { useMemo, useState } from "react";
import type { Widget } from "@/types/database";
import type { PhoneNumberRow } from "@/app/dashboard/inbound/page";
import type { CampaignRow } from "@/app/dashboard/outbound/page";
// The submodule, not the @/lib/phone-numbers barrel — that one also pulls in
// the server-only service module (Twilio, admin DB client).
import { canPlaceOutboundFrom } from "@/lib/phone-numbers/outbound";
import { useTranslation } from "@/components/i18n/language-provider";

interface OutboundManagerProps {
  widgets: Widget[];
  phoneNumbers: PhoneNumberRow[];
  initialCampaigns: CampaignRow[];
  // Agents that dial through the customer's own Twilio subaccount instead of
  // through Vapi — they can only call from a Twilio number. Resolved on the
  // server, where the llm_models row is (see lib/widgets/provider.ts).
  twilioDirectWidgetIds: string[];
}

// One line per contact: "+4512345678" or "+4512345678, Navn"
function parseContacts(raw: string): { phoneNumber: string; name?: string }[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [phoneNumber, ...rest] = line.split(",").map((part) => part.trim());
      const name = rest.filter(Boolean).join(", ");
      return { phoneNumber: phoneNumber ?? "", name: name || undefined };
    });
}

// Mirrors the campaign's settings columns. Defaults match the database's
// own, so a form that is never touched stores exactly what a campaign
// created before settings existed would have.
interface CampaignSettings {
  agentInstruction: string;
  callWindowStart: string;
  callWindowEnd: string;
  callDays: number[];
  maxConcurrentCalls: number;
  maxAttempts: number;
  retryAfterMinutes: number;
}

const DEFAULT_SETTINGS: CampaignSettings = {
  agentInstruction: "",
  callWindowStart: "09:00",
  callWindowEnd: "17:00",
  callDays: [1, 2, 3, 4, 5],
  maxConcurrentCalls: 3,
  maxAttempts: 1,
  retryAfterMinutes: 60,
};

// Postgres hands a `time` column back as "09:00:00".
function settingsOf(campaign: CampaignRow): CampaignSettings {
  return {
    agentInstruction: campaign.agent_instruction ?? "",
    callWindowStart: String(campaign.call_window_start).slice(0, 5),
    callWindowEnd: String(campaign.call_window_end).slice(0, 5),
    callDays: campaign.call_days ?? [],
    maxConcurrentCalls: campaign.max_concurrent_calls,
    maxAttempts: campaign.max_attempts,
    retryAfterMinutes: campaign.retry_after_minutes,
  };
}

function settingsBody(settings: CampaignSettings) {
  return {
    agentInstruction: settings.agentInstruction.trim() || null,
    callWindowStart: settings.callWindowStart,
    callWindowEnd: settings.callWindowEnd,
    callDays: settings.callDays,
    maxConcurrentCalls: settings.maxConcurrentCalls,
    maxAttempts: settings.maxAttempts,
    retryAfterMinutes: settings.retryAfterMinutes,
  };
}

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function OutboundManager({
  widgets,
  phoneNumbers,
  initialCampaigns,
  twilioDirectWidgetIds,
}: OutboundManagerProps) {
  const { t } = useTranslation();
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [showForm, setShowForm] = useState(initialCampaigns.length === 0);
  const [widgetId, setWidgetId] = useState(widgets[0]?.id ?? "");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [name, setName] = useState("");
  const [contactsRaw, setContactsRaw] = useState("");
  const [creating, setCreating] = useState(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set while editing an existing draft; null while creating a new one. The
  // same form does both, because they are the same fields.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [settings, setSettings] = useState<CampaignSettings>(DEFAULT_SETTINGS);

  // Any of the customer's numbers, not only one bound to this agent: every
  // Vapi number is handed out as that agent's inbound line, so requiring a
  // match left an agent without its own number unable to run a campaign at
  // all. What is still filtered out is a number this agent physically cannot
  // dial from — see lib/phone-numbers/outbound.ts.
  const usableNumbers = useMemo(() => {
    const usesVapi = !twilioDirectWidgetIds.includes(widgetId);
    return phoneNumbers.filter((p) => canPlaceOutboundFrom(p, { usesVapi }));
  }, [phoneNumbers, widgetId, twilioDirectWidgetIds]);

  function widgetName(id: string): string {
    return widgets.find((w) => w.id === id)?.name ?? t("dashboardPages.shared.unknownAgent");
  }

  function phoneNumberLabel(id: string): string {
    const phoneNumber = phoneNumbers.find((p) => p.id === id);
    return phoneNumber ? phoneNumber.label || phoneNumber.phone_number : t("dashboardPages.outbound.unknownNumber");
  }

  async function handleCreate() {
    const contacts = parseContacts(contactsRaw);
    if (!name.trim()) {
      setError(t("dashboardPages.outbound.errorCampaignName"));
      return;
    }
    if (!phoneNumberId) {
      setError(t("dashboardPages.outbound.errorChooseNumber"));
      return;
    }
    if (contacts.length === 0) {
      setError(t("dashboardPages.outbound.errorAtLeastOneContact"));
      return;
    }
    if (contacts.length > 100) {
      setError(t("dashboardPages.outbound.errorMaxContacts"));
      return;
    }

    if (settings.callDays.length === 0) {
      setError(t("dashboardPages.outbound.errorNoCallDays"));
      return;
    }
    if (settings.callWindowStart >= settings.callWindowEnd) {
      setError(t("dashboardPages.outbound.errorWindowOrder"));
      return;
    }

    setCreating(true);
    setError(null);

    const body = { widgetId, phoneNumberId, name: name.trim(), contacts, ...settingsBody(settings) };
    const res = await fetch(
      editingId ? `/api/customer/outbound-campaigns/${editingId}` : "/api/customer/outbound-campaigns",
      {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    setCreating(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("dashboardPages.outbound.errorCreate"));
      return;
    }

    const { campaign } = await res.json();
    const row = { ...campaign, outbound_campaign_contacts: [{ count: contacts.length }] };
    setCampaigns((prev) => (editingId ? prev.map((c) => (c.id === editingId ? row : c)) : [row, ...prev]));
    closeForm();
  }

  function closeForm() {
    setEditingId(null);
    setName("");
    setContactsRaw("");
    setSettings(DEFAULT_SETTINGS);
    setShowForm(false);
    setError(null);
  }

  // Opens the form on an existing draft. The contact list is not in the page
  // payload — a hundred numbers per campaign is not something to ship to the
  // browser until someone opens one — so it is fetched here.
  async function startEditing(campaign: CampaignRow) {
    setError(null);
    setNotice(null);
    setEditingId(campaign.id);
    setName(campaign.name);
    setWidgetId(campaign.widget_id);
    setPhoneNumberId(campaign.phone_number_id);
    setSettings(settingsOf(campaign));
    setContactsRaw("");
    setShowForm(true);

    const res = await fetch(`/api/customer/outbound-campaigns/${campaign.id}`);
    if (!res.ok) {
      setError(t("dashboardPages.outbound.errorLoadCampaign"));
      return;
    }
    const data = (await res.json()) as { contacts: { phone_number: string; contact_name: string | null }[] };
    setContactsRaw(
      data.contacts
        .map((contact) => (contact.contact_name ? `${contact.phone_number}, ${contact.contact_name}` : contact.phone_number))
        .join("\n")
    );
  }

  async function handleDelete(campaignId: string) {
    setError(null);
    const res = await fetch(`/api/customer/outbound-campaigns/${campaignId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("dashboardPages.outbound.errorDelete"));
      return;
    }
    setCampaigns((prev) => prev.filter((c) => c.id !== campaignId));
    if (editingId === campaignId) closeForm();
  }

  async function handleLaunch(campaignId: string) {
    setLaunchingId(campaignId);
    setError(null);

    const res = await fetch(`/api/customer/outbound-campaigns/${campaignId}/launch`, { method: "POST" });

    setLaunchingId(null);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("dashboardPages.outbound.errorLaunch"));
      return;
    }

    setCampaigns((prev) =>
      prev.map((c) => (c.id === campaignId ? { ...c, status: "launched", launched_at: new Date().toISOString() } : c))
    );

    // A queued campaign looks exactly like one that did nothing, so say when
    // the first call goes out — especially when that is tomorrow morning
    // because the campaign was launched outside its own hours.
    const result = (await res.json().catch(() => null)) as
      | { queued?: number; startsAt?: string; startsNow?: boolean }
      | null;
    if (result?.startsNow) {
      setNotice(t("dashboardPages.outbound.queuedNow", { count: result.queued ?? 0 }));
    } else if (result?.startsAt) {
      setNotice(
        t("dashboardPages.outbound.queuedLater", {
          count: result.queued ?? 0,
          time: new Date(result.startsAt).toLocaleString("da-DK", {
            weekday: "long",
            hour: "2-digit",
            minute: "2-digit",
          }),
        })
      );
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t("dashboardPages.outbound.title")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("dashboardPages.outbound.subtitle")}</p>
        </div>
        {!showForm ? (
          <button
            type="button"
            onClick={() => {
              closeForm();
              setShowForm(true);
            }}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {t("dashboardPages.outbound.newCampaign")}
          </button>
        ) : null}
      </div>

      {phoneNumbers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          {t("dashboardPages.outbound.noNumbersYet")}
        </div>
      ) : showForm ? (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <label htmlFor="campaign-name" className="mb-1 block text-sm font-medium text-slate-700">
              {t("dashboardPages.outbound.campaignNameLabel")}
            </label>
            <input
              id="campaign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("dashboardPages.outbound.campaignNamePlaceholder")}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="campaign-widget" className="mb-1 block text-sm font-medium text-slate-700">
                {t("dashboardPages.shared.agentLabel")}
              </label>
              <select
                id="campaign-widget"
                value={widgetId}
                onChange={(e) => setWidgetId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              >
                {widgets.map((widget) => (
                  <option key={widget.id} value={widget.id}>
                    {widget.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="campaign-phone" className="mb-1 block text-sm font-medium text-slate-700">
                {t("dashboardPages.outbound.callFromLabel")}
              </label>
              <select
                id="campaign-phone"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              >
                <option value="">{t("dashboardPages.outbound.chooseNumberPlaceholder")}</option>
                {usableNumbers.map((phoneNumber) => (
                  <option key={phoneNumber.id} value={phoneNumber.id}>
                    {phoneNumber.label
                      ? `${phoneNumber.label} · ${phoneNumber.phone_number}`
                      : phoneNumber.phone_number}
                    {phoneNumber.widget_id ? ` (${widgetName(phoneNumber.widget_id)})` : ""}
                  </option>
                ))}
              </select>
              {usableNumbers.length === 0 ? (
                <p className="mt-1 text-xs text-amber-600">{t("dashboardPages.outbound.noUsableNumber")}</p>
              ) : (
                <p className="mt-1 text-xs text-slate-500">{t("dashboardPages.outbound.numberIsWhatTheySee")}</p>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="campaign-contacts" className="mb-1 block text-sm font-medium text-slate-700">
              {t("dashboardPages.outbound.contactsLabel")}
            </label>
            <textarea
              id="campaign-contacts"
              rows={8}
              value={contactsRaw}
              onChange={(e) => setContactsRaw(e.target.value)}
              placeholder={"+4512345678\n+4587654321, Jens Jensen"}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* The settings. Defaults are deliberately conservative — weekdays
              09–17, three at a time, one attempt — because every one of them
              decides when somebody's phone rings. */}
          <div className="space-y-4 rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-900">{t("dashboardPages.outbound.settingsHeading")}</h3>

            <div>
              <label htmlFor="campaign-instruction" className="mb-1 block text-sm font-medium text-slate-700">
                {t("dashboardPages.outbound.agentInstructionLabel")}
              </label>
              <textarea
                id="campaign-instruction"
                rows={3}
                value={settings.agentInstruction}
                onChange={(e) => setSettings((prev) => ({ ...prev, agentInstruction: e.target.value }))}
                placeholder={t("dashboardPages.outbound.agentInstructionPlaceholder")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
              <p className="mt-1 text-xs text-slate-500">{t("dashboardPages.outbound.agentInstructionHelp")}</p>
            </div>

            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">
                {t("dashboardPages.outbound.callDaysLabel")}
              </span>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_KEYS.map((key, index) => {
                  const day = index + 1;
                  const selected = settings.callDays.includes(day);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        setSettings((prev) => ({
                          ...prev,
                          callDays: selected
                            ? prev.callDays.filter((d) => d !== day)
                            : [...prev.callDays, day].sort((a, b) => a - b),
                        }))
                      }
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        selected
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-slate-300 text-slate-600 hover:border-slate-400"
                      }`}
                    >
                      {t(`dashboardPages.outbound.weekday.${key}`)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="campaign-window-start" className="mb-1 block text-sm font-medium text-slate-700">
                  {t("dashboardPages.outbound.callWindowStartLabel")}
                </label>
                <input
                  id="campaign-window-start"
                  type="time"
                  value={settings.callWindowStart}
                  onChange={(e) => setSettings((prev) => ({ ...prev, callWindowStart: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label htmlFor="campaign-window-end" className="mb-1 block text-sm font-medium text-slate-700">
                  {t("dashboardPages.outbound.callWindowEndLabel")}
                </label>
                <input
                  id="campaign-window-end"
                  type="time"
                  value={settings.callWindowEnd}
                  onChange={(e) => setSettings((prev) => ({ ...prev, callWindowEnd: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="campaign-concurrency" className="mb-1 block text-sm font-medium text-slate-700">
                  {t("dashboardPages.outbound.concurrencyLabel")}
                </label>
                <input
                  id="campaign-concurrency"
                  type="number"
                  min={1}
                  max={10}
                  value={settings.maxConcurrentCalls}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, maxConcurrentCalls: Number(e.target.value) || 1 }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label htmlFor="campaign-attempts" className="mb-1 block text-sm font-medium text-slate-700">
                  {t("dashboardPages.outbound.maxAttemptsLabel")}
                </label>
                <input
                  id="campaign-attempts"
                  type="number"
                  min={1}
                  max={5}
                  value={settings.maxAttempts}
                  onChange={(e) => setSettings((prev) => ({ ...prev, maxAttempts: Number(e.target.value) || 1 }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label htmlFor="campaign-retry" className="mb-1 block text-sm font-medium text-slate-700">
                  {t("dashboardPages.outbound.retryAfterLabel")}
                </label>
                <input
                  id="campaign-retry"
                  type="number"
                  min={5}
                  max={1440}
                  step={5}
                  value={settings.retryAfterMinutes}
                  disabled={settings.maxAttempts <= 1}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, retryAfterMinutes: Number(e.target.value) || 60 }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
            </div>
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {creating
                  ? t("dashboardPages.outbound.creating")
                  : editingId
                    ? t("dashboardPages.outbound.saveCampaign")
                    : t("dashboardPages.outbound.createCampaign")}
              </button>
              <button
                type="button"
                onClick={closeForm}
                disabled={creating}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error && !showForm ? <p className="text-sm text-red-600">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">{t("dashboardPages.outbound.campaignsHeading")}</h2>
        {campaigns.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            {t("dashboardPages.outbound.noCampaignsYet")}
          </div>
        ) : (
          <ul className="space-y-3">
            {campaigns.map((campaign) => (
              <li
                key={campaign.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-800">{campaign.name}</p>
                  <p className="text-xs text-slate-500">
                    {widgetName(campaign.widget_id)} · {phoneNumberLabel(campaign.phone_number_id)} ·{" "}
                    {t("dashboardPages.outbound.contactsCount", {
                      count: campaign.outbound_campaign_contacts?.[0]?.count ?? 0,
                    })}
                  </p>
                </div>
                {campaign.status === "draft" ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void startEditing(campaign)}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {t("common.edit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(campaign.id)}
                      className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                    >
                      {t("common.delete")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLaunch(campaign.id)}
                      disabled={launchingId === campaign.id}
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                    >
                      {launchingId === campaign.id
                        ? t("dashboardPages.outbound.launching")
                        : t("dashboardPages.outbound.launchCampaign")}
                    </button>
                  </div>
                ) : (
                  <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                    {t("dashboardPages.outbound.launched")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
