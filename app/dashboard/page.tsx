import Link from "next/link";
import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { getCustomerEconomics, getUsageByAgentType } from "@/lib/analytics";
import { StatCard } from "@/components/dashboard/stat-card";
import { SessionsTable, type SessionRow } from "@/components/dashboard/sessions-table";
import { AppointmentsList } from "@/components/dashboard/appointments-list";
import type { Appointment, Conversation, Widget } from "@/types/database";
import { translate } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";

export const dynamic = "force-dynamic";

const RECENT_CONVERSATIONS_LIMIT = 50;
const RECENTLY_USED_WIDGETS_LIMIT = 5;

const ICONS = {
  conversations: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} stroke="currentColor" className="h-5 w-5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z"
      />
    </svg>
  ),
  widgets: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} stroke="currentColor" className="h-5 w-5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.752.43.991l1.005.828c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.752-.43-.991l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.213-1.28Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  ),
  minutesUsed: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} stroke="currentColor" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  ),
  minutesRemaining: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} stroke="currentColor" className="h-5 w-5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.75h.007v.008H12v-.008Z" />
    </svg>
  ),
};

export default async function DashboardPage() {
  const ctx = await requireCustomerAdminForPage();
  const locale = isLocale(ctx.profile.language) ? ctx.profile.language : DEFAULT_LOCALE;
  const t = (key: string) => translate(locale, key);
  const customerId = ctx.profile.customer_id!;
  const supabase = getAdminClient();

  const [economics, usageByType, { data: widgetsData }, { data: conversationsData }, { data: appointmentsData }] =
    await Promise.all([
      getCustomerEconomics(customerId),
      getUsageByAgentType(customerId),
      supabase.from("widgets").select("*").eq("customer_id", customerId).returns<Widget[]>(),
      supabase
        .from("conversations")
        .select("*")
        .eq("customer_id", customerId)
        .order("started_at", { ascending: false })
        .limit(RECENT_CONVERSATIONS_LIMIT)
        .returns<Conversation[]>(),
      supabase
        .from("appointments")
        .select("*")
        .eq("customer_id", customerId)
        .order("appointment_time", { ascending: false })
        .limit(10)
        .returns<Appointment[]>(),
    ]);

  const widgets = widgetsData ?? [];
  const conversations = conversationsData ?? [];
  const conversationIds = conversations.map((c) => c.id);

  const { data: usageSessionsData } = conversationIds.length
    ? await supabase
        .from("usage_sessions")
        .select("conversation_id, billed_duration_seconds")
        .in("conversation_id", conversationIds)
        .returns<{ conversation_id: string | null; billed_duration_seconds: number }[]>()
    : { data: [] as { conversation_id: string | null; billed_duration_seconds: number }[] };

  const minutesByConversation = new Map<string, number>();
  for (const session of usageSessionsData ?? []) {
    if (!session.conversation_id) continue;
    const prior = minutesByConversation.get(session.conversation_id) ?? 0;
    minutesByConversation.set(session.conversation_id, prior + session.billed_duration_seconds / 60);
  }

  const widgetsById = new Map(widgets.map((w) => [w.id, w]));

  const sessions: SessionRow[] = conversations.map((conversation) => ({
    id: conversation.id,
    widgetName: widgetsById.get(conversation.widget_id)?.name ?? t("dashboardPages.shared.unknownWidget"),
    startedAt: conversation.started_at,
    status: conversation.status,
    minutesUsed: minutesByConversation.get(conversation.id) ?? 0,
  }));

  const recentlyUsedWidgetIds: string[] = [];
  for (const conversation of conversations) {
    if (!recentlyUsedWidgetIds.includes(conversation.widget_id)) {
      recentlyUsedWidgetIds.push(conversation.widget_id);
    }
    if (recentlyUsedWidgetIds.length >= RECENTLY_USED_WIDGETS_LIMIT) break;
  }
  const recentlyUsedWidgets = recentlyUsedWidgetIds
    .map((id) => widgetsById.get(id))
    .filter((w): w is Widget => Boolean(w));

  const activeWidgetsCount = widgets.filter((w) => w.status === "active").length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">Følg jeres AI-widgets&apos; performance</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Samtaler i alt" value={String(economics.totalConversations)} icon={ICONS.conversations} />
        <StatCard label="Aktive widgets" value={String(activeWidgetsCount)} icon={ICONS.widgets} />
        <StatCard label="Minutter brugt" value={economics.minutesUsed.toFixed(2)} icon={ICONS.minutesUsed} />
        <StatCard
          label="Minutter tilbage"
          value={economics.minutesRemaining.toFixed(2)}
          icon={ICONS.minutesRemaining}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Voice Widget</h2>
            <Link href="/dashboard/agent" className="text-xs font-medium text-brand-600 hover:text-brand-700">
              Se agenter →
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-lg font-semibold text-slate-900">{usageByType.widget.activeAgents}</p>
              <p className="text-[11px] text-slate-500">Aktive agenter</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-900">{usageByType.widget.totalConversations}</p>
              <p className="text-[11px] text-slate-500">Samtaler</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-900">{usageByType.widget.minutesUsed.toFixed(1)}</p>
              <p className="text-[11px] text-slate-500">Minutter</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Telefon (Inbound/Outbound)</h2>
            <Link href="/dashboard/inbound" className="text-xs font-medium text-brand-600 hover:text-brand-700">
              Se agenter →
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-lg font-semibold text-slate-900">{usageByType.phone.activeAgents}</p>
              <p className="text-[11px] text-slate-500">Aktive agenter</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-900">{usageByType.phone.totalConversations}</p>
              <p className="text-[11px] text-slate-500">Opkald</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-900">{usageByType.phone.minutesUsed.toFixed(1)}</p>
              <p className="text-[11px] text-slate-500">Minutter</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Seneste samtaler</h2>
          <SessionsTable sessions={sessions} />
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">Senest brugte widgets</h2>
            <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
              {recentlyUsedWidgets.length === 0 ? (
                <p className="p-3 text-sm text-slate-500">Ingen widgets brugt endnu.</p>
              ) : (
                <ul className="space-y-1">
                  {recentlyUsedWidgets.map((widget) => (
                    <li key={widget.id}>
                      <Link
                        href={`/dashboard/agent/${widget.id}`}
                        className="block rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {widget.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">Bookinger</h2>
            <AppointmentsList appointments={appointmentsData ?? []} />
          </div>
        </div>
      </div>
    </div>
  );
}
