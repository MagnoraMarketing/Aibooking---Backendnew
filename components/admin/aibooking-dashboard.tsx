"use client";

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  computeStats,
  type DashboardAgent,
  type DashboardBooking,
  type DashboardCall,
  type DashboardCallDetail,
  type DashboardChannel,
} from "@/lib/aibooking-dashboard/calls";
import type { CustomerPricing } from "@/lib/aibooking-dashboard/customer";
import type { AssistantConfig } from "@/lib/aibooking-dashboard/assistant-config";

// ---------------------------------------------------------------------------
// Aibooking.dk Dashboard — AIbooking's own agents (website widget, inbound
// line, later outbound) in one place: activity, history with transcripts and
// recordings, bookings and statistics, per agent or in total.
//
// The same dashboard is every customer's own (variant "customer", on
// /dashboard): their agents, and what the calls cost them at their
// package's minute price instead of what Vapi charged us. Agent settings and
// anything about Vapi stay admin-only.
// ---------------------------------------------------------------------------

type Variant = "admin" | "customer";

interface VariantConfig {
  variant: Variant;
  callUrl: (id: string) => string;
  costLabel: string;
  fmtCost: (value: number) => string;
  pricing: CustomerPricing | null;
}

const adminCallUrl = (id: string) => `/api/admin/aibooking-dashboard/calls/${encodeURIComponent(id)}`;
const customerCallUrl = (id: string) => `/api/customer/call-dashboard/calls/${encodeURIComponent(id)}`;

const VariantContext = createContext<VariantConfig | null>(null);

function useVariant(): VariantConfig {
  const config = useContext(VariantContext);
  if (!config) throw new Error("VariantContext missing");
  return config;
}

function fmtMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("da-DK", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
}

// Categorical series colours, assigned by the agent's position in the full
// agent list (never by rank in the current selection), so an agent keeps its
// colour when others are hidden or deactivated.
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const NEUTRAL = "#2a78d6";

const PERIODS = [
  { days: 1, label: "I dag" },
  { days: 7, label: "7 dage" },
  { days: 30, label: "30 dage" },
  { days: 90, label: "90 dage" },
];

const CHANNEL_LABEL: Record<DashboardChannel, string> = {
  widget: "Widget",
  inbound: "Inbound",
  outbound: "Outbound",
};

const CALL_TYPE_LABEL: Record<string, string> = {
  webCall: "Web / widget",
  inboundPhoneCall: "Indgående opkald",
  outboundPhoneCall: "Udgående opkald",
};

const ENDED_REASON_LABEL: Record<string, string> = {
  "customer-ended-call": "Kunden lagde på",
  "assistant-ended-call": "Agenten afsluttede",
  "silence-timed-out": "Stilhed (timeout)",
  "exceeded-max-duration": "Maks. varighed nået",
  "customer-did-not-answer": "Ikke besvaret",
  "customer-busy": "Optaget",
  voicemail: "Telefonsvarer",
  "assistant-forwarded-call": "Viderestillet",
  ukendt: "Ukendt",
};

const BOOKING_KIND_LABEL: Record<DashboardBooking["kind"], string> = {
  create: "Booking",
  reschedule: "Flytning",
  cancel: "Aflysning",
};

function fmtDuration(seconds: number): string {
  if (!seconds) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h}t ${m}m`;
  if (m) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function fmtDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" });
}

function fmtDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("da-DK", { day: "numeric", month: "short" });
}

function fmtUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function fmtPercent(value: number): string {
  return `${(value * 100).toFixed(1).replace(".", ",")} %`;
}

function reasonLabel(reason: string): string {
  return ENDED_REASON_LABEL[reason] ?? reason.replace(/[-_.]/g, " ");
}

interface ActivityResponse {
  agents: DashboardAgent[];
  calls: DashboardCall[];
  errors: Record<string, string>;
  vapiHistoryFrom: string | null;
  pricing?: CustomerPricing;
  days: number;
  fetchedAt: string;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return (body?.error?.message as string | undefined) ?? fallback;
}

export function AibookingDashboard({
  initialAgents,
  variant = "admin",
  initialPricing = null,
  customerName = null,
}: {
  initialAgents: DashboardAgent[];
  variant?: Variant;
  initialPricing?: CustomerPricing | null;
  customerName?: string | null;
}) {
  const isCustomer = variant === "customer";
  const [pricing, setPricing] = useState<CustomerPricing | null>(initialPricing);
  const config = useMemo<VariantConfig>(() => {
    if (!isCustomer) {
      return {
        variant,
        callUrl: adminCallUrl,
        costLabel: "Omkostning (Vapi)",
        fmtCost: fmtUsd,
        pricing: null,
      };
    }
    const currency = pricing?.currency ?? "DKK";
    return {
      variant,
      callUrl: customerCallUrl,
      costLabel: "Forbrug",
      fmtCost: (value) => fmtMoney(value, currency),
      pricing,
    };
  }, [isCustomer, variant, pricing]);
  const [agents, setAgents] = useState(initialAgents);
  const [calls, setCalls] = useState<DashboardCall[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [vapiHistoryFrom, setVapiHistoryFrom] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  // "all" = total across every active agent.
  const [selected, setSelected] = useState<string>("all");
  const [view, setView] = useState<"overview" | "history" | "bookings" | "agents">("overview");

  const load = useCallback(async (period: number) => {
    setLoading(true);
    setLoadError(null);
    // Built from the variant alone, not from `config`: config changes with
    // the pricing this very request sets, and would re-trigger the load.
    const url =
      variant === "customer"
        ? `/api/customer/call-dashboard/activity?days=${period}`
        : `/api/admin/aibooking-dashboard/activity?days=${period}`;
    const res = await fetch(url, { cache: "no-store" });
    setLoading(false);
    if (!res.ok) {
      setLoadError(await readError(res, "Aktiviteten kunne ikke hentes."));
      return;
    }
    const data = (await res.json()) as ActivityResponse;
    setAgents(data.agents);
    setCalls(data.calls);
    setErrors(data.errors);
    setVapiHistoryFrom(data.vapiHistoryFrom);
    setFetchedAt(data.fetchedAt);
    if (data.pricing) setPricing(data.pricing);
  }, [variant]);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const colorOf = useCallback(
    (agentId: string) => {
      const index = agents.findIndex((a) => a.id === agentId);
      return SERIES[index >= 0 ? index % SERIES.length : 0]!;
    },
    [agents]
  );

  const activeAgents = agents.filter((a) => a.is_active);
  const selectedAgent = agents.find((a) => a.id === selected) ?? null;
  const scopedCalls = useMemo(
    () => (selected === "all" ? calls : calls.filter((c) => c.agentId === selected)),
    [calls, selected]
  );
  const stats = useMemo(() => computeStats(scopedCalls, days), [scopedCalls, days]);
  const hasOutbound = agents.some((a) => a.channel === "outbound");

  // If the selected agent was removed or deactivated, fall back to total.
  useEffect(() => {
    if (selected !== "all" && !activeAgents.some((a) => a.id === selected)) setSelected("all");
  }, [activeAgents, selected]);

  return (
    <VariantContext.Provider value={config}>
    <div className="space-y-6">
      {/* Header */}
      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500 p-6 text-white shadow-lg sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-100">
              {isCustomer ? "Dit dashboard" : "Platformens egne agenter"}
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              {isCustomer ? customerName || "Dashboard" : "Aibooking.dk Dashboard"}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-brand-100">
              {isCustomer
                ? "Al aktivitet på dine agenter — historik, transskriptioner, optagelser, bookinger og forbrug."
                : "Al aktivitet på aibooking.dk's agenter — historik, transskriptioner, optagelser, bookinger og statistik."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl bg-white/10 p-1 backdrop-blur">
              {PERIODS.map((p) => (
                <button
                  key={p.days}
                  type="button"
                  onClick={() => setDays(p.days)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    days === p.days ? "bg-white text-brand-800 shadow" : "text-white/80 hover:text-white"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void load(days)}
              disabled={loading}
              className="rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold text-white hover:bg-white/25 disabled:opacity-60"
            >
              {loading ? "Henter…" : "Opdater"}
            </button>
          </div>
        </div>
        {fetchedAt ? (
          <p className="mt-4 text-[11px] text-brand-100/80">
            Opdateret {fmtDateTime(fetchedAt)}
            {isCustomer ? "" : " · data hentes direkte fra Vapi"}
          </p>
        ) : null}
        {isCustomer && pricing ? (
          <div className="mt-5 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-white/15 px-3 py-1.5 font-semibold">
              Pakke: {pricing.packageName ?? "Prøveperiode"}
            </span>
            <span className="rounded-full bg-white/15 px-3 py-1.5 font-semibold">
              Minutpris: {fmtMoney(pricing.pricePerMinute, pricing.currency)}
            </span>
            <span className="rounded-full bg-white/15 px-3 py-1.5 font-semibold">
              {pricing.minutesRemaining.toLocaleString("da-DK")} min tilbage
            </span>
          </div>
        ) : null}
      </div>

      {/* Agent selector */}
      <div className="flex flex-wrap gap-2">
        <AgentChip active={selected === "all"} onClick={() => setSelected("all")} label="Total" sub={`${activeAgents.length} agenter`} />
        {activeAgents.map((agent) => (
          <AgentChip
            key={agent.id}
            active={selected === agent.id}
            onClick={() => setSelected(agent.id)}
            label={agent.name}
            sub={CHANNEL_LABEL[agent.channel]}
            color={colorOf(agent.id)}
          />
        ))}
        {!hasOutbound && !isCustomer ? (
          <button
            type="button"
            onClick={() => setView("agents")}
            className="flex items-center gap-2 rounded-2xl border border-dashed border-slate-300 px-4 py-2 text-left text-slate-400 hover:border-brand-300 hover:text-brand-600"
          >
            <span className="text-sm font-medium">+ Outbound</span>
            <span className="text-[11px]">tilføj når aktuelt</span>
          </button>
        ) : null}
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {(
          [
            ["overview", "Overblik"],
            ["history", `Historik (${scopedCalls.length})`],
            ["bookings", `Bookinger (${scopedCalls.reduce((n, c) => n + c.bookings.length, 0)})`],
            ["agents", "Agenter & indstillinger"],
          ] as const
        )
          .filter(([key]) => !isCustomer || key !== "agents")
          .map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition ${
              view === key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loadError ? <Alert tone="error">{loadError}</Alert> : null}
      {isCustomer && !loading && agents.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          Du har ingen agenter endnu. Når du opretter en agent, vises dens samtaler, optagelser og bookinger her.
        </p>
      ) : null}
      {vapiHistoryFrom && !loading && !isCustomer ? (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
          ⓘ Vapi udleverer kun samtaler fra {new Date(vapiHistoryFrom).toLocaleDateString("da-DK")} og frem på jeres abonnement.
          Ældre samtaler i perioden vises fra platformens egen log, hvis Vapi har sendt dem til vores webhook.
        </p>
      ) : null}
      {Object.entries(errors)
        .filter(([agentId]) => selected === "all" || agentId === selected)
        .map(([agentId, message]) => (
          <Alert key={agentId} tone="warning">
            {agents.find((a) => a.id === agentId)?.name ?? "Agent"}: {message}
          </Alert>
        ))}

      {view === "overview" ? (
        <Overview
          stats={stats}
          loading={loading}
          days={days}
          agents={selected === "all" ? activeAgents : selectedAgent ? [selectedAgent] : []}
          calls={scopedCalls}
          colorOf={colorOf}
          showComparison={selected === "all"}
          onOpenHistory={() => setView("history")}
        />
      ) : null}
      {view === "history" ? <History calls={scopedCalls} agents={agents} colorOf={colorOf} loading={loading} /> : null}
      {view === "bookings" ? <Bookings calls={scopedCalls} agents={agents} colorOf={colorOf} /> : null}
      {view === "agents" && !isCustomer ? (
        <AgentSettings
          agents={agents}
          colorOf={colorOf}
          onChanged={(next) => {
            setAgents(next);
            void load(days);
          }}
        />
      ) : null}
    </div>
    </VariantContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function AgentChip({
  active,
  onClick,
  label,
  sub,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-2xl border px-4 py-2 text-left transition ${
        active ? "border-brand-600 bg-white shadow-sm ring-2 ring-brand-100" : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      {color ? (
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      ) : (
        <span className="grid h-5 w-5 place-items-center rounded-md bg-slate-900 text-[10px] font-bold text-white" aria-hidden>
          Σ
        </span>
      )}
      <span>
        <span className="block text-sm font-semibold text-slate-900">{label}</span>
        <span className="block text-[11px] text-slate-500">{sub}</span>
      </span>
    </button>
  );
}

function Alert({ tone, children }: { tone: "error" | "warning"; children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className={`rounded-xl border px-4 py-3 text-sm ${
        tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"
      }`}
    >
      {tone === "error" ? "⚠ " : "! "}
      {children}
    </div>
  );
}

function Kpi({ label, value, hint, loading }: { label: string; value: string; hint?: string; loading: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      {loading ? (
        <div className="mt-2 h-7 w-16 animate-pulse rounded bg-slate-100" />
      ) : (
        <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      )}
      {hint ? <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function Overview({
  stats,
  loading,
  days,
  agents,
  calls,
  colorOf,
  showComparison,
  onOpenHistory,
}: {
  stats: ReturnType<typeof computeStats>;
  loading: boolean;
  days: number;
  agents: DashboardAgent[];
  calls: DashboardCall[];
  colorOf: (id: string) => string;
  showComparison: boolean;
  onOpenHistory: () => void;
}) {
  const { costLabel, fmtCost, pricing } = useVariant();
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi loading={loading} label="Samtaler" value={String(stats.totalCalls)} hint={`${stats.answeredCalls} gennemførte`} />
        <Kpi loading={loading} label="Samlet taletid" value={fmtDuration(stats.totalSeconds)} hint={`Gns. ${fmtDuration(stats.avgSeconds)} pr. samtale`} />
        <Kpi
          loading={loading}
          label="Bookinger"
          value={String(stats.bookings)}
          hint={`${stats.reschedules} flyttet · ${stats.cancellations} aflyst · ${stats.failedBookings} fejlet`}
        />
        <Kpi loading={loading} label="Konvertering" value={fmtPercent(stats.conversionRate)} hint="Bookinger pr. gennemført samtale" />
        <Kpi loading={loading} label="Unikke kontakter" value={String(stats.uniqueCallers)} hint="Forskellige telefonnumre" />
        <Kpi
          loading={loading}
          label={costLabel}
          value={fmtCost(stats.totalCost)}
          hint={
            pricing
              ? `${fmtCost(pricing.pricePerMinute)} pr. minut · ${(stats.totalSeconds / 60).toFixed(1).replace(".", ",")} min`
              : stats.totalCalls
                ? `${fmtCost(stats.totalCost / stats.totalCalls)} pr. samtale`
                : undefined
          }
        />
        <Kpi
          loading={loading}
          label="Gennemførelsesrate"
          value={stats.totalCalls ? fmtPercent(stats.answeredCalls / stats.totalCalls) : "—"}
          hint="Samtaler med taletid"
        />
        <Kpi loading={loading} label="Samtaler pr. dag" value={(stats.totalCalls / days).toFixed(1).replace(".", ",")} hint={`Gennemsnit over ${days} dage`} />
      </div>

      <Card title="Samtaler pr. dag">
        <DailyChart daily={stats.daily} agents={agents} colorOf={colorOf} />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Hvordan samtalerne sluttede">
          <HorizontalBars
            rows={stats.endedReasons.slice(0, 7).map((r) => ({ label: reasonLabel(r.reason), value: r.count }))}
            empty="Ingen samtaler i perioden"
          />
        </Card>
        <Card title="Aktivitet fordelt på døgnet">
          <HourChart byHour={stats.byHour} />
        </Card>
      </div>

      {showComparison && agents.length > 1 ? (
        <Card title="Agenterne sammenlignet">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-2 font-medium">Agent</th>
                  <th className="py-2 text-right font-medium">Samtaler</th>
                  <th className="py-2 text-right font-medium">Taletid</th>
                  <th className="py-2 text-right font-medium">Gns. varighed</th>
                  <th className="py-2 text-right font-medium">Bookinger</th>
                  <th className="py-2 text-right font-medium">Konvertering</th>
                  <th className="py-2 text-right font-medium">{pricing ? "Forbrug" : "Omkostning"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agents.map((agent) => {
                  const s = computeStats(
                    calls.filter((c) => c.agentId === agent.id),
                    days
                  );
                  return (
                    <tr key={agent.id}>
                      <td className="py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorOf(agent.id) }} aria-hidden />
                          <span className="font-medium text-slate-800">{agent.name}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                            {CHANNEL_LABEL[agent.channel]}
                          </span>
                        </span>
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{s.totalCalls}</td>
                      <td className="py-2.5 text-right tabular-nums">{fmtDuration(s.totalSeconds)}</td>
                      <td className="py-2.5 text-right tabular-nums">{fmtDuration(s.avgSeconds)}</td>
                      <td className="py-2.5 text-right tabular-nums">{s.bookings}</td>
                      <td className="py-2.5 text-right tabular-nums">{fmtPercent(s.conversionRate)}</td>
                      <td className="py-2.5 text-right tabular-nums">{fmtCost(s.totalCost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card
        title="Seneste samtaler"
        action={
          <button type="button" onClick={onOpenHistory} className="text-xs font-semibold text-brand-600 hover:text-brand-800">
            Se hele historikken →
          </button>
        }
      >
        {calls.length === 0 ? (
          <p className="text-sm text-slate-500">{loading ? "Henter…" : "Ingen samtaler i perioden."}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {calls.slice(0, 6).map((call) => (
              <li key={call.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf(call.agentId) }} aria-hidden />
                <span className="w-32 shrink-0 text-xs text-slate-500">{fmtDateTime(call.startedAt ?? call.createdAt)}</span>
                <span className="min-w-0 flex-1 truncate text-slate-700">{call.summary ?? CALL_TYPE_LABEL[call.type ?? ""] ?? "Samtale"}</span>
                {call.bookings.some((b) => b.kind === "create" && b.success) ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">✓ Booket</span>
                ) : null}
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-slate-500">{fmtDuration(call.durationSeconds)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// Stacked daily bars, one segment per agent, with a hover tooltip per day.
function DailyChart({
  daily,
  agents,
  colorOf,
}: {
  daily: ReturnType<typeof computeStats>["daily"];
  agents: DashboardAgent[];
  colorOf: (id: string) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.total));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const labelEvery = Math.max(1, Math.ceil(daily.length / 10));
  const hovered = hover !== null ? daily[hover] : null;

  return (
    <div>
      {agents.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-600">
          {agents.map((agent) => (
            <span key={agent.id} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colorOf(agent.id) }} aria-hidden />
              {agent.name}
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative flex h-56 gap-2">
        {/* y axis */}
        <div className="relative w-7 shrink-0 text-right text-[10px] tabular-nums text-slate-400">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0" style={{ bottom: `${(t / top) * 100}%`, transform: "translateY(50%)" }}>
              {t}
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-slate-100" style={{ bottom: `${(t / top) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
            {daily.map((point, i) => (
              <div
                key={point.day}
                className="flex h-full flex-1 cursor-default flex-col justify-end"
                onMouseEnter={() => setHover(i)}
                aria-label={`${fmtDay(point.day)}: ${point.total} samtaler`}
              >
                <div
                  className={`flex w-full flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px] transition-opacity ${
                    hover !== null && hover !== i ? "opacity-50" : ""
                  }`}
                  style={{ height: `${(point.total / top) * 100}%` }}
                >
                  {agents.map((agent) => {
                    const value = point.byAgent[agent.id] ?? 0;
                    if (!value) return null;
                    return <div key={agent.id} style={{ flexGrow: value, backgroundColor: colorOf(agent.id) }} />;
                  })}
                </div>
              </div>
            ))}
          </div>
          {hovered ? (
            <div
              className="pointer-events-none absolute top-0 z-10 w-44 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg"
              style={{
                left: `${((hover! + 0.5) / daily.length) * 100}%`,
                transform: hover! > daily.length / 2 ? "translateX(-105%)" : "translateX(5%)",
              }}
            >
              <p className="font-semibold text-slate-900">{fmtDay(hovered.day)}</p>
              <p className="mb-1 text-slate-500">{hovered.total} samtaler</p>
              {agents.map((agent) => (
                <p key={agent.id} className="flex items-center justify-between gap-2 text-slate-700">
                  <span className="flex items-center gap-1.5 truncate">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf(agent.id) }} aria-hidden />
                    <span className="truncate">{agent.name}</span>
                  </span>
                  <span className="tabular-nums">{hovered.byAgent[agent.id] ?? 0}</span>
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="ml-9 mt-1 flex gap-[2px] text-[10px] text-slate-400">
        {daily.map((point, i) => (
          <span key={point.day} className="flex-1 truncate text-center">
            {i % labelEvery === 0 ? fmtDay(point.day) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function niceTicks(max: number): number[] {
  const rough = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? pow * 10;
  const ticks: number[] = [];
  for (let t = 0; t <= max + step - 1e-9; t += step) ticks.push(Math.round(t));
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + Math.round(step));
  return ticks.length > 1 ? ticks : [0, 1];
}

function HorizontalBars({ rows, empty }: { rows: { label: string; value: number }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.label} className="text-xs">
          <div className="mb-1 flex justify-between text-slate-600">
            <span className="truncate">{row.label}</span>
            <span className="tabular-nums text-slate-900">{row.value}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full" style={{ width: `${(row.value / max) * 100}%`, backgroundColor: NEUTRAL }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function HourChart({ byHour }: { byHour: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...byHour);
  return (
    <div>
      <div className="relative flex h-36 items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
        {byHour.map((value, hour) => (
          <div key={hour} className="flex h-full flex-1 flex-col justify-end" onMouseEnter={() => setHover(hour)}>
            <div
              className={`rounded-t-[4px] transition-opacity ${hover !== null && hover !== hour ? "opacity-50" : ""}`}
              style={{ height: `${(value / max) * 100}%`, minHeight: value ? 2 : 0, backgroundColor: NEUTRAL }}
            />
          </div>
        ))}
        {hover !== null ? (
          <div className="pointer-events-none absolute -top-2 right-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs shadow">
            kl. {String(hover).padStart(2, "0")}–{String((hover + 1) % 24).padStart(2, "0")}: <b className="tabular-nums">{byHour[hover]}</b> samtaler
          </div>
        ) : null}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function History({
  calls,
  agents,
  colorOf,
  loading,
}: {
  calls: DashboardCall[];
  agents: DashboardAgent[];
  colorOf: (id: string) => string;
  loading: boolean;
}) {
  const [query, setQuery] = useState("");
  const [onlyBooked, setOnlyBooked] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return calls.filter((call) => {
      if (onlyBooked && !call.bookings.some((b) => b.kind === "create" && b.success)) return false;
      if (!q) return true;
      return [call.summary, call.customerNumber, call.id, ...call.bookings.map((b) => `${b.customerName} ${b.customerEmail}`)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [calls, query, onlyBooked]);

  return (
    <Card
      title="Samtalehistorik"
      action={
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={onlyBooked} onChange={(e) => setOnlyBooked(e.target.checked)} />
            Kun med booking
          </label>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Søg i nummer, resumé, navn…"
            className="w-56 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          />
        </div>
      }
    >
      {filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">{loading ? "Henter…" : "Ingen samtaler matcher."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-2 font-medium">Tidspunkt</th>
                <th className="py-2 font-medium">Agent</th>
                <th className="py-2 font-medium">Type</th>
                <th className="py-2 font-medium">Kontakt</th>
                <th className="py-2 font-medium">Resumé</th>
                <th className="py-2 text-right font-medium">Varighed</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.slice(0, limit).map((call) => {
                const agent = agents.find((a) => a.id === call.agentId);
                const open = openId === call.id;
                const booked = call.bookings.some((b) => b.kind === "create" && b.success);
                return (
                  <Fragment key={call.id}>
                    <tr
                      className={`cursor-pointer align-top hover:bg-slate-50 ${open ? "bg-brand-50/40" : ""}`}
                      onClick={() => setOpenId(open ? null : call.id)}
                    >
                      <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-slate-600">{fmtDateTime(call.startedAt ?? call.createdAt)}</td>
                      <td className="whitespace-nowrap py-2.5 pr-3">
                        <span className="flex items-center gap-1.5 text-xs text-slate-700">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorOf(call.agentId) }} aria-hidden />
                          {agent?.name ?? "—"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-slate-600">{CALL_TYPE_LABEL[call.type ?? ""] ?? call.type ?? "—"}</td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-slate-600">{call.customerNumber ?? "—"}</td>
                      <td className="max-w-xs py-2.5 pr-3 text-xs text-slate-700">
                        <span className="line-clamp-2">{call.summary ?? "—"}</span>
                      </td>
                      <td className="whitespace-nowrap py-2.5 text-right text-xs tabular-nums text-slate-600">{fmtDuration(call.durationSeconds)}</td>
                      <td className="whitespace-nowrap py-2.5 pl-3 text-right">
                        <span className="inline-flex gap-1">
                          {booked ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">✓ Booket</span>
                          ) : null}
                          {call.hasRecording ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">▶ Lyd</span>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                    {open ? (
                      <tr>
                        <td colSpan={7} className="bg-slate-50 p-0">
                          <CallDetail callId={call.id} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {filtered.length > limit ? (
            <div className="pt-4 text-center">
              <button
                type="button"
                onClick={() => setLimit((l) => l + 50)}
                className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white"
              >
                Vis flere ({filtered.length - limit} tilbage)
              </button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function CallDetail({ callId }: { callId: string }) {
  const { callUrl, fmtCost, pricing } = useVariant();
  const [detail, setDetail] = useState<DashboardCallDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(callUrl(callId), { cache: "no-store" });
      if (cancelled) return;
      if (!res.ok) {
        setError(await readError(res, "Samtalen kunne ikke hentes."));
        return;
      }
      setDetail(((await res.json()) as { call: DashboardCallDetail }).call);
    })();
    return () => {
      cancelled = true;
    };
  }, [callId, callUrl]);

  if (error) return <p className="p-5 text-sm text-red-600">{error}</p>;
  if (!detail) return <p className="p-5 text-sm text-slate-500">Henter transskription og optagelse…</p>;

  return (
    <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Optagelse</h3>
          {detail.recordingUrl ? (
            <>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls preload="metadata" src={detail.recordingUrl} className="mt-2 w-full" />
              <a
                href={`${detail.recordingUrl}?download=1`}
                download
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                ⬇ Download optagelsen
              </a>
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-500">Ingen optagelse for denne samtale.</p>
          )}
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resumé</h3>
          <p className="mt-1 text-sm text-slate-700">{detail.summary ?? "Intet resumé."}</p>
        </div>
        {detail.bookings.length > 0 ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bookinger i samtalen</h3>
            <ul className="mt-1 space-y-1.5">
              {detail.bookings.map((b, i) => (
                <li key={i} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                  <span className={`font-semibold ${b.success ? "text-emerald-700" : "text-red-700"}`}>
                    {b.success ? "✓" : "✕"} {BOOKING_KIND_LABEL[b.kind]}
                  </span>{" "}
                  {b.appointmentTime ? fmtDateTime(b.appointmentTime) : ""} {b.customerName ? `· ${b.customerName}` : ""}{" "}
                  {b.customerEmail ? `· ${b.customerEmail}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <dt className="text-slate-500">Afslutning</dt>
          <dd className="text-slate-800">{detail.endedReason ? reasonLabel(detail.endedReason) : "—"}</dd>
          <dt className="text-slate-500">{pricing ? "Pris" : "Omkostning"}</dt>
          <dd className="text-slate-800">{fmtCost(detail.cost)}</dd>
          {detail.successEvaluation ? (
            <>
              <dt className="text-slate-500">Vapi-evaluering</dt>
              <dd className="text-slate-800">{detail.successEvaluation}</dd>
            </>
          ) : null}
          <dt className="text-slate-500">Call ID</dt>
          <dd className="truncate font-mono text-[10px] text-slate-600">{detail.id}</dd>
        </dl>
      </div>
      <div className="lg:col-span-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Transskription</h3>
        {detail.transcript.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">Ingen transskription.</p>
        ) : (
          <div className="mt-2 max-h-96 space-y-2 overflow-y-auto pr-1">
            {detail.transcript.map((line, i) => (
              <div key={i} className={`flex ${line.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    line.role === "user" ? "rounded-br-sm bg-brand-600 text-white" : "rounded-bl-sm border border-slate-200 bg-white text-slate-800"
                  }`}
                >
                  <p className={`mb-0.5 text-[10px] font-semibold ${line.role === "user" ? "text-brand-100" : "text-slate-400"}`}>
                    {line.role === "user" ? "Kunde" : "Agent"}
                    {line.secondsFromStart !== null ? ` · ${fmtDuration(line.secondsFromStart)}` : ""}
                  </p>
                  {line.text}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

function Bookings({ calls, agents, colorOf }: { calls: DashboardCall[]; agents: DashboardAgent[]; colorOf: (id: string) => string }) {
  const bookings = calls.flatMap((c) => c.bookings);
  return (
    <Card title="Bookinger foretaget af agenterne">
      {bookings.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Ingen bookinger i perioden.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-2 font-medium">Samtale</th>
                <th className="py-2 font-medium">Agent</th>
                <th className="py-2 font-medium">Handling</th>
                <th className="py-2 font-medium">Tidspunkt</th>
                <th className="py-2 font-medium">Navn</th>
                <th className="py-2 font-medium">Email</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bookings.map((b, i) => (
                <tr key={`${b.callId}-${i}`} title={b.result ?? undefined}>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-slate-600">{fmtDateTime(b.at)}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorOf(b.agentId) }} aria-hidden />
                      {agents.find((a) => a.id === b.agentId)?.name ?? "—"}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-slate-700">{BOOKING_KIND_LABEL[b.kind]}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-slate-700">{b.appointmentTime ? fmtDateTime(b.appointmentTime) : "—"}</td>
                  <td className="py-2.5 pr-3 text-xs text-slate-700">{b.customerName ?? "—"}</td>
                  <td className="py-2.5 pr-3 text-xs text-slate-700">{b.customerEmail ?? "—"}</td>
                  <td className="py-2.5 text-xs">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        b.success ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                      }`}
                    >
                      {b.success ? "✓ Gennemført" : "✕ Fejlet"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Agents & settings
// ---------------------------------------------------------------------------

function AgentSettings({
  agents,
  colorOf,
  onChanged,
}: {
  agents: DashboardAgent[];
  colorOf: (id: string) => string;
  onChanged: (agents: DashboardAgent[]) => void;
}) {
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<DashboardChannel>("outbound");
  const [assistantId, setAssistantId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/aibooking-dashboard/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, channel, vapiAssistantId: assistantId }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(await readError(res, "Agenten kunne ikke tilføjes."));
      return;
    }
    const { agent } = (await res.json()) as { agent: DashboardAgent };
    setName("");
    setAssistantId("");
    onChanged([...agents, agent]);
  }

  return (
    <div className="space-y-6">
      <Card title="Agenter på dashboardet">
        <p className="mb-4 text-xs text-slate-500">
          Ændring af et Vapi ID ændrer kun hvilke samtaler dashboardet viser. Brug &quot;Tilpas agent&quot; for at ændre selve agenten i
          Vapi — første besked, prompt, og om den lægger på, når kunden siger farvel.
        </p>
        <div className="space-y-3">
          {agents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              color={colorOf(agent.id)}
              onSaved={(updated) => onChanged(agents.map((a) => (a.id === updated.id ? updated : a)))}
              onRemoved={() => onChanged(agents.filter((a) => a.id !== agent.id))}
            />
          ))}
          {agents.length === 0 ? <p className="text-sm text-slate-500">Ingen agenter endnu.</p> : null}
        </div>
      </Card>

      <Card title="Tilføj agent">
        <form onSubmit={add} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_160px_1.4fr_auto] md:items-end">
          <label className="text-xs font-medium text-slate-600">
            Navn
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Fx Outbound (salg)"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Type
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as DashboardChannel)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="widget">Widget</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Vapi assistent-ID
            <input
              required
              value={assistantId}
              onChange={(e) => setAssistantId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? "Tjekker…" : "Tilføj"}
          </button>
        </form>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </Card>
    </div>
  );
}

function AgentRow({
  agent,
  color,
  onSaved,
  onRemoved,
}: {
  agent: DashboardAgent;
  color: string;
  onSaved: (agent: DashboardAgent) => void;
  onRemoved: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [assistantId, setAssistantId] = useState(agent.vapi_assistant_id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const dirty = name !== agent.name || assistantId !== agent.vapi_assistant_id;

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch(`/api/admin/aibooking-dashboard/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      setError(await readError(res, "Ændringen kunne ikke gemmes."));
      return;
    }
    setSaved(true);
    onSaved(((await res.json()) as { agent: DashboardAgent }).agent);
  }

  async function remove() {
    if (!window.confirm(`Fjern "${agent.name}" fra dashboardet? Selve agenten i Vapi påvirkes ikke.`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/aibooking-dashboard/agents/${agent.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError(await readError(res, "Agenten kunne ikke fjernes."));
      return;
    }
    onRemoved();
  }

  return (
    <div className={`rounded-xl border p-4 ${agent.is_active ? "border-slate-200" : "border-dashed border-slate-300 bg-slate-50"}`}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[auto_1fr_1.4fr_auto] md:items-end">
        <div className="flex items-center gap-2 md:pb-2">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} aria-hidden />
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
            {CHANNEL_LABEL[agent.channel]}
          </span>
        </div>
        <label className="text-xs font-medium text-slate-600">
          Navn
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-medium text-slate-600">
          {agent.channel === "widget" ? "Widget ID (Vapi)" : agent.channel === "inbound" ? "Inbound ID (Vapi)" : "Outbound ID (Vapi)"}
          <input
            value={assistantId}
            onChange={(e) => setAssistantId(e.target.value.trim())}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={() =>
              void patch({
                ...(name !== agent.name ? { name } : {}),
                ...(assistantId !== agent.vapi_assistant_id ? { vapiAssistantId: assistantId } : {}),
              })
            }
            className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
          >
            Gem
          </button>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
              editing ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            {editing ? "Luk" : "Tilpas agent"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void patch({ isActive: !agent.is_active })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {agent.is_active ? "Deaktivér" : "Aktivér"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
          >
            Fjern
          </button>
        </div>
      </div>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      {saved && !error ? <p className="mt-2 text-xs text-emerald-700">✓ Gemt</p> : null}
      {editing ? <AssistantEditor agentId={agent.id} key={agent.vapi_assistant_id} /> : null}
    </div>
  );
}

// The assistant itself, as it is in Vapi: what it says first, its prompt,
// whether it hangs up on goodbye, and its time limits. Saved straight to
// Vapi — these are the platform's own hand-built assistants, which "Vapi
// resync" never touches.
function AssistantEditor({ agentId }: { agentId: string }) {
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [draft, setDraft] = useState<AssistantConfig | null>(null);
  const [linkedWidget, setLinkedWidget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const url = `/api/admin/aibooking-dashboard/agents/${agentId}/assistant`;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(url, { cache: "no-store" });
      if (cancelled) return;
      if (!res.ok) {
        setError(await readError(res, "Agenten kunne ikke hentes fra Vapi."));
        return;
      }
      const data = (await res.json()) as { config: AssistantConfig; linkedWidget: string | null };
      setConfig(data.config);
      setDraft(data.config);
      setLinkedWidget(data.linkedWidget);
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error && !draft) return <p className="mt-4 text-sm text-red-600">{error}</p>;
  if (!draft || !config) return <p className="mt-4 text-sm text-slate-500">Henter agenten fra Vapi…</p>;

  const set = <K extends keyof AssistantConfig>(key: K, value: AssistantConfig[K]) => {
    setSaved(false);
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  };
  const changed = (
    ["firstMessage", "systemPrompt", "endCallOnGoodbye", "endCallMessage", "silenceTimeoutSeconds", "maxDurationSeconds"] as const
  ).filter((key) => draft[key] !== config[key]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const body = Object.fromEntries(changed.map((key) => [key, draft[key]]));
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      setError(await readError(res, "Ændringen kunne ikke gemmes i Vapi."));
      return;
    }
    const { config: next } = (await res.json()) as { config: AssistantConfig };
    setConfig(next);
    setDraft(next);
    setSaved(true);
  }

  const secondsField = (label: string, key: "silenceTimeoutSeconds" | "maxDurationSeconds", hint: string) => (
    <label className="text-xs font-medium text-slate-600">
      {label}
      <input
        type="number"
        min={10}
        value={draft[key] ?? ""}
        placeholder="Vapi-standard"
        onChange={(e) => set(key, e.target.value === "" ? null : Math.round(Number(e.target.value)))}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <span className="mt-0.5 block text-[11px] font-normal text-slate-400">{hint}</span>
    </label>
  );

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
        {draft.vapiName ? <span className="rounded-full bg-white px-2 py-0.5">Vapi: {draft.vapiName}</span> : null}
        {draft.modelLabel ? <span className="rounded-full bg-white px-2 py-0.5">Model: {draft.modelLabel}</span> : null}
        {draft.voiceLabel ? <span className="rounded-full bg-white px-2 py-0.5">Stemme: {draft.voiceLabel}</span> : null}
        <span className="rounded-full bg-white px-2 py-0.5">Sprog: {draft.language}</span>
      </div>
      {linkedWidget ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ! Denne assistent styres også af agenten &quot;{linkedWidget}&quot; i platformen. Dens prompt og værktøjer bliver skrevet over,
          næste gang den agent gemmes eller &quot;Vapi resync&quot; køres — ret den hellere dér.
        </p>
      ) : null}

      <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={draft.endCallOnGoodbye}
          disabled={draft.endCallFromSavedTool}
          onChange={(e) => set("endCallOnGoodbye", e.target.checked)}
        />
        <span>
          <span className="block text-sm font-semibold text-slate-800">Læg på, når kunden siger farvel</span>
          <span className="block text-xs text-slate-500">
            Agenten siger en kort afskedshilsen og afslutter opkaldet, når kunden siger farvel eller beder om at afslutte.
            {draft.endCallFromSavedTool ? " (Slået til via et gemt værktøj i Vapi — slås fra dér.)" : ""}
          </span>
        </span>
      </label>

      <label className="block text-xs font-medium text-slate-600">
        Første besked
        <input
          value={draft.firstMessage}
          onChange={(e) => set("firstMessage", e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-xs font-medium text-slate-600">
        Prompt (systeminstruks)
        <textarea
          value={draft.systemPrompt}
          onChange={(e) => set("systemPrompt", e.target.value)}
          rows={14}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs leading-relaxed"
        />
        <span className="mt-0.5 block text-[11px] font-normal text-slate-400">
          Instruksen om at lægge på ved farvel tilføjes automatisk, når den er slået til.
        </span>
      </label>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="text-xs font-medium text-slate-600">
          Besked når agenten lægger på
          <input
            value={draft.endCallMessage}
            onChange={(e) => set("endCallMessage", e.target.value)}
            placeholder="Tom = agentens egen afsked"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        {secondsField("Læg på efter stilhed (sek.)", "silenceTimeoutSeconds", "Hvor længe der må være stille")}
        {secondsField("Maks. samtalelængde (sek.)", "maxDurationSeconds", "Fx 600 = 10 minutter")}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving || changed.length === 0}
          onClick={() => void save()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
        >
          {saving ? "Gemmer i Vapi…" : "Gem i Vapi"}
        </button>
        {changed.length > 0 ? (
          <button
            type="button"
            onClick={() => setDraft(config)}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800"
          >
            Fortryd ændringer
          </button>
        ) : null}
        {saved ? <span className="text-xs text-emerald-700">✓ Gemt i Vapi</span> : null}
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>
    </div>
  );
}
