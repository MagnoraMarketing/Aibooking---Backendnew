import "server-only";
import type Stripe from "stripe";
import { getStripeClient } from "./stripe-client";
import { getAdminClient } from "@/lib/database/admin";
import type { Customer, Package } from "@/types/database";

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

// Exported for other one-off/add-on Stripe purchases (e.g. buying a phone
// number, see lib/phone-numbers) that need a Stripe customer to exist but
// aren't the main package checkout below.
export async function ensureStripeCustomer(customer: Customer): Promise<string> {
  if (customer.stripe_customer_id) return customer.stripe_customer_id;

  const stripe = getStripeClient();
  const stripeCustomer = await stripe.customers.create({
    email: customer.email,
    name: customer.name,
    metadata: { aibooking_customer_id: customer.id },
  });

  const supabase = getAdminClient();
  await supabase
    .from("customers")
    .update({ stripe_customer_id: stripeCustomer.id })
    .eq("id", customer.id);

  return stripeCustomer.id;
}

// Every package renews on the 1st of the month, prepaid, regardless of the
// day someone actually checks out — Stripe bills a prorated amount for the
// partial first period up front (proration_behavior: "create_prorations")
// and then settles into the 1st-of-month cadence from there.
function nextBillingCycleAnchor(): number {
  const now = new Date();
  const nextMonthFirst = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0);
  return Math.floor(nextMonthFirst / 1000);
}

export async function createCheckoutSession(params: {
  customer: Customer;
  pkg: Package;
}): Promise<{ url: string }> {
  if (!params.pkg.stripe_price_id) {
    throw new Error(`Package "${params.pkg.package_name}" has no stripe_price_id configured`);
  }

  const stripe = getStripeClient();
  const stripeCustomerId = await ensureStripeCustomer(params.customer);
  const appUrl = getAppUrl();

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { price: params.pkg.stripe_price_id, quantity: 1 },
  ];

  // A one-time setup/onboarding fee, billed alongside the first invoice —
  // no pre-created Stripe Price needed, unlike the recurring price above
  // (which admin configures per package), since this only ever needs to
  // exist as this one line item on this one session.
  if (params.pkg.setup_fee && params.pkg.setup_fee > 0) {
    lineItems.push({
      price_data: {
        currency: params.pkg.currency.toLowerCase(),
        unit_amount: Math.round(params.pkg.setup_fee * 100),
        product_data: { name: `${params.pkg.package_name}: opsætning og onboarding` },
      },
      quantity: 1,
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomerId,
    line_items: lineItems,
    success_url: `${appUrl}/dashboard/billing?checkout=success`,
    cancel_url: `${appUrl}/dashboard/billing?checkout=cancelled`,
    metadata: {
      aibooking_customer_id: params.customer.id,
      aibooking_package_id: params.pkg.id,
    },
    subscription_data: {
      billing_cycle_anchor: nextBillingCycleAnchor(),
      proration_behavior: "create_prorations",
      metadata: {
        aibooking_customer_id: params.customer.id,
        aibooking_package_id: params.pkg.id,
      },
    },
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return { url: session.url };
}

export async function createBillingPortalSession(customer: Customer): Promise<{ url: string }> {
  if (!customer.stripe_customer_id) {
    throw new Error("Customer has no Stripe customer yet — complete checkout first");
  }

  const stripe = getStripeClient();
  const appUrl = getAppUrl();

  const session = await stripe.billingPortal.sessions.create({
    customer: customer.stripe_customer_id,
    return_url: `${appUrl}/dashboard/billing`,
  });

  return { url: session.url };
}
