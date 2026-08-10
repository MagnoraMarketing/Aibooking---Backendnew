import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { getBalanceSeconds, grantCredits } from "./ledger";
import { chargeOverageBlock } from "@/lib/billing/overage";
import type { Customer, Package, Subscription } from "@/types/database";

export interface RefillResult {
  balanceSeconds: number;
  refilled: boolean;
  reason?: string;
}

// Section 6 flow:
// 1. balance <= 0 detected
// 2. Stripe is checked (subscription must be active/trialing; card gets charged for one overage block)
// 3. if approved: new credit allocation + transaction log entry
// 4. customer can continue without manual action
//
// If the subscription isn't in good standing, or the card charge fails,
// we do NOT grant credits — the caller should surface a "please add
// minutes / update payment method" state instead.
export async function checkAndRefillIfNeeded(customerId: string): Promise<RefillResult> {
  const balance = await getBalanceSeconds(customerId);
  if (balance > 0) return { balanceSeconds: balance, refilled: false };

  const supabase = getAdminClient();

  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .maybeSingle<Customer>();

  if (!customer || customer.status !== "active") {
    return { balanceSeconds: balance, refilled: false, reason: "customer_inactive" };
  }

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Subscription>();

  if (!subscription || !["active", "trialing"].includes(subscription.status)) {
    return { balanceSeconds: balance, refilled: false, reason: "no_active_subscription" };
  }

  const { data: pkg } = await supabase
    .from("packages")
    .select("*")
    .eq("id", subscription.package_id)
    .maybeSingle<Package>();

  if (!pkg || !pkg.active) {
    return { balanceSeconds: balance, refilled: false, reason: "package_unavailable" };
  }

  const charge = await chargeOverageBlock({ customer, pkg });
  if (!charge.success) {
    return { balanceSeconds: balance, refilled: false, reason: charge.failureReason ?? "payment_failed" };
  }

  await grantCredits({
    customerId,
    seconds: pkg.included_minutes * 60,
    description: `Automatisk tilkøb: ${pkg.included_minutes} minutter (${pkg.package_name})`,
    stripeEventId: charge.stripeEventHintId,
  });

  const newBalance = await getBalanceSeconds(customerId);
  return { balanceSeconds: newBalance, refilled: true };
}
