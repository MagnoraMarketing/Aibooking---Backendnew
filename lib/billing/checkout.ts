import "server-only";
import type Stripe from "stripe";
import { getStripeClient } from "./stripe-client";
import { getAdminClient } from "@/lib/database/admin";
import { getPublicAppUrl } from "@/lib/app-url";
import { getConfiguredStripePriceId } from "./package-catalog";
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

// Stripe redirects the paying customer back here after checkout, so a
// localhost fallback would strand them on a page that only exists on a
// developer's machine — see lib/app-url.ts.
const getAppUrl = getPublicAppUrl;

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

// Every package is priced in our own database (monthly_price, currency,
// included_minutes), but Stripe needs a Price object to bill a subscription
// against. Resolution order: an explicit STRIPE_PRICE_ID_* env var (see
// lib/billing/package-catalog.ts — the "separate Stripe Price IDs" the admin
// can pin per package), then packages.stripe_price_id (set by hand, or by
// this function the first time someone checks out), then — since that
// column used to be null for every package, which made checkout fail for
// every customer with "Pakken er ikke sat op til betaling endnu" and no way
// for an admin to fix it — create the Price from the package's own numbers
// and store the id back, get-or-create, the same shape as
// getOrCreateIntroOfferCoupon below. Changing a package's price afterwards
// needs a new Stripe Price (they're immutable), which is what the admin
// pricing API's stripePriceId field is for.
export async function resolveStripePriceId(pkg: Package): Promise<string> {
  const configured = getConfiguredStripePriceId(pkg.package_name);
  if (configured) return configured;
  if (pkg.stripe_price_id) return pkg.stripe_price_id;

  const stripe = getStripeClient();
  const price = await callStripe(() =>
    stripe.prices.create({
      currency: pkg.currency.toLowerCase(),
      unit_amount: Math.round(pkg.monthly_price * 100),
      recurring: { interval: "month" },
      product_data: { name: pkg.package_name },
      metadata: { aibooking_package_id: pkg.id },
    })
  );

  const supabase = getAdminClient();
  const { error } = await supabase.from("packages").update({ stripe_price_id: price.id }).eq("id", pkg.id);
  // A failed write is not worth failing the checkout over — the customer
  // gets their session, and the next checkout just creates another Price.
  if (error) console.error(`Failed to store Stripe price ${price.id} on package ${pkg.id}:`, error.message);

  return price.id;
}

export async function createCheckoutSession(params: {
  customer: Customer;
  pkg: Package;
  // Setup/onboarding is a genuinely optional one-time add-on (spec: "Der
  // skal være mulighed for at købe en valgfri opsætning") — never added
  // unless the customer explicitly asked for it at checkout, and never
  // billed again on a renewal since it's a Checkout Session line item, not
  // part of the recurring price.
  includeSetup?: boolean;
  // Optional overrides for a special-cased checkout (e.g. the Inbound
  // page's intro offer) — a specific Stripe coupon to apply, redirect URLs
  // other than the billing page, and extra subscription metadata for the
  // webhook to key off later (see subscription-sync.ts).
  discountCouponId?: string;
  successUrl?: string;
  cancelUrl?: string;
  subscriptionMetadata?: Record<string, string>;
}): Promise<{ url: string }> {
  const stripe = getStripeClient();
  const priceId = await resolveStripePriceId(params.pkg);
  const stripeCustomerId = await ensureStripeCustomer(params.customer);
  const appUrl = getAppUrl();

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{ price: priceId, quantity: 1 }];

  // A one-time setup/onboarding fee, billed alongside the first invoice only
  // when the customer opted in — no pre-created Stripe Price needed, unlike
  // the recurring price above (which admin configures per package), since
  // this only ever needs to exist as this one line item on this one session.
  if (params.includeSetup && params.pkg.setup_fee && params.pkg.setup_fee > 0) {
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
