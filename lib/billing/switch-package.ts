import "server-only";
import { getStripeClient } from "./stripe-client";
import { resolveStripePriceId } from "./checkout";
import type { Customer, Package, Subscription } from "@/types/database";
import { ApiError } from "@/types/errors";

export interface PackageSwitchResult {
  switched: true;
  subscriptionId: string;
}

// Changes an ALREADY-SUBSCRIBED customer's package by updating the existing
// Stripe subscription's price in place, rather than starting a brand new
// subscription — the previous checkout flow created a second Stripe
// subscription on every "buy a different package" click, which meant a
// customer switching from Starter to Professional got billed for both
// (spec section 17: "ingen dobbeltbetaling, ingen dobbelt minutter").
//
// Proration is Stripe's own (create_prorations): the customer is charged or
// credited the difference for the remainder of the current period
// immediately. The new package's included_minutes are deliberately NOT
// granted here — subscriptions.package_id only changes once the
// customer.subscription.updated webhook re-syncs (see
// lib/billing/subscription-sync.ts), and the next invoice.paid is what
// grants minutes for the new package, exactly like any other renewal. That
// is "next cycle" per spec, using the existing billing/usage logic as-is
// rather than a special case.
export async function switchSubscriptionPackage(params: {
  customer: Customer;
  currentSubscription: Subscription;
  newPackage: Package;
}): Promise<PackageSwitchResult> {
  const { customer, currentSubscription, newPackage } = params;

  if (!currentSubscription.stripe_subscription_id) {
    throw ApiError.badRequest("Det nuværende abonnement har intet Stripe-abonnement at opdatere.");
  }

  const stripe = getStripeClient();
  const stripeSubscription = await stripe.subscriptions.retrieve(currentSubscription.stripe_subscription_id);
  const currentItem = stripeSubscription.items.data[0];
  if (!currentItem) {
    throw ApiError.internal("Stripe-abonnementet har ingen linjer at opdatere.");
  }

  const newPriceId = await resolveStripePriceId(newPackage);

  await stripe.subscriptions.update(stripeSubscription.id, {
    items: [{ id: currentItem.id, price: newPriceId }],
    proration_behavior: "create_prorations",
    metadata: {
      aibooking_customer_id: customer.id,
      aibooking_package_id: newPackage.id,
    },
  });

  return { switched: true, subscriptionId: stripeSubscription.id };
}
