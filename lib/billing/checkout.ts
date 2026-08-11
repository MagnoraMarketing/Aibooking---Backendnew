import "server-only";
import { getStripeClient } from "./stripe-client";
import { getAdminClient } from "@/lib/database/admin";
import type { Customer, Package } from "@/types/database";

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

async function ensureStripeCustomer(customer: Customer): Promise<string> {
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

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomerId,
    line_items: [{ price: params.pkg.stripe_price_id, quantity: 1 }],
    success_url: `${appUrl}/dashboard/billing?checkout=success`,
    cancel_url: `${appUrl}/dashboard/billing?checkout=cancelled`,
    metadata: {
      aibooking_customer_id: params.customer.id,
      aibooking_package_id: params.pkg.id,
    },
    subscription_data: {
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
