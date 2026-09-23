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

// Stripe Managed Payments (on by default for this account) rejects any
// Checkout line item whose Product has no tax_code: "Invalid line_items[0]:
// the product tax code is missing". Every product we sell is the platform
// itself — hosted software used by businesses — so it all carries Stripe's
// "Software as a service (SaaS) - business use" code. Overridable in case
// the accountant wants a different eligible code (STRIPE_PRODUCT_TAX_CODE).
const DEFAULT_PRODUCT_TAX_CODE = "txcd_10103001";

export function getProductTaxCode(): string {
  const configured = process.env.STRIPE_PRODUCT_TAX_CODE?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_PRODUCT_TAX_CODE;
}

// Prices whose Product we already stamped (or found stamped) in this server
// instance, so a warm function doesn't re-read the same Price every checkout.
const pricesWithTaxedProduct = new Set<string>();

// A Price pinned by env var, stored in packages.stripe_price_id, or created
// before this code existed belongs to a Product without a tax code — and
// Managed Payments then rejects the whole checkout. Stamp the code onto that
// Product once, rather than asking an admin to fix each one in the Stripe
// dashboard.
async function ensurePriceProductHasTaxCode(priceId: string): Promise<void> {
  if (pricesWithTaxedProduct.has(priceId)) return;

  const stripe = getStripeClient();
  const price = await callStripe(() => stripe.prices.retrieve(priceId, { expand: ["product"] }));
  const product = price.product;
  const productId = typeof product === "string" ? product : product.id;
  const currentTaxCode =
    typeof product === "string" || product.deleted
      ? null
      : typeof product.tax_code === "string"
        ? product.tax_code
        : (product.tax_code?.id ?? null);

  if (!currentTaxCode) {
    await callStripe(() => stripe.products.update(productId, { tax_code: getProductTaxCode() }));
  }
  pricesWithTaxedProduct.add(priceId);
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
  const existing = getConfiguredStripePriceId(pkg.package_name) ?? pkg.stripe_price_id;
  if (existing) {
    await ensurePriceProductHasTaxCode(existing);
    return existing;
  }

  const stripe = getStripeClient();
  const price = await callStripe(() =>
    stripe.prices.create({
      currency: pkg.currency.toLowerCase(),
      unit_amount: Math.round(pkg.monthly_price * 100),
      recurring: { interval: "month" },
      product_data: { name: pkg.package_name, tax_code: getProductTaxCode() },
      metadata: { aibooking_package_id: pkg.id },
    })
  );
  pricesWithTaxedProduct.add(price.id);

  const supabase = getAdminClient();
  const { error } = await supabase.from("packages").update({ stripe_price_id: price.id }).eq("id", pkg.id);
  // A failed write is not worth failing the checkout over — the customer
  // gets their session, and the next checkout just creates another Price.
  if (error) console.error(`Failed to store Stripe price ${price.id} on package ${pkg.id}:`, error.message);

  return price.id;
}

// Stripe Managed Payments (on by default for this account) refuses to
// create a Checkout Session on API versions older than 2025-03-31.basil, and
// the SDK client pins 2025-02-24.acacia (stripe-client.ts). Only this one
// request is sent on the newer version: we read nothing back but the URL, so
// no response-shape change reaches our code, while moving the whole client
// would change the shape of every subscription and invoice we read.
const CHECKOUT_API_VERSION = "2025-03-31.basil";

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
        product_data: {
          name: `${params.pkg.package_name}: opsætning og onboarding`,
          tax_code: getProductTaxCode(),
        },
      },
      quantity: 1,
    });
  }

  const session = await callStripe(() =>
    stripe.checkout.sessions.create(
      {
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
        // No billing_cycle_anchor: the subscription renews on the day the
        // customer checked out, so every invoice, the first one included, is
        // a full month at the package's full price. It used to anchor on the
        // 1st of the next month with a prorated first charge, which left a
        // partial amount per sale that a salesperson's commission can't be
        // settled against.
        subscription_data: {
          metadata: {
            aibooking_customer_id: params.customer.id,
            aibooking_package_id: params.pkg.id,
            ...params.subscriptionMetadata,
          },
        },
      },
      { apiVersion: CHECKOUT_API_VERSION }
    )
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
