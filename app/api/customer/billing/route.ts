import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling } from "@/lib/security";
import { getBalanceSeconds } from "@/lib/credits";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const [{ data: subscription }, balanceSeconds, { data: availablePackages }] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("*, packages(*)")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getBalanceSeconds(customerId),
    supabase.from("packages").select("*").eq("active", true).order("monthly_price", { ascending: true }),
  ]);

  return NextResponse.json({
    subscription,
    balanceSeconds,
    balanceMinutes: Math.round((balanceSeconds / 60) * 100) / 100,
    availablePackages,
  });
});
