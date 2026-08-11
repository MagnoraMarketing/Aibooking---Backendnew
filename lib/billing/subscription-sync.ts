import "server-only";
import type Stripe from "stripe";
import { getAdminClient } from "@/lib/database/admin";
import { grantCredits } from "@/lib/credits/ledger";

// Stripe is the source of truth for payment status; these functions just
// mirror that state into our local `subscriptions` table and, on payment,
// top up the customer's credit ledger. Everything here is idempotent with
// respect to a given Stripe event (see /api/webhooks/stripe for the
// dedup check via the stripe_events table).

export async function syncSubscriptionFromStripe(subscription: Stripe.Subscription): Promise<void> {
  const supabase = getAdminClient();

  const customerId = subscription.metadata?.aibooking_customer_id;
  if (!customerId) return; // not a subscription created by this platform

  let packageId = subscription.metadata?.aibooking_package_id ?? null;

  if (!packageId) {
    const priceId = subscription.items.data[0]?.price?.id;
    if (priceId) {
      const { data: pkg } = await supabase
        .from("packages")
        .select("id")
        .eq("stripe_price_id", priceId)
        .maybeSingle();
      packageId = pkg?.id ?? null;
    }
  }

  if (!packageId) {
    throw new Error(`Cannot resolve a package for Stripe subscription ${subscription.id}`);
  }

  const stripeCustomerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const { error } = await supabase.from("subscriptions").upsert(
    {
      customer_id: customerId,
      package_id: packageId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: stripeCustomerId,
      status: subscription.status,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
    },
    { onConflict: "stripe_subscription_id" }
  );

  if (error) throw new Error(`Failed to sync subscription: ${error.message}`);
}

export async function markSubscriptionCanceled(subscription: Stripe.Subscription): Promise<void> {
  const supabase = getAdminClient();
  await supabase
    .from("subscriptions")
    .update({ status: "canceled", cancel_at_period_end: false })
    .eq("stripe_subscription_id", subscription.id);
}

// Called on invoice.paid — allocates a fresh block of included minutes for
// the billing period that was just paid for (initial signup, monthly
// renewal, or an automatic overage top-up invoice).
export async function grantCreditsForPaidInvoice(params: {
  stripeSubscriptionId: string;
  stripeEventId: string;
}): Promise<void> {
  const supabase = getAdminClient();

  const { data: subscription, error: subError } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("stripe_subscription_id", params.stripeSubscriptionId)
    .maybeSingle();

  if (subError) throw new Error(`Failed to load subscription: ${subError.message}`);
  if (!subscription) {
    throw new Error(`No local subscription found for Stripe subscription ${params.stripeSubscriptionId}`);
  }

  const { data: pkg, error: pkgError } = await supabase
    .from("packages")
    .select("*")
    .eq("id", subscription.package_id)
    .maybeSingle();

  if (pkgError) throw new Error(`Failed to load package: ${pkgError.message}`);
  if (!pkg) throw new Error(`Package ${subscription.package_id} not found`);

  await grantCredits({
    customerId: subscription.customer_id,
    seconds: pkg.included_minutes * 60,
    description: `${pkg.package_name}: ${pkg.included_minutes} minutter tilføjet`,
    stripeEventId: params.stripeEventId,
  });
}
