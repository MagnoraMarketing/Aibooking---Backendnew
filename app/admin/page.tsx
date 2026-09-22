import { requireMasterAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { AdminStatCard } from "@/components/admin/stat-card";
import { translate } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";
import type { AuditLog } from "@/types/database";

export const dynamic = "force-dynamic";

interface SystemCheck {
  label: string;
  ok: boolean;
}

function checkSystemStatus(): SystemCheck[] {
  return [
    { label: "Vapi", ok: Boolean(process.env.VAPI_PRIVATE_KEY && process.env.VAPI_PUBLIC_KEY) },
    { label: "Twilio", ok: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) },
    { label: "Stripe", ok: Boolean(process.env.STRIPE_SECRET_KEY) },
    { label: "Supabase", ok: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) },
    { label: "Cal.com", ok: Boolean(process.env.CALCOM_CLIENT_ID && process.env.CALCOM_CLIENT_SECRET) },
  ];
}

// Overview dashboard — spec section 1. A genuinely separate page from
// "Kunder" (moved to /admin/customers), so it can show platform-wide counts
// that span every resource this Control Center manages, not just customers.
export default async function AdminOverviewPage() {
  const ctx = await requireMasterAdminForPage();
  const locale = isLocale(ctx.profile.language) ? ctx.profile.language : DEFAULT_LOCALE;
  const supabase = getAdminClient();

  const [
    { count: activeCustomers },
    { count: activeWidgets },
    { count: inboundAgents },
    { count: voiceWidgets },
    { count: wapiAgents },
    { count: phoneNumbers },
    { data: recentActivity },
  ] = await Promise.all([
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .eq("is_platform_owned", false),
    supabase.from("widgets").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("widgets").select("id", { count: "exact", head: true }).eq("agent_type", "phone"),
    supabase.from("widgets").select("id", { count: "exact", head: true }).eq("agent_type", "widget"),
    supabase.from("wapi_agents").select("id", { count: "exact", head: true }),
    supabase.from("phone_numbers").select("id", { count: "exact", head: true }).eq("purchase_status", "active"),
    supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10)
      .returns<AuditLog[]>(),
  ]);

  const systemStatus = checkSystemStatus();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{translate(locale, "adminShell.nav.dashboard")}</h1>
        <p className="mt-1 text-sm text-slate-500">{translate(locale, "adminPages.overview.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <AdminStatCard label={translate(locale, "adminPages.overview.activeCustomers")} value={String(activeCustomers ?? 0)} />
        <AdminStatCard label={translate(locale, "adminPages.overview.activeWidgets")} value={String(activeWidgets ?? 0)} />
        <AdminStatCard label={translate(locale, "adminPages.overview.inboundAgents")} value={String(inboundAgents ?? 0)} />
        <AdminStatCard label={translate(locale, "adminPages.overview.voiceWidgets")} value={String(voiceWidgets ?? 0)} />
        <AdminStatCard label={translate(locale, "adminPages.overview.wapiAgents")} value={String(wapiAgents ?? 0)} />
        <AdminStatCard label={translate(locale, "adminPages.overview.phoneNumbers")} value={String(phoneNumbers ?? 0)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">{translate(locale, "adminPages.overview.recentActivity")}</h2>
          <div className="mt-3 divide-y divide-slate-100">
            {(recentActivity ?? []).length === 0 ? (
              <p className="py-4 text-sm text-slate-500">{translate(locale, "adminPages.overview.noActivity")}</p>
            ) : (
              (recentActivity ?? []).map((log) => (
                <div key={log.id} className="py-3 text-sm">
                  <p className="font-medium text-slate-800">{log.action}</p>
                  <p className="text-xs text-slate-500">
                    {log.entity_type ? `${log.entity_type} · ` : ""}
                    {new Date(log.created_at).toLocaleString(locale === "da" ? "da-DK" : "en-US")}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">{translate(locale, "adminPages.overview.systemStatus")}</h2>
          <div className="mt-3 space-y-2">
            {systemStatus.map((check) => (
              <div key={check.label} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                <span className="text-slate-700">{check.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    check.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                  }`}
                >
                  {check.ok
                    ? translate(locale, "adminPages.overview.statusOk")
                    : translate(locale, "adminPages.overview.statusMissing")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
