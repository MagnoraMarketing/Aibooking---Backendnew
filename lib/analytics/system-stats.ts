import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import type { Package } from "@/types/database";

export interface SystemStats {
  totalCustomers: number;
  activeCustomers: number;
  totalWidgets: number;
  totalMinutesUsed: number;
  totalConversations: number;
  estimatedAiCost: number;
  estimatedTtsCost: number;
  estimatedGrossMargin: number;
  mrr: number;
  currency: string;
}

export async function getSystemStats(): Promise<SystemStats> {
  const supabase = getAdminClient();

  const [
    { count: totalCustomers },
    { count: activeCustomers },
    { count: totalWidgets },
    { count: totalConversations },
    { data: sessions },
    { data: activeSubscriptions },
  ] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }).neq("status", "deleted"),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("widgets").select("id", { count: "exact", head: true }),
    supabase.from("conversations").select("id", { count: "exact", head: true }),
    supabase
      .from("usage_sessions")
      .select("billed_duration_seconds, estimated_llm_cost, estimated_tts_cost"),
    supabase
      .from("subscriptions")
      .select("*, packages(*)")
      .in("status", ["active", "trialing"]),
  ]);

  const rows = sessions ?? [];
  const totalBilledSeconds = rows.reduce((sum, r) => sum + (r.billed_duration_seconds ?? 0), 0);
  const estimatedAiCost = rows.reduce((sum, r) => sum + Number(r.estimated_llm_cost ?? 0), 0);
  const estimatedTtsCost = rows.reduce((sum, r) => sum + Number(r.estimated_tts_cost ?? 0), 0);

  const subs = (activeSubscriptions ?? []) as Array<{ packages?: Package }>;
  const mrr = subs.reduce((sum, s) => sum + Number(s.packages?.monthly_price ?? 0), 0);
  const currency = subs[0]?.packages?.currency ?? "DKK";

  return {
    totalCustomers: totalCustomers ?? 0,
    activeCustomers: activeCustomers ?? 0,
    totalWidgets: totalWidgets ?? 0,
    totalMinutesUsed: Math.round((totalBilledSeconds / 60) * 100) / 100,
    totalConversations: totalConversations ?? 0,
    estimatedAiCost: Math.round(estimatedAiCost * 100) / 100,
    estimatedTtsCost: Math.round(estimatedTtsCost * 100) / 100,
    estimatedGrossMargin: Math.round((mrr - estimatedAiCost - estimatedTtsCost) * 100) / 100,
    mrr: Math.round(mrr * 100) / 100,
    currency,
  };
}
