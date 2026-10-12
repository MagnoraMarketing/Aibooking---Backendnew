// Shared shapes for the Shopify integration.
//
// There is no "shop content" type here, by design: products, variants, stock,
// policies and orders are never stored. Their shapes belong to the modules
// that fetch them live — ./products.ts, ./shop-info.ts and ./orders.ts.

export type ShopifyConnectionStatus = "not_connected" | "connected" | "error" | "reauth_required";

// What the dashboard is allowed to see. Note what is absent: the access
// token, and anything derived from it.
export interface ShopifyConnectionSummary {
  shopDomain: string | null;
  status: ShopifyConnectionStatus;
  statusError: string | null;
  connectedAt: string | null;
}
