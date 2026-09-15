// Pure string handling for Shopify identifiers — no network, no database, no
// secrets — so it can be unit-tested directly and imported from anywhere.

// A shop's permanent Shopify domain. This is the ONLY host we will ever send
// an access token to, and the only one an OAuth callback may name, so the
// pattern is deliberately strict: labels are alphanumeric with internal
// hyphens, and the suffix is exact. Anything looser (a `.includes()`, a
// regex without the anchor) would accept `evil-myshopify.com.attacker.net`
// and hand a merchant's token to whoever registered it.
const MYSHOPIFY_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function isMyshopifyDomain(value: string): boolean {
  return MYSHOPIFY_DOMAIN_PATTERN.test(value.trim().toLowerCase());
}

// Accepts what a merchant actually types: "myshop", "myshop.myshopify.com",
// or a full URL to either. Returns null rather than throwing — every caller
// here is validating user input, not asserting an invariant.
export function normalizeMyshopifyDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim().toLowerCase();
  if (!value) return null;

  if (value.includes("://")) {
    try {
      value = new URL(value).hostname;
    } catch {
      return null;
    }
  }
  // Strip a path/query someone pasted along with the host.
  value = value.split("/")[0] ?? "";
  value = value.replace(/^www\./, "");
  if (!value) return null;

  // A bare handle ("myshop") is the form Shopify's own install prompts use.
  if (!value.includes(".")) {
    value = `${value}.myshopify.com`;
  }

  return isMyshopifyDomain(value) ? value : null;
}

export interface NormalizedShopUrl {
  /** Scheme + host, no trailing slash — what every crawl request is built on. */
  origin: string;
  hostname: string;
}

// The customer's public webshop address. Unlike the admin domain above this
// may be any custom domain (shop.dk, www.shop.dk) — a Shopify store almost
// always sits behind one, and asking for the .myshopify.com address instead
// would be asking them for something they don't know.
export function normalizeShopUrl(raw: string): NormalizedShopUrl | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // "yourshop.com" with no scheme is what people paste; assume https rather
  // than rejecting it.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // A hostname with no dot is a bare word, not a domain — and would resolve
  // to an internal name on the deploy host if we ever tried to fetch it.
  if (!url.hostname.includes(".")) return null;

  return { origin: `${url.protocol}//${url.host}`, hostname: url.hostname };
}

// Shopify order names carry a store-configurable prefix/suffix and are
// usually shown as "#10482". A caller reads it out loud as "ten four eight
// two", types it as "10482", or reads the receipt as "#10482" — all three
// have to find the same order.
//
// Returns null when nothing usable is left, so the lookup can ask again
// rather than searching for an empty string (which would match everything).
export function normalizeOrderNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Keep letters and digits only: drops the leading '#', spoken filler like
  // "ordre nummer", spaces inside a dictated number, and stray punctuation.
  const cleaned = raw
    .trim()
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}-]+/gu, "");
  return cleaned.length > 0 ? cleaned : null;
}

// Whether a Shopify order's `name` is the one that was asked for. Compared
// after stripping the '#' and case, so "#10482" from Shopify matches "10482"
// from the caller — but "10482" never matches "110482". This is the check
// that keeps a fuzzy search from returning somebody else's order.
export function orderNameMatches(shopifyOrderName: string, requested: string): boolean {
  const a = normalizeOrderNumber(shopifyOrderName);
  const b = normalizeOrderNumber(requested);
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}
