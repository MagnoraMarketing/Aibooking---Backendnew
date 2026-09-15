import "server-only";

// Pragmatic SSRF guard for customer-supplied URLs. Lifted out of
// lib/knowledge-base/url.ts when the Shopify crawler became a second caller:
// one list of blocked hostnames beats two that drift apart.
//
// Not a DNS-rebinding-proof solution (that needs resolving the hostname and
// checking the IP right before connecting) — reasonable for an
// authenticated, customer-admin-only feature, not a fully hardened one.
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
];

export function assertSafeHttpUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https URLs are supported");
  }
  if (BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(url.hostname))) {
    throw new Error("This URL points to a private/internal address and can't be imported");
  }
}

export function isSafeHttpUrl(url: URL): boolean {
  try {
    assertSafeHttpUrl(url);
    return true;
  } catch {
    return false;
  }
}
