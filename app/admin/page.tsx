import { requireMasterAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { getSystemStats } from "@/lib/analytics";
import { ClientPortal, type AdminStats, type ClientRow } from "@/components/admin/client-portal";
import type { Customer, Package, Subscription } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireMasterAdminForPage();
  const supabase = getAdminClient();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    systemStats,
    { data: customers },
    { count: newClients30d },
    { data: creditAccounts },
    { data: widgets },
    { data: usageSessions },
    { data: subscriptions },
  ] = await Promise.all([
    getSystemStats(),
    supabase.from("customers").select("*").neq("status", "deleted").order("created_at", { ascending: false }).returns<Customer[]>(),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .neq("status", "deleted")
      .gte("created_at", thirtyDaysAgo),
    supabase
      .from("credit_accounts")
      .select("customer_id, balance_seconds")
      .returns<{ customer_id: string; balance_seconds: number }[]>(),
    supabase.from("widgets").select("customer_id, status").returns<{ customer_id: string; status: string }[]>(),
    supabase
      .from("usage_sessions")
      .select("customer_id, billed_duration_seconds")
      .returns<{ customer_id: string; billed_duration_seconds: number }[]>(),
    supabase
      .from("subscriptions")
      .select("*, packages(*)")
      .order("created_at", { ascending: false })
      .returns<(Subscription & { packages: Package | null })[]>(),
  ]);

  const balanceByCustomer = new Map<string, number>();
  for (const row of creditAccounts ?? []) {
    balanceByCustomer.set(row.customer_id, row.balance_seconds);
  }

  const widgetsByCustomer = new Map<string, { active: number; total: number }>();
  for (const w of widgets ?? []) {
    const entry = widgetsByCustomer.get(w.customer_id) ?? { active: 0, total: 0 };
    entry.total += 1;
    if (w.status === "active") entry.active += 1;
    widgetsByCustomer.set(w.customer_id, entry);
  }

  const usedSecondsByCustomer = new Map<string, number>();
  for (const s of usageSessions ?? []) {
    usedSecondsByCustomer.set(
      s.customer_id,
      (usedSecondsByCustomer.get(s.customer_id) ?? 0) + (s.billed_duration_seconds ?? 0)
    );
  }

  const latestSubscriptionByCustomer = new Map<string, Subscription & { packages: Package | null }>();
  for (const s of subscriptions ?? []) {
    if (!latestSubscriptionByCustomer.has(s.customer_id)) {
      latestSubscriptionByCustomer.set(s.customer_id, s);
    }
  }

  const clients: ClientRow[] = (customers ?? []).map((customer) => {
    const sub = latestSubscriptionByCustomer.get(customer.id);
    const widgetCounts = widgetsByCustomer.get(customer.id) ?? { active: 0, total: 0 };

    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      status: customer.status === "active" ? "active" : "inactive",
      createdAt: customer.created_at,
      creditPricePerMinute: sub?.packages?.overage_price_per_minute ?? null,
      currency: sub?.packages?.currency ?? "DKK",
      minutesRemaining: Math.round(((balanceByCustomer.get(customer.id) ?? 0) / 60) * 100) / 100,
      minutesUsed: Math.round(((usedSecondsByCustomer.get(customer.id) ?? 0) / 60) * 100) / 100,
      activeAgents: widgetCounts.active,
      totalAgents: widgetCounts.total,
    };
  });

  const totalMinutesRemaining =
    Array.from(balanceByCustomer.values()).reduce((sum, s) => sum + s, 0) / 60;

  const stats: AdminStats = {
    totalClients: systemStats.totalCustomers,
    newClients30d: newClients30d ?? 0,
    mrr: systemStats.mrr,
    grossMargin: systemStats.estimatedGrossMargin,
    totalMinutesRemaining,
    totalAgents: systemStats.totalWidgets,
    currency: systemStats.currency,
  };

  return <ClientPortal initialClients={clients} stats={stats} />;
}
