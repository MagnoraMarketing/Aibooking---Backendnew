"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { CampaignRow } from "@/app/dashboard/outbound/page";
import type { CampaignStats } from "@/lib/outbound/stats";
import { SessionDetailsModal } from "./session-details-modal";
import { CampaignStatusBadge } from "./outbound-campaign-actions";
import { useTranslation } from "@/components/i18n/language-provider";

// One campaign, contact by contact.
//
// The campaign list says how many calls were made; this says who they were
// made to. Every column here answers a question the old view could not: who
// is this, was the call placed, when, and what came of it — and the last of
// those opens the same call details Inbound shows, because it is the same
// call record underneath (see the contacts route and session-details-modal).

export interface CampaignContact {
  id: string;
  phoneNumber: string;
  name: string | null;
  company: string | null;
  status: "pending" | "calling" | "completed" | "failed";
  attempts: number;
  lastCalledAt: string | null;
  nextAttemptAt: string | null;
  failureReason: string | null;
  // What the call came to (lib/outbound/outcome.ts) and the AI's summary.
  outcome: string | null;
  summary: string | null;
  hasCall: boolean;
  call: { durationSeconds: number; endedReason: string | null; at: string } | null;
}

// How often a running campaign's contact list refreshes itself. The server's
// answer replaces what is on screen rather than being merged into it, so a
// result can never be counted twice or half-updated.
const POLL_MS = 10_000;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("da-DK", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const CONTACT_STATUS_CLASS: Record<CampaignContact["status"], string> = {
  pending: "bg-slate-100 text-slate-600",
  calling: "bg-blue-50 text-blue-700",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
};

interface OutboundCampaignDetailProps {
  campaign: CampaignRow;
  agentName: string;
  phoneNumberLabel: string;
  actions: ReactNode;
  onBack: () => void;
  // Fresh numbers for this campaign, so the overview behind it does not sit
  // on stale counts while someone watches the calls come in.
  onStats: (campaignId: string, stats: CampaignStats) => void;
}

export function OutboundCampaignDetail({
  campaign,
  agentName,
  phoneNumberLabel,
  actions,
  onBack,
  onStats,
}: OutboundCampaignDetailProps) {
  const { t } = useTranslation();
  const [contacts, setContacts] = useState<CampaignContact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openContactId, setOpenContactId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/customer/outbound-campaigns/${campaign.id}/contacts`);
    if (!res.ok) {
      setError(t("dashboardPages.outbound.errorLoadContacts"));
      return;
    }
    const data = (await res.json()) as { contacts: CampaignContact[]; stats: CampaignStats };
    setContacts(data.contacts);
    setError(null);
    onStats(campaign.id, data.stats);
  }, [campaign.id, onStats, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Only while something can still change. A finished campaign is a record,
  // and re-reading it every ten seconds would be asking a question whose
  // answer is already final.
  const live = campaign.status === "running" || campaign.status === "paused";
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [live, load]);

  return (
    <div className="space-y-6">
      <div>
        <button type="button" onClick={onBack} className="text-sm font-medium text-brand-600 hover:underline">
          {t("dashboardPages.outbound.backToCampaigns")}
        </button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-900">{campaign.name}</h1>
            <CampaignStatusBadge status={campaign.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {agentName} · {phoneNumberLabel}
          </p>
        </div>
        {actions}
      </div>

      {campaign.status === "paused" ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t("dashboardPages.outbound.pausedNotice")}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            ["colTotal", campaign.stats.total],
            ["colCalled", campaign.stats.called],
            ["colPending", campaign.stats.pending],
            ["colSuccessful", campaign.stats.successful],
            ["colFailed", campaign.stats.failed],
            ["colMinutes", Math.round(campaign.stats.durationSeconds / 60)],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500">{t(`dashboardPages.outbound.${key}`)}</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      {/* What the calls came to, live while the campaign runs. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {(
          [
            ["calling", campaign.stats.calling ?? 0],
            ["answered", campaign.stats.outcomes?.answered ?? 0],
            ["no_answer", campaign.stats.outcomes?.no_answer ?? 0],
            ["voicemail", campaign.stats.outcomes?.voicemail ?? 0],
            ["interested", campaign.stats.outcomes?.interested ?? 0],
            ["meeting_booked", campaign.stats.outcomes?.meeting_booked ?? 0],
            ["callback", campaign.stats.outcomes?.callback ?? 0],
            ["not_interested", campaign.stats.outcomes?.not_interested ?? 0],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
            <p className="text-[11px] font-medium text-slate-500">{t(`dashboardPages.outbound.outcome.${key}`)}</p>
            <p className="text-lg font-semibold text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      {contacts && contacts.some((c) => c.lastCalledAt) ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">{t("dashboardPages.outbound.liveActivity")}</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {[...contacts]
              .filter((c) => c.lastCalledAt)
              .sort((a, b) => (b.lastCalledAt! > a.lastCalledAt! ? 1 : -1))
              .slice(0, 8)
              .map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="text-slate-500">
                    {new Date(c.lastCalledAt!).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="flex-1 px-3 font-medium text-slate-800">{c.name || c.phoneNumber}</span>
                  <span className="text-slate-600">
                    {c.status === "calling"
                      ? t("dashboardPages.outbound.outcome.calling")
                      : c.outcome
                        ? t(`dashboardPages.outbound.outcome.${c.outcome}`)
                        : t(`dashboardPages.outbound.contactStatus.${c.status}`)}
                    {c.call?.durationSeconds ? ` · ${Math.floor(c.call.durationSeconds / 60)}:${String(Math.round(c.call.durationSeconds % 60)).padStart(2, "0")}` : ""}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">{t("dashboardPages.outbound.colName")}</th>
              <th className="px-4 py-3">{t("dashboardPages.outbound.colCompany")}</th>
              <th className="px-4 py-3">{t("dashboardPages.outbound.colPhone")}</th>
              <th className="px-4 py-3">{t("dashboardPages.outbound.colStatus")}</th>
              <th className="px-4 py-3">{t("dashboardPages.outbound.colCallTime")}</th>
              <th className="px-4 py-3">{t("dashboardPages.outbound.colResult")}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {contacts === null ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  {t("dashboardPages.session-details-modal.loading")}
                </td>
              </tr>
            ) : contacts.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  {t("dashboardPages.outbound.noContactsYet")}
                </td>
              </tr>
            ) : (
              contacts.map((contact) => (
                <tr key={contact.id} className="align-top">
                  <td className="px-4 py-3 font-medium text-slate-800">{contact.name || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{contact.company || "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{contact.phoneNumber}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
                        CONTACT_STATUS_CLASS[contact.status]
                      }`}
                    >
                      {t(`dashboardPages.outbound.contactStatus.${contact.status}`)}
                    </span>
                    {contact.attempts > 1 ? (
                      <span className="ml-2 text-xs text-slate-400">
                        {t("dashboardPages.outbound.attemptsValue", { count: contact.attempts })}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {contact.lastCalledAt ? formatDateTime(contact.lastCalledAt) : t("dashboardPages.outbound.notCalledYet")}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {contact.outcome ? (
                      <span className="block font-medium text-slate-800">
                        {t(`dashboardPages.outbound.outcome.${contact.outcome}`)}
                      </span>
                    ) : null}
                    {contact.summary ? <span className="block max-w-xs text-xs text-slate-500">{contact.summary}</span> : null}
                    {contact.call ? (
                      <>
                        <span>{Math.round(contact.call.durationSeconds)} sek</span>
                        {contact.call.endedReason ? (
                          <span className="block text-xs text-slate-400">{contact.call.endedReason}</span>
                        ) : null}
                      </>
                    ) : contact.failureReason ? (
                      <span className="text-xs text-red-700">{contact.failureReason}</span>
                    ) : (
                      "—"
                    )}
                    {contact.call && contact.failureReason ? (
                      <span className="block text-xs text-red-700">{contact.failureReason}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {contact.hasCall ? (
                      <button
                        type="button"
                        onClick={() => setOpenContactId(contact.id)}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {t("dashboardPages.outbound.callDetails")}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {openContactId ? (
        <SessionDetailsModal
          source={`/api/customer/outbound-campaigns/${campaign.id}/contacts/${openContactId}`}
          onClose={() => setOpenContactId(null)}
        />
      ) : null}
    </div>
  );
}
