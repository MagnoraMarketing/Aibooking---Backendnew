// The three standard subscription packages, by name exactly as they exist
// in the `packages` table (see 0018_package_pricing_update.sql /
// 0042_align_package_pricing_with_frontend.sql) — used to look up a
// pre-configured Stripe Price ID by environment variable, so an admin can
// pin the exact Price Stripe bills against without relying on
// resolveStripePriceId's auto-create-on-first-checkout fallback.
//
// packages.stripe_price_id (set by hand, or filled in automatically the
// first time someone checks out) still wins when set — this is only a
// second source ahead of the auto-create fallback, not a replacement for it.
export type StandardPackageName = "Starter" | "Professional" | "Enterprise";

const ENV_VAR_BY_PACKAGE: Record<StandardPackageName, string> = {
  Starter: "STRIPE_PRICE_ID_STARTER",
  Professional: "STRIPE_PRICE_ID_PROFESSIONAL",
  Enterprise: "STRIPE_PRICE_ID_ENTERPRISE",
};

export function isStandardPackageName(name: string): name is StandardPackageName {
  return name === "Starter" || name === "Professional" || name === "Enterprise";
}

// The env var configured for this package's Stripe Price, if any — null for
// a custom/non-standard package (nothing to look up) or when the variable
// simply isn't set.
export function getConfiguredStripePriceId(packageName: string): string | null {
  if (!isStandardPackageName(packageName)) return null;
  const value = process.env[ENV_VAR_BY_PACKAGE[packageName]]?.trim();
  return value && value.length > 0 ? value : null;
}
