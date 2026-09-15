import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { requireCredentialEnv } from "@/lib/security/env";
import { getPublicAppUrl } from "@/lib/app-url";
import { isMyshopifyDomain } from "./domain";

// Shopify's OAuth authorization code grant, as documented for a standalone /
// API-only app: redirect the merchant to their own shop's authorize page,
// then exchange the returned code for an offline access token.
//
// The customer never sees, types or pastes a token — the whole flow is
// redirect-based, which is what the "no manual API tokens in the frontend"
// requirement means in practice.

// Only what the two agent tools actually need, and both are read-only:
//   read_products — product names, prices, variants, sizes, colours, SKUs,
//                   stock and the product's own storefront URL.
//   read_orders   — an order and its fulfilments (tracking number, carrier,
//                   tracking URL).
// Nothing here can write. A merchant sees this list on the consent screen, so
// every scope has to be one we can justify out loud.
//
// Worth knowing when the app is configured: read_orders reaches the last 60
// days of orders. A shop that needs older ones must be granted read_all_orders
// by Shopify — see the setup notes in .env.example.
export const SHOPIFY_SCOPES = "read_products,read_orders";

function credentials(): { clientId: string; clientSecret: string } {
  return {
    clientId: requireCredentialEnv(
      "SHOPIFY_API_KEY",
      "Shopify er ikke konfigureret på platformen (SHOPIFY_API_KEY mangler)."
    ),
    clientSecret: requireCredentialEnv(
      "SHOPIFY_API_SECRET",
      "Shopify er ikke konfigureret på platformen (SHOPIFY_API_SECRET mangler)."
    ),
  };
}

export function shopifyRedirectUri(): string {
  return `${getPublicAppUrl()}/api/customer/shopify/callback`;
}

export function generateOAuthState(): string {
  return randomBytes(32).toString("hex");
}

export function buildShopifyAuthorizeUrl(shopDomain: string, state: string): string {
  if (!isMyshopifyDomain(shopDomain)) {
    throw new Error("Refusing to build an authorize URL for a non-Shopify domain");
  }

  const url = new URL(`https://${shopDomain}/admin/oauth/authorize`);
  url.searchParams.set("client_id", credentials().clientId);
  url.searchParams.set("scope", SHOPIFY_SCOPES);
  url.searchParams.set("redirect_uri", shopifyRedirectUri());
  url.searchParams.set("state", state);
  // Empty `grant_options[]` asks for an offline (non-expiring) token, which is
  // what a background order lookup needs — nobody is present to re-authorize
  // when a caller asks "where is my order?".
  url.searchParams.set("grant_options[]", "");
  return url.toString();
}

// Shopify signs the callback query string with the app's client secret. This
// is the check that makes the callback trustworthy at all: without it, anyone
// who knows a widget id could hit the callback URL with a shop of their
// choosing.
//
// The signature covers every query parameter except `hmac` and `signature`,
// sorted by key and joined as a query string.
export function verifyCallbackHmac(params: URLSearchParams): boolean {
  const received = params.get("hmac");
  if (!received) return false;

  const message = [...params.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .map(([key, value]) => [key, value] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");

  const expected = createHmac("sha256", credentials().clientSecret).update(message).digest("hex");

  const receivedBuf = Buffer.from(received, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (receivedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(receivedBuf, expectedBuf);
}

export interface ShopifyTokenResult {
  accessToken: string;
  scope: string;
}

export async function exchangeShopifyCode(shopDomain: string, code: string): Promise<ShopifyTokenResult> {
  if (!isMyshopifyDomain(shopDomain)) {
    // The token is POSTed to this host. Sending it anywhere but a verified
    // myshopify.com domain would be handing the app's client secret to a
    // stranger, so this is a hard stop rather than a validation message.
    throw new Error("Refusing to exchange a code against a non-Shopify domain");
  }

  const { clientId, clientSecret } = credentials();
  const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });

  if (!response.ok) {
    // The body can echo the code back; keep it out of the thrown message so it
    // cannot reach a log line that someone later pastes into a ticket.
    throw new Error(`Shopify token exchange failed with status ${response.status}`);
  }

  const data = (await response.json()) as { access_token?: string; scope?: string };
  if (!data.access_token) throw new Error("Shopify token exchange returned no access token");

  return { accessToken: data.access_token, scope: data.scope ?? SHOPIFY_SCOPES };
}

export function isShopifyOAuthConfigured(): boolean {
  return Boolean(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET);
}
