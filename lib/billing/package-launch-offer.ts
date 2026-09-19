// The voice-package purchase offer for Starter/Professional/Enterprise —
// same pattern as ./widget-launch-offer.ts, applied to the three paid
// packages instead of the widget. The dashboard's "buy this package" button
// (components/dashboard/billing-manager.tsx) sends the customer to one of
// these Stripe Payment Links rather than a Checkout Session created on the
// fly: these are the exact same links already shown on aibooking.dk's
// pricing tables (src/utils/checkout.ts in the marketing site repo), so the
// price and terms a visitor sees on the front page are the price and terms
// they actually pay in the dashboard, and marketing can update either
// without a deploy here.
//
// This module is the half both sides need — which package maps to which
// link, and the reference that ties a payment back to an account and a
// package. It touches no database; the granting half lives in
// ./package-launch.ts (server-only) and in the webhook
// (app/api/webhooks/stripe/route.ts), which upserts the subscription row
// directly from the parsed reference instead of from Stripe subscription
// metadata (a Payment Link, unlike our own createCheckoutSession, can't set
// per-customer subscription metadata).
export type PackageLaunchKind = "starter" | "professional" | "enterprise";

const DEFAULT_PAYMENT_LINKS: Record<PackageLaunchKind, string> = {
  starter: "https://buy.stripe.com/14A00iepJ1xp9AU2AP4AU06",
  professional: "https://buy.stripe.com/eVq28qdlF5NFcN62AP4AU08",
  enterprise: "https://buy.stripe.com/eVq28q81lfoffZidft4AU07",
};

// Overridable per environment (a test-mode link while developing), same
// convention as NEXT_PUBLIC_STRIPE_WIDGET_PAYMENT_LINK.
const ENV_OVERRIDE_KEYS: Record<PackageLaunchKind, string> = {
  starter: "NEXT_PUBLIC_STRIPE_STARTER_PAYMENT_LINK",
  professional: "NEXT_PUBLIC_STRIPE_PROFESSIONAL_PAYMENT_LINK",
  enterprise: "NEXT_PUBLIC_STRIPE_ENTERPRISE_PAYMENT_LINK",
};

export function getPackageLaunchPaymentLink(kind: PackageLaunchKind): string {
  const configured = process.env[ENV_OVERRIDE_KEYS[kind]]?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_PAYMENT_LINKS[kind];
}

// The marketing site's three paid tiers are always named exactly this on
// both sides (see supabase/migrations/0018_package_pricing_update.sql) — a
// package that doesn't match one of these (a future custom tier, or the
// free trial, which isn't a purchasable row at all per that migration) has
// no fixed Payment Link and falls back to the dynamic Checkout Session in
// lib/billing/checkout.ts instead.
export function getPackageLaunchKind(packageName: string): PackageLaunchKind | null {
  const normalized = packageName.trim().toLowerCase();
  if (normalized === "starter") return "starter";
  if (normalized === "professional") return "professional";
  if (normalized === "enterprise") return "enterprise";
  return null;
}

// Stripe allows [A-Za-z0-9_-] in client_reference_id (max 200 chars), which
// covers two UUIDs and a separator — see widget-launch-offer.ts.
const REFERENCE_SEPARATOR = "__";
const UUID_PATTERN = /^[0-9a-fA-F-]{36}$/;

export interface PackageLaunchReference {
  customerId: string;
  packageId: string;
}

export function buildPackageLaunchReference(params: PackageLaunchReference): string {
  return `${params.customerId}${REFERENCE_SEPARATOR}${params.packageId}`;
}

// Unlike the widget reference (where the widget half is optional), a
// package purchase is meaningless without knowing which package was bought
// — so, unlike parseWidgetLaunchReference, a missing/invalid package half
// invalidates the whole reference rather than degrading gracefully.
export function parsePackageLaunchReference(reference: string | null | undefined): PackageLaunchReference | null {
  if (!reference) return null;
  const [customerId, packageId] = reference.split(REFERENCE_SEPARATOR);
  if (!customerId || !UUID_PATTERN.test(customerId)) return null;
  if (!packageId || !UUID_PATTERN.test(packageId)) return null;
  return { customerId, packageId };
}

// The URL the customer is actually sent to. prefilled_email saves them
// retyping it and keeps the Stripe-side customer matched to the account
// that gets the subscription.
export function buildPackageLaunchUrl(params: {
  kind: PackageLaunchKind;
  customerId: string;
  packageId: string;
  email?: string | null;
}): string {
  const url = new URL(getPackageLaunchPaymentLink(params.kind));
  url.searchParams.set("client_reference_id", buildPackageLaunchReference(params));
  if (params.email) url.searchParams.set("prefilled_email", params.email);
  return url.toString();
}
