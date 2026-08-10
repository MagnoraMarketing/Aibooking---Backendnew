import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import type { Package } from "@/types/database";

export interface CustomerEconomics {
  customerId: string;
  minutesUsed: number;
  minutesRemaining: number;
  totalConversations: number;
  averageConversationDurationSeconds: number;
  currentMonthlyPrice: number;
  currentPackageName: string | null;
  includedMinutes: number | null;
  currency: string;
  estimatedLlmCost: number;
  estimatedTtsCost: number;
  estimatedTotalCost: number;
  grossContribution: number;
}

export async function getCustomerEconomics(customerId: string): Promise<CustomerEconomics> {
  const supabase = getAdminClient();

  const [{ data: sessions }, { count: conversationCount }, { data: creditAccount }, { data: subscription }] =
    await Promise.all([
      supabase
        .from("usage_sessions")
        .select("billed_duration_seconds, estimated_llm_cost, estimated_tts_cost")
        .eq("customer_id", customerId),
      supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId),
      supabase.from("credit_accounts").select("balance_seconds").eq("customer_id", customerId).maybeSingle(),
      supabase
        .from("subscriptions")
        .select("*, packages(*)")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const rows = sessions ?? [];
  const totalBilledSeconds = rows.reduce((sum, r) => sum + (r.billed_duration_seconds ?? 0), 0);
  const estimatedLlmCost = rows.reduce((sum, r) => sum + Number(r.estimated_llm_cost ?? 0), 0);
  const estimatedTtsCost = rows.reduce((sum, r) => sum + Number(r.estimated_tts_cost ?? 0), 0);
  const estimatedTotalCost = estimatedLlmCost + estimatedTtsCost;

  const pkg = (subscription as { packages?: Package } | null)?.packages ?? null;
  const monthlyPrice = pkg?.monthly_price ?? 0;
  const currency = pkg?.currency ?? "DKK";
  const currentPackageName = pkg?.package_name ?? null;
  const includedMinutes = pkg?.included_minutes ?? null;

  return {
    customerId,
    minutesUsed: Math.round((totalBilledSeconds / 60) * 100) / 100,
    minutesRemaining: Math.round(((creditAccount?.balance_seconds ?? 0) / 60) * 100) / 100,
    totalConversations: conversationCount ?? 0,
    averageConversationDurationSeconds:
      rows.length > 0 ? Math.round(totalBilledSeconds / rows.length) : 0,
    currentMonthlyPrice: monthlyPrice,
    currentPackageName,
    includedMinutes,
    currency,
    estimatedLlmCost: Math.round(estimatedLlmCost * 100) / 100,
    estimatedTtsCost: Math.round(estimatedTtsCost * 100) / 100,
    estimatedTotalCost: Math.round(estimatedTotalCost * 100) / 100,
    grossContribution: Math.round((monthlyPrice - estimatedTotalCost) * 100) / 100,
  };
}
