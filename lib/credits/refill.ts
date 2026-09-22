import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { getBalanceSeconds, grantCredits } from "./ledger";
import { chargePackageRecharge } from "@/lib/billing/recharge";
import type { Customer, Package, Subscription } from "@/types/database";

export interface RefillResult {
  balanceSeconds: number;
  refilled: boolean;
  reason?: string;
}

// Section 7/13 flow:
// 1. balance <= 0 detected
// 2. Stripe is checked (subscription must be active/trialing; card gets
//    charged the package's full monthly price, exactly like a renewal)
// 3. if approved: new credit allocation + transaction log entry
// 4. customer can continue without manual action
//
// If the subscription isn't in good standing, or the card charge fails,
// we do NOT grant credits — the caller should surface a "please add
// minutes / update payment method" state instead.
//
// A concurrent duplicate call for the same customer (two requests racing
// each other right as the pool hits zero) is blocked by try_claim_recharge
// before Stripe is ever touched — see 0044_pricing_and_billing_overhaul.sql.
// The claim is always released in a finally, whether the recharge succeeded
// or failed, so a declined card doesn't permanently lock the customer out of
// retrying.
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

  // The reserved internal customer that owns AIbooking's own website
  // widget(s) (see lib/admin/aibooking-customer.ts) is never a real tenant
  // and has no Stripe subscription to recharge — an admin funds its balance
  // directly via the existing manual-credit endpoint (/api/admin/credits)
  // instead, at whatever internal cost/credit basis they choose. This never
  // touches or reads customer-facing package pricing (spec section 9).
  if (customer.is_platform_owned) {
    return { balanceSeconds: balance, refilled: false, reason: "platform_owned_needs_manual_topup" };
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

  const { data: claimed, error: claimError } = await supabase.rpc("try_claim_recharge", {
    p_customer_id: customerId,
  });
  if (claimError) throw new Error(`Failed to claim recharge attempt: ${claimError.message}`);
  if (!claimed) {
    return { balanceSeconds: balance, refilled: false, reason: "recharge_already_in_progress" };
  }

  try {
    // One key per successful claim: Stripe's SDK itself retries a request
    // that times out using this same key, so a transient network hiccup
    // mid-charge can't turn into a second charge — see chargePackageRecharge.
    const idempotencyKey = `recharge_${subscription.stripe_subscription_id ?? subscription.id}_${Date.now()}`;

    const charge = await chargePackageRecharge({ customer, pkg, idempotencyKey });
    if (!charge.success) {
      return { balanceSeconds: balance, refilled: false, reason: charge.failureReason ?? "payment_failed" };
    }

    await grantCredits({
      customerId,
      seconds: pkg.included_minutes * 60,
      description: `Automatisk fornyelse: ${pkg.included_minutes} minutter (${pkg.package_name})`,
      stripeEventId: charge.stripeEventHintId,
    });

    const newBalance = await getBalanceSeconds(customerId);
    return { balanceSeconds: newBalance, refilled: true };
  } finally {
    await supabase.from("credit_accounts").update({ recharge_pending_at: null }).eq("customer_id", customerId);
  }
}

// The central "can this customer's agent take a call/session right now"
// check the spec asks for as canUserMakeCall — a thin, explicitly-named
// wrapper over the same trial-or-subscription-and-balance logic every
// call/session-start route already runs inline via checkAndRefillIfNeeded
// (auto-recharging on the way if the pool is exhausted). Server-side only,
// by construction: it needs the service-role database client.
export async function canUserMakeCall(customerId: string): Promise<boolean> {
  const result = await checkAndRefillIfNeeded(customerId);
  return result.balanceSeconds > 0;
}
