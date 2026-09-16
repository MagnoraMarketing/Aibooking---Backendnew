import "server-only";
import { ShopifyAdminApiError } from "./admin-api";
import { loadAdminCredentials, markConnectionNeedsReauth } from "./connection";
import { lookupShopifyOrder, type ShopifyOrderStatus } from "./orders";
import { getShopifyProduct, searchShopifyProducts, type ShopifyProductResult } from "./products";
import { fetchShopifyShopInfo, type ShopifyPolicyKind, type ShopifyShopInfo } from "./shop-info";

// The two tools the agent may call about a webshop, and the one place they
// execute. Both pipelines — the Vapi voice assistant (via
// app/api/webhooks/vapi) and the Anthropic chat/relay loop (via
// lib/conversation/tool-loop.ts) — call straight into here, so voice and chat
// cannot drift apart in what they can do or what they are allowed to see.
//
// Every tool is a live Shopify Admin GraphQL lookup, scoped to the question
// being asked. Nothing about the shop — products, prices, stock, policies —
// is crawled, indexed or held in the agent's prompt: a customer asking about a
// size gets today's stock level, and one asking about delivery gets the
// policy the merchant has in Shopify right now.

export const SHOPIFY_TOOL_NAMES = [
  "search_shopify_products",
  "get_shopify_product",
  "get_shopify_shop_info",
  "get_shopify_order_status",
] as const;
export type ShopifyToolName = (typeof SHOPIFY_TOOL_NAMES)[number];

export function isShopifyToolName(name: string): name is ShopifyToolName {
  return (SHOPIFY_TOOL_NAMES as readonly string[]).includes(name);
}

export interface ShopifyCapabilities {
  /** The app was granted read_products, so product questions can be answered. */
  products: boolean;
  /** The app was granted read_orders, so orders can be looked up. */
  orders: boolean;
  /** The app was granted read_legal_policies, so delivery/returns can be quoted. */
  policies: boolean;
}

const NO_CAPABILITIES: ShopifyCapabilities = { products: false, orders: false, policies: false };

// Which Shopify tools this widget should be given at all. Derived from the
// scopes Shopify actually granted, not from what we asked for: a merchant who
// connected before read_products was requested has a working order lookup and
// no product access, and the agent must not be handed a tool that would fail.
export async function resolveShopifyCapabilities(widgetId: string): Promise<ShopifyCapabilities> {
  const credentials = await loadAdminCredentials(widgetId);
  if (!credentials) return NO_CAPABILITIES;

  const granted = (credentials.scopes ?? "").split(",").map((scope) => scope.trim());
  return {
    products: granted.includes("read_products"),
    orders: granted.includes("read_orders"),
    policies: granted.includes("read_legal_policies"),
  };
}

export interface ShopifyProductSearchResult {
  found: boolean;
  query: string;
  products: ShopifyProductResult[];
  requested_options?: string[];
  error?: "not_connected" | "reauth_required" | "unavailable";
}

// Shared by both lookups: a token Shopify has rejected means the merchant
// uninstalled or revoked the app. Recording it is what lets the dashboard ask
// them to reconnect instead of every call failing silently from now on.
async function handleLookupFailure(
  err: unknown,
  connectionId: string,
  label: string
): Promise<"reauth_required" | "unavailable"> {
  if (err instanceof ShopifyAdminApiError && err.kind === "unauthorized") {
    await markConnectionNeedsReauth(connectionId, "unauthorized").catch(() => {});
    return "reauth_required";
  }
  console.error(`${label} failed:`, err);
  return "unavailable";
}

export async function searchProducts(widgetId: string, query: string): Promise<ShopifyProductSearchResult> {
  const credentials = await loadAdminCredentials(widgetId);
  if (!credentials) return { found: false, query, products: [], error: "not_connected" };

  try {
    const result = await searchShopifyProducts({
      shopDomain: credentials.shopDomain,
      accessToken: credentials.accessToken,
      query,
    });
    return {
      found: result.products.length > 0,
      query,
      products: result.products,
      requested_options: result.requested_options,
    };
  } catch (err) {
    return {
      found: false,
      query,
      products: [],
      error: await handleLookupFailure(err, credentials.connectionId, "Shopify product search"),
    };
  }
}

export interface ShopifyProductDetailResult {
  found: boolean;
  product?: ShopifyProductResult;
  error?: "not_connected" | "reauth_required" | "unavailable" | "missing_identifier";
}

export async function getProduct(widgetId: string, identifier: string | undefined): Promise<ShopifyProductDetailResult> {
  if (!identifier?.trim()) return { found: false, error: "missing_identifier" };

  const credentials = await loadAdminCredentials(widgetId);
  if (!credentials) return { found: false, error: "not_connected" };

  try {
    const product = await getShopifyProduct({
      shopDomain: credentials.shopDomain,
      accessToken: credentials.accessToken,
      identifier,
    });
    return product ? { found: true, product } : { found: false };
  } catch (err) {
    return { found: false, error: await handleLookupFailure(err, credentials.connectionId, "Shopify product lookup") };
  }
}

export type ShopifyShopInfoResult = Partial<ShopifyShopInfo> & {
  found: boolean;
  error?: "not_connected" | "reauth_required" | "unavailable";
};

const POLICY_KINDS: ShopifyPolicyKind[] = ["shipping", "refund", "terms", "privacy"];

function parsePolicyKinds(raw: unknown): ShopifyPolicyKind[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const kinds = raw.filter((value): value is ShopifyPolicyKind =>
    typeof value === "string" && (POLICY_KINDS as string[]).includes(value)
  );
  return kinds.length > 0 ? kinds : undefined;
}

export async function getShopInfo(widgetId: string, which?: ShopifyPolicyKind[]): Promise<ShopifyShopInfoResult> {
  const credentials = await loadAdminCredentials(widgetId);
  if (!credentials) return { found: false, error: "not_connected" };

  try {
    const info = await fetchShopifyShopInfo({
      shopDomain: credentials.shopDomain,
      accessToken: credentials.accessToken,
      which,
    });
    return { found: info.policies.length > 0, ...info };
  } catch (err) {
    return { found: false, error: await handleLookupFailure(err, credentials.connectionId, "Shopify shop info lookup") };
  }
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
    return { found: false, error: await handleLookupFailure(err, credentials.connectionId, "Shopify order lookup") };
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
    if (name === "get_shopify_product") {
      const identifier = typeof args.identifier === "string" ? args.identifier : undefined;
      return JSON.stringify(await getProduct(widgetId, identifier));
    }
    if (name === "get_shopify_shop_info") {
      return JSON.stringify(await getShopInfo(widgetId, parsePolicyKinds(args.topics)));
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
