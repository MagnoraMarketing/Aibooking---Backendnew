"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { LLMModel, Package, VoiceModel, Widget } from "@/types/database";
import type { WidgetWithExtras } from "./agent-configurator";
import { AgentCreationWizard } from "./agent-creation-wizard";
import { useTranslation } from "@/components/i18n/language-provider";
import { WIDGET_LAUNCH_MINUTES } from "@/lib/billing/widget-launch-offer";
import { agentSectionPath } from "./agent-sections";
import { StatusPill, primaryButtonClass } from "./agent-flow-ui";

interface AgentsManagerProps {
  initialWidgets: Widget[];
  // Agents that exist but were never set up (see needsSetup in
  // lib/security/schemas.ts) — the creation flow can open on one of them.
  pendingSetup?: WidgetWithExtras[];
  llmModels: LLMModel[];
  voiceModels: VoiceModel[];
  embedCodeUnlocked: boolean;
  trialDaysRemaining: number;
  pkg: Package | null;
  // Locks this instance to one agent type — the Widget Agents page passes
  // "widget", the Inbound/Outbound phone-agent panel passes "phone". Widget
  // list is expected to already be pre-filtered by the caller; this just
  // threads the fixed type through to the wizard and adjusts copy.
  agentType: "widget" | "phone";
}

export function AgentsManager({
  initialWidgets,
  pendingSetup = [],
  llmModels,
  voiceModels,
  embedCodeUnlocked,
  trialDaysRemaining,
  pkg,
  agentType,
}: AgentsManagerProps) {
  const { t } = useTranslation();
  // Configure the agent inside the section it was opened from, so the top
  // menu does not jump to Widget Agents when a phone agent is opened from
  // Inbound — see components/dashboard/agent-configure-page.tsx.
  const agentBasePath = agentSectionPath(agentType);
  const HEADING_BY_TYPE = {
    widget: {
      title: t("dashboardPages.agents-manager.widgetTitle"),
      subtitle: t("dashboardPages.agents-manager.widgetSubtitle"),
      listTitle: t("dashboardPages.agents-manager.widgetListTitle"),
    },
    phone: {
      title: t("dashboardPages.agents-manager.phoneTitle"),
      subtitle: t("dashboardPages.agents-manager.phoneSubtitle"),
      listTitle: t("dashboardPages.agents-manager.phoneListTitle"),
    },
  } as const;
  const searchParams = useSearchParams();
  const [widgets, setWidgets] = useState(initialWidgets);
  const [pending, setPending] = useState(pendingSetup);
  // A brand-new customer's only agent is the one made at signup: open the
  // flow straight on it rather than showing a list with one unexplained
  // "Main widget" in it. ?setup=<id> does the same for a chosen agent.
  const [resumeWidget, setResumeWidget] = useState<WidgetWithExtras | null>(() => {
    const requested = searchParams.get("setup");
    const byParam = requested ? pendingSetup.find((w) => w.id === requested) : undefined;
    if (byParam) return byParam;
    return pendingSetup.length > 0 && pendingSetup.length === initialWidgets.length ? (pendingSetup[0] ?? null) : null;
  });
  const [showWizard, setShowWizard] = useState(initialWidgets.length === 0 || resumeWidget !== null);
  const [search, setSearch] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // The Stripe return page lands here when it can't tell which agent the
  // payment belonged to (see app/dashboard/checkout/return/page.tsx) — the
  // minutes are still credited, so say so rather than showing nothing.
  const justPaid = searchParams.get("paid") === "1";

  const filteredWidgets = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return widgets;
    return widgets.filter((w) => w.name.toLowerCase().includes(query));
  }, [widgets, search]);

  function handleWizardComplete(created: WidgetWithExtras) {
    setWidgets((prev) => [created, ...prev.filter((w) => w.id !== created.id)]);
    setPending((prev) => prev.filter((w) => w.id !== created.id));
    setResumeWidget(null);
    setShowWizard(false);
  }

  function continueSetup(widget: WidgetWithExtras) {
    setResumeWidget(widget);
    setShowWizard(true);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startNewAgent() {
    setResumeWidget(null);
    setShowWizard(true);
  }

  async function handleToggleStatus(widget: Widget) {
    setTogglingId(widget.id);
    const nextStatus = widget.status === "active" ? "paused" : "active";

    const res = await fetch(`/api/customer/widgets/${widget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });

    setTogglingId(null);

    if (res.ok) {
      setWidgets((prev) => prev.map((w) => (w.id === widget.id ? { ...w, status: nextStatus } : w)));
    }
  }

  const heading = HEADING_BY_TYPE[agentType];

  // Same status switch everywhere an agent is listed — the full cards and the
  // compact list beside the creation flow.
  function StatusSwitch({ widget }: { widget: Widget }) {
    const active = widget.status === "active";
    return (
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={`${widget.name}: ${active ? t("dashboardPages.shared.statusActive") : t("dashboardPages.shared.widgetStatusPaused")}`}
        disabled={togglingId === widget.id}
        onClick={() => handleToggleStatus(widget)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${active ? "bg-emerald-500" : "bg-slate-300"} disabled:opacity-60`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${active ? "left-5" : "left-0.5"}`} />
      </button>
    );
  }

  // Shown next to the creation flow (beside it on a wide screen, folded
  // above it on a phone), so the customer sees the agents they already have
  // without leaving the flow.
  // The agent being set up right now is the flow itself, not one of "the
  // others" — leave it out of the list beside it.
  const otherWidgets = widgets.filter((w) => w.id !== resumeWidget?.id);
  const existingAgentsTitle = t("agentFlow.list.existingTitle", { count: otherWidgets.length });
  const existingAgentsList =
    otherWidgets.length > 0 ? (
      <ul className="divide-y divide-slate-100">
        {otherWidgets.map((widget) => (
          <li key={widget.id} className="flex items-center justify-between gap-3 py-2.5">
            <Link href={`${agentBasePath}/${widget.id}`} className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{widget.name}</p>
              <StatusPill active={widget.status === "active"} />
            </Link>
            <StatusSwitch widget={widget} />
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{heading.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{heading.subtitle}</p>
        </div>
        {!showWizard ? (
          <button type="button" onClick={startNewAgent} className={primaryButtonClass}>
            {t("dashboardPages.agents-manager.newAgent")}
          </button>
        ) : null}
      </div>

      {justPaid ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-semibold text-emerald-800">{t("agent.configurator.paidBannerTitle")}</p>
          <p className="mt-1 text-sm text-emerald-700">
            {t("agent.wizardPayment.paidListBody", { minutes: WIDGET_LAUNCH_MINUTES })}
          </p>
        </div>
      ) : null}

      {showWizard ? (
        <div className={`grid gap-4 lg:items-start ${existingAgentsList ? "lg:grid-cols-[minmax(0,1fr)_300px]" : ""}`}>
          {existingAgentsList ? (
            <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm lg:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-slate-900">
                {existingAgentsTitle}
                <span className="text-slate-400 transition group-open:rotate-180">▾</span>
              </summary>
              <div className="border-t border-slate-100 px-4 pb-2">{existingAgentsList}</div>
            </details>
          ) : null}
          <AgentCreationWizard
            key={resumeWidget?.id ?? "new"}
            resumeWidget={resumeWidget ?? undefined}
            llmModels={llmModels}
            voiceModels={voiceModels}
            embedCodeUnlocked={embedCodeUnlocked}
            trialDaysRemaining={trialDaysRemaining}
            pkg={pkg}
            fixedType={agentType}
            onCancel={() => {
              setResumeWidget(null);
              setShowWizard(false);
            }}
            onComplete={handleWizardComplete}
          />
          {existingAgentsList ? (
            <aside className="hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-6 lg:block">
              <p className="text-sm font-semibold text-slate-900">{existingAgentsTitle}</p>
              <div className="mt-2">{existingAgentsList}</div>
            </aside>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold text-slate-900">
              {heading.listTitle}
              <span className="ml-2 text-sm font-normal text-slate-400">{widgets.length}</span>
            </h2>
            {widgets.length > 3 ? (
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("dashboardPages.agents-manager.searchPlaceholder")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 sm:max-w-xs sm:text-sm"
              />
            ) : null}
          </div>

          {filteredWidgets.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <p className="text-sm text-slate-500">{t("dashboardPages.agents-manager.noAgentsFound")}</p>
              {widgets.length === 0 ? (
                <button type="button" onClick={startNewAgent} className={`mt-4 ${primaryButtonClass}`}>
                  {t("dashboardPages.agents-manager.newAgent")}
                </button>
              ) : null}
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredWidgets.map((widget) => {
                const pendingWidget = pending.find((p) => p.id === widget.id);
                return (
                <li key={widget.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`${agentBasePath}/${widget.id}`} className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold text-slate-900">{widget.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {t("dashboardPages.agents-manager.createdOn", {
                          date: new Date(widget.created_at).toLocaleDateString("da-DK"),
                        })}
                      </p>
                    </Link>
                    <StatusSwitch widget={widget} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusPill active={widget.status === "active"} />
                    {pendingWidget ? (
                      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        {t("agentFlow.list.needsSetup")}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Link
                      href={`${agentBasePath}/${widget.id}`}
                      className="rounded-lg border border-slate-300 px-3 py-2.5 text-center text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {t("agentFlow.list.edit")}
                    </Link>
                    {pendingWidget ? (
                      <button
                        type="button"
                        onClick={() => continueSetup(pendingWidget)}
                        className="rounded-lg bg-brand-600 px-3 py-2.5 text-center text-sm font-medium text-white hover:bg-brand-700"
                      >
                        {t("agentFlow.list.continueSetup")}
                      </button>
                    ) : (
                      <Link
                        href={`${agentBasePath}/${widget.id}?tab=test`}
                        className="rounded-lg bg-brand-600 px-3 py-2.5 text-center text-sm font-medium text-white hover:bg-brand-700"
                      >
                        {t("agentFlow.list.test")}
                      </Link>
                    )}
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
