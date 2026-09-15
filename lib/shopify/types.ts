// Shared shapes for the Shopify integration. Deliberately split along the
// same line as the database (0035_shopify_integration.sql): everything here
// describes PUBLIC storefront data. Order/fulfilment shapes live in
// ./orders.ts, behind the Admin API.

export interface ShopifyCatalogVariant {
  title: string;
  price: string | null;
  compareAtPrice: string | null;
  available: boolean | null;
  sku: string | null;
  /** The variant's option values in order, e.g. ["Sort", "43"]. */
  options: string[];
}

export interface ShopifyCatalogProduct {
  title: string;
  handle: string;
  url: string;
  description: string;
  productType: string | null;
  vendor: string | null;
  tags: string[];
  /** e.g. [{ name: "Farve", values: ["Sort", "Hvid"] }, { name: "Størrelse", ... }] */
  options: { name: string; values: string[] }[];
  variants: ShopifyCatalogVariant[];
  priceMin: string | null;
  priceMax: string | null;
  imageUrl: string | null;
  available: boolean;
}

export interface ShopifyCrawledPage {
  title: string;
  url: string;
  text: string;
}

export interface ShopifyCrawlResult {
  products: ShopifyCatalogProduct[];
  pages: ShopifyCrawledPage[];
  currency: string | null;
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
  productCount: number;
  pageCount: number;
  lastSyncAt: string | null;
  connectedAt: string | null;
}
