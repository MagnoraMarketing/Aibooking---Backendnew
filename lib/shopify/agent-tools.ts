import "server-only";
import { ShopifyAdminApiError } from "./admin-api";
import { loadAdminCredentials, loadCatalog, markConnectionNeedsReauth } from "./connection";
import { lookupShopifyOrder, type ShopifyOrderStatus } from "./orders";
import { searchShopifyCatalog, type ShopifyProductMatch } from "./product-search";

// The two tools the agent may call about a webshop, and the one place they
// execute. Both pipelines — the Vapi voice assistant (via
// app/api/webhooks/vapi) and the Anthropic chat/relay loop (via
// lib/conversation/tool-loop.ts) — call straight into here, so voice and chat
// cannot drift apart in what they can do or what they are allowed to see.
//
// The split from 0035_shopify_integration.sql is enforced here and nowhere
// else: search_shopify_products reads the PUBLIC crawled catalogue,
// get_shopify_order_status reads the PRIVATE Admin API. Neither can reach the
// other's data.

export const SHOPIFY_TOOL_NAMES = ["search_shopify_products", "get_shopify_order_status"] as const;
export type ShopifyToolName = (typeof SHOPIFY_TOOL_NAMES)[number];

export function isShopifyToolName(name: string): name is ShopifyToolName {
  return (SHOPIFY_TOOL_NAMES as readonly string[]).includes(name);
}

export interface ShopifyCapabilities {
  /** A crawled catalogue exists, so product questions can be answered. */
  products: boolean;
  /** The Admin API install completed, so orders can be looked up. */
  orders: boolean;
}

// Which Shopify tools this widget should be given at all. Attaching a tool the
// widget can't use invites the agent to promise something it then can't do.
export async function resolveShopifyCapabilities(widgetId: string): Promise<ShopifyCapabilities> {
  const [catalog, credentials] = await Promise.all([loadCatalog(widgetId), loadAdminCredentials(widgetId)]);
  return {
    products: (catalog?.catalog.length ?? 0) > 0,
    orders: credentials !== null,
  };
}

export interface ShopifyProductSearchResult {
  found: boolean;
  query: string;
  products: ShopifyProductMatch[];
  shop_url?: string;
  error?: "not_connected";
}

export async function searchProducts(
  widgetId: string,
  query: string
): Promise<ShopifyProductSearchResult> {
  const catalog = await loadCatalog(widgetId);
  if (!catalog || catalog.catalog.length === 0) {
    return { found: false, query, products: [], error: "not_connected" };
  }

  const products = searchShopifyCatalog(catalog.catalog, query, catalog.currency);
  return {
    found: products.length > 0,
    query,
    products,
    ...(catalog.shopUrl ? { shop_url: catalog.shopUrl } : {}),
  };
}

export type ShopifyOrderLookupResult = ShopifyOrderStatus & {
  error?: "not_connected" | "reauth_required" | "unavailable" | "missing_order_number";
};

export async function getOrderStatus(
  widgetId: string,
  orderNumber: string | undefined
): Promise<ShopifyOrderLookupResult> {
  if (!orderNumber?.trim()) return { found: false, error: "missing_order_number" };

  const credentials = await loadAdminCredentials(widgetId);
  if (!credentials) return { found: false, error: "not_connected" };

  try {
    return await lookupShopifyOrder({
      shopDomain: credentials.shopDomain,
      accessToken: credentials.accessToken,
      orderNumber,
    });
  } catch (err) {
    if (err instanceof ShopifyAdminApiError && err.kind === "unauthorized") {
      // The merchant uninstalled or revoked the app. Record it so the
      // dashboard can ask them to reconnect, instead of this failing silently
      // on every future call.
      await markConnectionNeedsReauth(credentials.connectionId, "unauthorized").catch(() => {});
      return { found: false, error: "reauth_required" };
    }
    console.error("Shopify order lookup failed:", err);
    return { found: false, error: "unavailable" };
  }
}

// One dispatch for both pipelines. Returns JSON as a string: it is what Vapi
// and Anthropic both accept as a tool result, and it keeps the agent doing the
// wording — the tool states facts, the agent turns them into a sentence.
//
// Never throws. A tool call that blows up mid-conversation would leave a
// caller listening to silence, so every failure comes back as a result the
// agent can say something honest about.
export async function executeShopifyTool(
  name: string,
  args: Record<string, unknown>,
  widgetId: string
): Promise<string> {
  try {
    if (name === "search_shopify_products") {
      const query = typeof args.query === "string" ? args.query : "";
      return JSON.stringify(await searchProducts(widgetId, query));
    }
    if (name === "get_shopify_order_status") {
      const orderNumber = typeof args.order_number === "string" ? args.order_number : undefined;
      return JSON.stringify(await getOrderStatus(widgetId, orderNumber));
    }
    return JSON.stringify({ error: "unknown_tool" });
  } catch (err) {
    console.error(`Shopify tool ${name} threw:`, err);
    return JSON.stringify({ found: false, error: "unavailable" });
  }
}
