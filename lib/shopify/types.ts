// Shared shapes for the Shopify integration.
//
// Everything here describes the shop's PUBLIC information pages — shipping,
// returns, terms, FAQ — which are the one thing that still reaches the agent's
// prompt. Products, variants, stock and orders are live Admin API lookups and
// their shapes live in ./products.ts and ./orders.ts; none of it is stored.

export interface ShopifyCrawledPage {
  title: string;
  url: string;
  text: string;
}

export interface ShopifyCrawlResult {
  pages: ShopifyCrawledPage[];
  /** True when the storefront answered as a Shopify shop at all. */
  looksLikeShopify: boolean;
}

export type ShopifyCrawlStatus = "pending" | "running" | "ok" | "error";
export type ShopifyConnectionStatus = "not_connected" | "connected" | "error" | "reauth_required";

// What the dashboard is allowed to see. Note what is absent: the access
// token, and anything derived from it. Everything here is either the
// customer's own input or a count.
export interface ShopifyConnectionSummary {
  shopUrl: string | null;
  shopDomain: string | null;
  status: ShopifyConnectionStatus;
  statusError: string | null;
  crawlStatus: ShopifyCrawlStatus;
  crawlError: string | null;
  pageCount: number;
  lastSyncAt: string | null;
  connectedAt: string | null;
}
