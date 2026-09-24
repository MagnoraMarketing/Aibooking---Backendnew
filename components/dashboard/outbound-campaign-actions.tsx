"use client";

import type { CampaignRow } from "@/app/dashboard/outbound/page";
import { canLaunch, canPause, canResume, canEditSettings, canStop } from "@/lib/outbound/status";
import { useTranslation } from "@/components/i18n/language-provider";

// What a campaign can be told to do right now, and what it is doing.
//
// Both the overview and a single campaign's page offer the same buttons, and
// which ones they offer is a rule about the campaign's state, not about the
// page — so the rule (lib/outbound/status.ts) is read in one component
// instead of being spelled out twice with two chances to disagree.

const BADGE_CLASS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  running: "bg-emerald-50 text-emerald-700",
  paused: "bg-amber-50 text-amber-700",
  completed: "bg-brand-50 text-brand-700",
  failed: "bg-red-50 text-red-700",
  cancelled: "bg-slate-100 text-slate-600",
};

export function CampaignStatusBadge({ status }: { status: CampaignRow["status"] }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${
        BADGE_CLASS[status] ?? BADGE_CLASS.draft
      }`}
    >
      {t(`dashboardPages.outbound.status.${status}`)}
    </span>
  );
}

interface CampaignActionsProps {
  campaign: CampaignRow;
  busy: boolean;
  onLaunch: () => void;
  onPause: () => void;
  onResume: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onStop: () => void;
  onTest: () => void;
  onDuplicate: () => void;
}

export function CampaignActions({
  campaign,
  busy,
  onLaunch,
  onPause,
  onResume,
  onEdit,
  onDelete,
  onStop,
  onTest,
  onDuplicate,
}: CampaignActionsProps) {
  const { t } = useTranslation();
  const secondary =
    "rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      {canEditSettings(campaign.status) ? (
        <button type="button" onClick={onEdit} disabled={busy} className={secondary}>
          {t("common.edit")}
        </button>
      ) : null}

      <button type="button" onClick={onDuplicate} disabled={busy} className={secondary}>
        {t("dashboardPages.outbound.duplicateCampaign")}
      </button>

      {/* Only a draft can be deleted. Once calls have gone out the campaign
          is the record of them, recordings included. */}
      {campaign.status === "draft" ? (
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
        >
          {t("common.delete")}
        </button>
      ) : null}

      {/* One real call before the whole list — the agent, the number and
          the lead's {{variables}} heard on an actual phone. */}
      {campaign.status === "draft" || campaign.status === "paused" ? (
        <button type="button" onClick={onTest} disabled={busy} className={secondary}>
          {t("dashboardPages.outbound.testOneLead")}
        </button>
      ) : null}

      {canLaunch(campaign.status) ? (
        <button
          type="button"
          onClick={onLaunch}
          disabled={busy}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {busy ? t("dashboardPages.outbound.launching") : t("dashboardPages.outbound.launchCampaign")}
        </button>
      ) : null}

      {canPause(campaign.status) ? (
        <button type="button" onClick={onPause} disabled={busy} className={secondary}>
          {t("dashboardPages.outbound.pauseCampaign")}
        </button>
      ) : null}

      {canResume(campaign.status) ? (
        <button
          type="button"
          onClick={onResume}
          disabled={busy}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {t("dashboardPages.outbound.resumeCampaign")}
        </button>
      ) : null}

      {canStop(campaign.status) ? (
        <button
          type="button"
          onClick={onStop}
          disabled={busy}
          className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
        >
          {t("dashboardPages.outbound.stopCampaign")}
        </button>
      ) : null}
    </div>
  );
}
