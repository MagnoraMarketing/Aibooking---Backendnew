import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import type { Package } from "@/types/database";
import type { DashboardAgent, DashboardCall } from "./calls";

// The same dashboard as the platform's own (./service.ts), for one customer:
// their agents instead of the platform's, and what the calls cost them at
// their package's minute price instead of what Vapi charged us. Vapi's cost
// is never sent to a customer — every call's `cost` is replaced here before
// it leaves the server.

export interface CustomerPricing {
  packageName: string | null;
  // Kroner per minute of talk, from the customer's package. Follows the
  // package automatically: change the price in Pricing, or move the
  // customer to another package, and the dashboard follows.
  pricePerMinute: number;
  currency: string;
  monthlyPrice: number | null;
  includedMinutes: number | null;
  minutesRemaining: number;
}

// The package's own minute price where one is set (what top-ups are charged
// at — see Pricing in the admin), else the monthly price spread over the
// included minutes.
export function minutePriceOf(pkg: Pick<Package, "overage_price_per_minute" | "monthly_price" | "included_minutes"> | null): number {
  if (!pkg) return 0;
  const overage = Number(pkg.overage_price_per_minute ?? 0);
  if (overage > 0) return overage;
  const included = Number(pkg.included_minutes ?? 0);
  return included > 0 ? Number(pkg.monthly_price ?? 0) / included : 0;
}

export async function loadCustomerPricing(customerId: string): Promise<CustomerPricing> {
  const supabase = getAdminClient();
  const [{ data: subscription }, { data: credit }] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("packages(*)")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("credit_accounts").select("balance_seconds").eq("customer_id", customerId).maybeSingle(),
  ]);

  let pkg = ((subscription as { packages?: Package | null } | null)?.packages ?? null) as Package | null;
  // A customer still on the free trial has no package yet: their minutes are
  // priced at the default package, which is the one they would buy.
  if (!pkg) {
    const { data } = await supabase
      .from("packages")
      .select("*")
      .eq("active", true)
      .order("is_default", { ascending: false })
      .order("monthly_price", { ascending: true })
      .limit(1)
      .maybeSingle();
    pkg = (data as Package | null) ?? null;
  }

  return {
    packageName: (subscription as { packages?: Package | null } | null)?.packages?.package_name ?? null,
    pricePerMinute: Math.round(minutePriceOf(pkg) * 100) / 100,
    currency: pkg?.currency ?? "DKK",
    monthlyPrice: pkg ? Number(pkg.monthly_price) : null,
    includedMinutes: pkg?.included_minutes ?? null,
    minutesRemaining: Math.round(((credit?.balance_seconds ?? 0) / 60) * 10) / 10,
  };
}

// The customer's agents, in the dashboard's shape: one per agent that has a
// Vapi assistant (every agent gets one when it is saved — see
// lib/vapi/ensure-assistant.ts). Paused agents are kept, so their history
// stays visible.
export async function listCustomerAgents(customerId: string): Promise<DashboardAgent[]> {
  const supabase = getAdminClient();
  const { data: widgets, error } = await supabase
    .from("widgets")
    .select("id, name, agent_type, status, created_at, updated_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = (widgets ?? []) as {
    id: string;
    name: string;
    agent_type: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  }[];
  if (rows.length === 0) return [];

  const { data: settings, error: settingsError } = await supabase
    .from("widget_settings")
    .select("widget_id, extra")
    .in(
      "widget_id",
      rows.map((w) => w.id)
    );
  if (settingsError) throw settingsError;
  const assistantByWidget = new Map<string, string>();
  for (const row of (settings ?? []) as { widget_id: string; extra: Record<string, unknown> | null }[]) {
    const id = row.extra?.vapiAssistantId;
    if (typeof id === "string" && id.trim()) assistantByWidget.set(row.widget_id, id.trim());
  }

  return rows
    .filter((w) => assistantByWidget.has(w.id))
    .map((w, index) => ({
      id: w.id,
      name: w.name,
      channel: w.agent_type === "phone" ? "inbound" : "widget",
      vapi_assistant_id: assistantByWidget.get(w.id)!,
      is_active: true,
      sort_order: index,
      created_at: w.created_at,
      updated_at: w.updated_at,
    }));
}

// What a call cost the customer: its talk time at their minute price.
export function priceCall<T extends DashboardCall>(call: T, pricePerMinute: number): T {
  return { ...call, cost: Math.round((call.durationSeconds / 60) * pricePerMinute * 100) / 100 };
}
