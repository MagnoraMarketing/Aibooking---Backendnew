"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Widget } from "@/types/database";
import type { PhoneNumberRow } from "@/app/dashboard/inbound/page";
import type { CampaignRow } from "@/app/dashboard/outbound/page";
import type { CampaignStats } from "@/lib/outbound/stats";
// The submodule, not the @/lib/phone-numbers barrel — that one also pulls in
// the server-only service module (Twilio, admin DB client).
import { canPlaceOutboundFrom } from "@/lib/phone-numbers/outbound";
import { canChangeAgentOrNumber, canReplaceAllContacts } from "@/lib/outbound/status";
import { CampaignActions, CampaignStatusBadge } from "./outbound-campaign-actions";
import { OutboundCampaignDetail } from "./outbound-campaign-detail";
import { useTranslation } from "@/components/i18n/language-provider";

interface OutboundManagerProps {
  widgets: Widget[];
  phoneNumbers: PhoneNumberRow[];
  initialCampaigns: CampaignRow[];
  // Agents that dial through the customer's own Twilio subaccount instead of
  // through Vapi — they can only call from a Twilio number. Resolved on the
  // server, where the llm_models row is (see lib/widgets/provider.ts).
  twilioDirectWidgetIds: string[];
  // The dialer's lead lists, so a campaign can take its contacts (with every
  // extra CSV column as an agent variable) from one of them.
  leadLists: { id: string; name: string; count: number }[];
}

// How often the overview re-reads itself while a campaign is being dialled.
// The server's answer replaces the list rather than being merged into it, so
// a result cannot be counted twice or land half-applied.
const POLL_MS = 15_000;

// One line per contact: "+4512345678", "+4512345678, Navn" or
// "+4512345678, Navn, Virksomhed".
function parseContacts(raw: string): { phoneNumber: string; name?: string; company?: string }[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [phoneNumber, name, ...rest] = line.split(",").map((part) => part.trim());
      const company = rest.filter(Boolean).join(", ");
      return {
        phoneNumber: phoneNumber ?? "",
        name: name || undefined,
        company: company || undefined,
      };
    });
}

// The same list back as text, so what the edit form shows is what was saved.
function contactsToText(
  contacts: { phone_number: string; contact_name: string | null; company: string | null }[]
): string {
  return contacts
    .map((contact) => {
      if (contact.company) return `${contact.phone_number}, ${contact.contact_name ?? ""}, ${contact.company}`;
      if (contact.contact_name) return `${contact.phone_number}, ${contact.contact_name}`;
      return contact.phone_number;
    })
    .join("\n");
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
  voicemailMessage: string;
}

const DEFAULT_SETTINGS: CampaignSettings = {
  agentInstruction: "",
  callWindowStart: "09:00",
  callWindowEnd: "17:00",
  callDays: [1, 2, 3, 4, 5],
  maxConcurrentCalls: 3,
  maxAttempts: 1,
  retryAfterMinutes: 60,
  voicemailMessage: "",
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
    voicemailMessage: campaign.voicemail_message ?? "",
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
    voicemailMessage: settings.voicemailMessage.trim() || null,
  };
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("da-DK", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function OutboundManager({
  widgets,
  phoneNumbers,
  initialCampaigns,
  twilioDirectWidgetIds,
  leadLists,
}: OutboundManagerProps) {
  const { t } = useTranslation();
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [showForm, setShowForm] = useState(initialCampaigns.length === 0);
  const [widgetId, setWidgetId] = useState(widgets[0]?.id ?? "");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [name, setName] = useState("");
  const [contactsRaw, setContactsRaw] = useState("");
  // Where a new campaign's contacts come from: pasted lines, or a lead list.
  const [contactSource, setContactSource] = useState<"paste" | "list">("paste");
  const [leadListId, setLeadListId] = useState(leadLists[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set while editing an existing campaign; null while creating a new one.
  // The same form does both, because they are the same fields.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [settings, setSettings] = useState<CampaignSettings>(DEFAULT_SETTINGS);
  // Which campaign's contacts are open. The overview is the list of
  // campaigns; this is the one campaign, person by person.
  const [openCampaignId, setOpenCampaignId] = useState<string | null>(null);

  const editingCampaign = editingId ? campaigns.find((campaign) => campaign.id === editingId) ?? null : null;
  const openCampaign = openCampaignId ? campaigns.find((campaign) => campaign.id === openCampaignId) ?? null : null;

  // Agent and number decide what a call IS, so they are only editable while
  // nothing is being dialled — see lib/outbound/status.ts.
  const agentAndNumberEditable = !editingCampaign || canChangeAgentOrNumber(editingCampaign.status);
  const contactsReplaceable = !editingCampaign || canReplaceAllContacts(editingCampaign.status);

  // Any of the customer's numbers, not only one bound to this agent: every
  // Vapi number is handed out as that agent's inbound line, so requiring a
  // match left an agent without its own number unable to run a campaign at
  // all. What is still filtered out is a number this agent physically cannot
  // dial from — see lib/phone-numbers/outbound.ts.
  const usableNumbers = useMemo(() => {
    const usesVapi = !twilioDirectWidgetIds.includes(widgetId);
    return phoneNumbers.filter((p) => canPlaceOutboundFrom(p, { usesVapi }));
  }, [phoneNumbers, widgetId, twilioDirectWidgetIds]);

  // The server's answer, whole. Every number on this page is derived from the
  // contacts and the calls themselves, so re-reading can only ever bring it
  // closer to the truth — never duplicate a result or overwrite one.
  const refresh = useCallback(async () => {
    const res = await fetch("/api/customer/outbound-campaigns");
    if (!res.ok) return;
    const data = (await res.json()) as { campaigns: CampaignRow[] };
    setCampaigns(data.campaigns);
  }, []);

  // Only while something can still change: a campaign being dialled, or one
  // paused with a call still on the line. A finished campaign's numbers are
  // final, and asking again would be asking a settled question.
  const anythingLive = campaigns.some(
    (campaign) => campaign.status === "running" || campaign.status === "paused"
  );
  useEffect(() => {
    if (!anythingLive) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [anythingLive, refresh]);

  const applyStats = useCallback((campaignId: string, stats: CampaignStats) => {
    setCampaigns((prev) => prev.map((campaign) => (campaign.id === campaignId ? { ...campaign, stats } : campaign)));
  }, []);

  function widgetName(id: string): string {
    return widgets.find((w) => w.id === id)?.name ?? t("dashboardPages.shared.unknownAgent");
  }

  function phoneNumberLabel(id: string): string {
    const phoneNumber = phoneNumbers.find((p) => p.id === id);
    return phoneNumber ? phoneNumber.label || phoneNumber.phone_number : t("dashboardPages.outbound.unknownNumber");
  }

  async function handleCreate() {
    const fromList = !editingId && contactSource === "list";
    const contacts = parseContacts(contactsRaw);
    if (!name.trim()) {
      setError(t("dashboardPages.outbound.errorCampaignName"));
      return;
    }
    if (!phoneNumberId) {
      setError(t("dashboardPages.outbound.errorChooseNumber"));
      return;
    }
    if (fromList && !leadListId) {
      setError(t("dashboardPages.outbound.errorChooseLeadList"));
      return;
    }
    if (!fromList && contacts.length === 0) {
      setError(t("dashboardPages.outbound.errorAtLeastOneContact"));
      return;
    }
    if (!fromList && contacts.length > 100) {
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

    // Agent and number are left out of an edit that may not move them, so
    // the request says only what it is allowed to change.
    const body = {
      ...(agentAndNumberEditable ? { widgetId, phoneNumberId } : {}),
      name: name.trim(),
      ...(fromList ? { leadListId } : { contacts }),
      ...settingsBody(settings),
    };
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

    // What the edit actually did to the list — a contact already called is
    // kept, and saying so beats a list on screen that is not the list saved.
    const result = (await res.json().catch(() => null)) as {
      contacts?: { keptBecauseCalled?: number } | null;
    } | null;
    const kept = result?.contacts?.keptBecauseCalled ?? 0;
    setNotice(kept > 0 ? t("dashboardPages.outbound.keptCalledContacts", { count: kept }) : null);

    closeForm();
    await refresh();
  }

  function closeForm() {
    setEditingId(null);
    setName("");
    setContactsRaw("");
    setSettings(DEFAULT_SETTINGS);
    setShowForm(false);
    setError(null);
  }

  // Opens the form on an existing campaign. The contact list is not in the
  // page payload — a hundred numbers per campaign is not something to ship
  // to the browser until someone opens one — so it is fetched here.
  async function startEditing(campaign: CampaignRow) {
    setError(null);
    setNotice(null);
    setOpenCampaignId(null);
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
    const data = (await res.json()) as {
      contacts: { phone_number: string; contact_name: string | null; company: string | null }[];
    };
    setContactsRaw(contactsToText(data.contacts));
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
    if (openCampaignId === campaignId) setOpenCampaignId(null);
  }

  async function handleLaunch(campaignId: string) {
    setBusyId(campaignId);
    setError(null);

    const res = await fetch(`/api/customer/outbound-campaigns/${campaignId}/launch`, { method: "POST" });

    setBusyId(null);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("dashboardPages.outbound.errorLaunch"));
      return;
    }

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

    await refresh();
  }

  // Pausing stops new calls from starting. A call already on the line is
  // left alone — see the campaign's status route.
  async function handleStatus(campaignId: string, action: "pause" | "resume" | "stop") {
    if (action === "stop" && !window.confirm(t("dashboardPages.outbound.stopConfirm"))) return;
    setBusyId(campaignId);
    setError(null);

    const res = await fetch(`/api/customer/outbound-campaigns/${campaignId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });

    setBusyId(null);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("dashboardPages.outbound.errorStatusChange"));
      return;
    }

    setNotice(
      action === "pause"
        ? t("dashboardPages.outbound.pausedNotice")
        : action === "stop"
          ? t("dashboardPages.outbound.stoppedNotice")
          : t("dashboardPages.outbound.resumedNotice")
    );
    await refresh();
  }

  // Exactly one real call, before the campaign goes out to everyone.
  async function handleTest(campaignId: string) {
    setBusyId(campaignId);
    setError(null);
    const res = await fetch(`/api/customer/outbound-campaigns/${campaignId}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("dashboardPages.outbound.errorStatusChange"));
      return;
    }
    const data = (await res.json()) as { phoneNumber: string };
    setNotice(t("dashboardPages.outbound.testCallStarted", { number: data.phoneNumber }));
    await refresh();
  }

  function actionsFor(campaign: CampaignRow) {
    return (
      <CampaignActions
        campaign={campaign}
        busy={busyId === campaign.id}
        onLaunch={() => void handleLaunch(campaign.id)}
        onPause={() => void handleStatus(campaign.id, "pause")}
        onResume={() => void handleStatus(campaign.id, "resume")}
        onEdit={() => void startEditing(campaign)}
        onDelete={() => void handleDelete(campaign.id)}
        onStop={() => void handleStatus(campaign.id, "stop")}
        onTest={() => void handleTest(campaign.id)}
      />
    );
  }

  // One campaign, contact by contact. Shown instead of the overview rather
  // than below it: it is the same question asked at a finer grain.
  if (openCampaign) {
    return (
      <>
        {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}
        {notice ? <p className="mb-4 text-sm text-emerald-700">{notice}</p> : null}
        <OutboundCampaignDetail
          campaign={openCampaign}
          agentName={widgetName(openCampaign.widget_id)}
          phoneNumberLabel={phoneNumberLabel(openCampaign.phone_number_id)}
          actions={actionsFor(openCampaign)}
          onBack={() => setOpenCampaignId(null)}
          onStats={applyStats}
        />
      </>
    );
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
          {editingCampaign && !contactsReplaceable ? (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {t("dashboardPages.outbound.editRunningHint")}
            </p>
          ) : null}

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
                disabled={!agentAndNumberEditable}
                onChange={(e) => setWidgetId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-400"
              >
                {widgets.map((widget) => (
                  <option key={widget.id} value={widget.id}>
                    {widget.name}
                  </option>
                ))}
              </select>
              {!agentAndNumberEditable ? (
                <p className="mt-1 text-xs text-slate-500">{t("dashboardPages.outbound.agentNumberLockedHint")}</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="campaign-phone" className="mb-1 block text-sm font-medium text-slate-700">
                {t("dashboardPages.outbound.callFromLabel")}
              </label>
              <select
                id="campaign-phone"
                value={phoneNumberId}
                disabled={!agentAndNumberEditable}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-400"
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

          {!editingId && leadLists.length > 0 ? (
            <div className="flex gap-2">
              {(["paste", "list"] as const).map((source) => (
                <button
                  key={source}
                  type="button"
                  onClick={() => setContactSource(source)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    contactSource === source ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {t(source === "paste" ? "dashboardPages.outbound.sourcePaste" : "dashboardPages.outbound.sourceLeadList")}
                </button>
              ))}
            </div>
          ) : null}

          {!editingId && contactSource === "list" && leadLists.length > 0 ? (
            <div>
              <label htmlFor="campaign-lead-list" className="mb-1 block text-sm font-medium text-slate-700">
                {t("dashboardPages.outbound.leadListLabel")}
              </label>
              <select
                id="campaign-lead-list"
                value={leadListId}
                onChange={(e) => setLeadListId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              >
                {leadLists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name} ({list.count})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">{t("dashboardPages.outbound.leadListHelp")}</p>
            </div>
          ) : (
          <div>
            <label htmlFor="campaign-contacts" className="mb-1 block text-sm font-medium text-slate-700">
              {t("dashboardPages.outbound.contactsLabel")}
            </label>
            <textarea
              id="campaign-contacts"
              rows={8}
              value={contactsRaw}
              onChange={(e) => setContactsRaw(e.target.value)}
              placeholder={"+4512345678\n+4587654321, Jens Jensen\n+4511223344, Mette Hansen, Frisørstuen"}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
            <p className="mt-1 text-xs text-slate-500">{t("dashboardPages.outbound.contactsHelp")}</p>
          </div>
          )}

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
              <p className="mt-1 text-xs text-slate-500">{t("dashboardPages.outbound.variablesHelp")}</p>
            </div>

            <div>
              <label htmlFor="campaign-voicemail" className="mb-1 block text-sm font-medium text-slate-700">
                {t("dashboardPages.outbound.voicemailLabel")}
              </label>
              <textarea
                id="campaign-voicemail"
                rows={2}
                value={settings.voicemailMessage}
                onChange={(e) => setSettings((prev) => ({ ...prev, voicemailMessage: e.target.value }))}
                placeholder={t("dashboardPages.outbound.voicemailPlaceholder")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
              <p className="mt-1 text-xs text-slate-500">{t("dashboardPages.outbound.voicemailHelp")}</p>
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
          /* The same shape Inbound's list has: one row per campaign, with what
             it amounts to — and a click through to who was actually called. */
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">{t("dashboardPages.outbound.colCampaign")}</th>
                  <th className="px-4 py-3">{t("dashboardPages.outbound.colStatus")}</th>
                  <th className="px-4 py-3 text-right">{t("dashboardPages.outbound.colTotal")}</th>
                  <th className="px-4 py-3 text-right">{t("dashboardPages.outbound.colCalled")}</th>
                  <th className="px-4 py-3 text-right">{t("dashboardPages.outbound.colPending")}</th>
                  <th className="px-4 py-3 text-right">{t("dashboardPages.outbound.colSuccessful")}</th>
                  <th className="px-4 py-3 text-right">{t("dashboardPages.outbound.colFailed")}</th>
                  <th className="px-4 py-3 text-right">{t("dashboardPages.outbound.colMinutes")}</th>
                  <th className="px-4 py-3">{t("dashboardPages.outbound.colLastCall")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setOpenCampaignId(campaign.id)}
                        className="text-left font-semibold text-slate-800 hover:text-brand-700 hover:underline"
                      >
                        {campaign.name}
                      </button>
                      <p className="text-xs text-slate-500">
                        {widgetName(campaign.widget_id)} · {phoneNumberLabel(campaign.phone_number_id)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <CampaignStatusBadge status={campaign.status} />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">{campaign.stats.total}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{campaign.stats.called}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{campaign.stats.pending}</td>
                    <td className="px-4 py-3 text-right text-emerald-700">{campaign.stats.successful}</td>
                    <td className="px-4 py-3 text-right text-red-700">{campaign.stats.failed}</td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {Math.round(campaign.stats.durationSeconds / 60)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {campaign.stats.lastCallAt ? formatDateTime(campaign.stats.lastCallAt) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setOpenCampaignId(campaign.id)}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          {t("dashboardPages.outbound.viewCampaign")}
                        </button>
                        {actionsFor(campaign)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
