import "server-only";
import type Stripe from "stripe";
import { getStripeClient } from "./stripe-client";
import { getAdminClient } from "@/lib/database/admin";
import type { Customer, Package } from "@/types/database";
import { ApiError } from "@/types/errors";

// Stripe's SDK throws its own Stripe.errors.StripeError, which — like a
// plain Error — isn't an ApiError, so lib/security/http.ts's errorResponse
// would otherwise mask it as an opaque "Something went wrong" instead of
// showing the customer why their payment/checkout attempt actually failed.
async function callStripe<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const message = err instanceof Error ? err.message : "Ukendt fejl fra Stripe.";
    throw ApiError.internal(`Stripe-fejl: ${message}`);
  }
}

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

// Exported for other one-off/add-on Stripe purchases (e.g. buying a phone
// number, see lib/phone-numbers) that need a Stripe customer to exist but
// aren't the main package checkout below.
export async function ensureStripeCustomer(customer: Customer): Promise<string> {
  if (customer.stripe_customer_id) return customer.stripe_customer_id;

  const stripe = getStripeClient();
  const stripeCustomer = await callStripe(() =>
    stripe.customers.create({
      email: customer.email,
      name: customer.name,
      metadata: { aibooking_customer_id: customer.id },
    })
  );

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
  // Optional overrides for a special-cased checkout (e.g. the Inbound
  // page's intro offer) — a specific Stripe coupon to apply, redirect URLs
  // other than the billing page, and extra subscription metadata for the
  // webhook to key off later (see subscription-sync.ts).
  discountCouponId?: string;
  successUrl?: string;
  cancelUrl?: string;
  subscriptionMetadata?: Record<string, string>;
}): Promise<{ url: string }> {
  if (!params.pkg.stripe_price_id) {
    throw ApiError.internal(
      `Pakken "${params.pkg.package_name}" er ikke sat op til betaling endnu (mangler Stripe-pris). Kontakt support.`
    );
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

  const session = await callStripe(() =>
    stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: lineItems,
      success_url: params.successUrl ?? `${appUrl}/dashboard/billing?checkout=success`,
      cancel_url: params.cancelUrl ?? `${appUrl}/dashboard/billing?checkout=cancelled`,
      discounts: params.discountCouponId ? [{ coupon: params.discountCouponId }] : undefined,
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
          ...params.subscriptionMetadata,
        },
      },
    })
  );

  if (!session.url) throw ApiError.internal("Stripe returnerede ingen betalings-URL. Prøv igen.");
  return { url: session.url };
}

// The Inbound page's "30 dage til 499 kr, derefter 999 kr" intro offer
// (app/api/billing/intro-offer) — one-time-per-customer 50% off the first
// invoice, via a stable, reusable Stripe Coupon rather than creating a new
// one per checkout. Get-or-create: Stripe has no "upsert" for coupons, and
// creating with a fixed id twice just errors, so we retrieve first and only
// create on a genuine 404.
const INTRO_OFFER_COUPON_ID = "aibooking-intro-offer-50";

export async function getOrCreateIntroOfferCoupon(): Promise<string> {
  const stripe = getStripeClient();
  try {
    const existing = await stripe.coupons.retrieve(INTRO_OFFER_COUPON_ID);
    return existing.id;
  } catch {
    return callStripe(async () => {
      const created = await stripe.coupons.create({
        id: INTRO_OFFER_COUPON_ID,
        percent_off: 50,
        duration: "once",
        name: "AIbooking.dk — 30 dages introtilbud",
      });
      return created.id;
    });
  }
}

export async function createBillingPortalSession(customer: Customer): Promise<{ url: string }> {
  if (!customer.stripe_customer_id) {
    throw ApiError.badRequest("I har ikke et Stripe-kundeforhold endnu — gennemfør et køb først.");
  }

  const stripe = getStripeClient();
  const appUrl = getAppUrl();

  const session = await callStripe(() =>
    stripe.billingPortal.sessions.create({
      customer: customer.stripe_customer_id!,
      return_url: `${appUrl}/dashboard/billing`,
    })
  );

  return { url: session.url };
}
