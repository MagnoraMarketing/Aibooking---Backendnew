import { describe, it, expect, vi, beforeEach } from "vitest";

// The tools the agent is given, and what comes back when it calls them. Voice
// and chat both run through exactly this, so anything asserted here holds on
// the phone and in the widget alike.

const loadCatalogMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(null));
const loadAdminCredentialsMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(null));
const markReauthMock = vi.fn((..._args: unknown[]) => Promise.resolve<void>(undefined));
const lookupOrderMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(null));

vi.mock("@/lib/shopify/connection", () => ({
  loadCatalog: (...args: unknown[]) => loadCatalogMock(...args),
  loadAdminCredentials: (...args: unknown[]) => loadAdminCredentialsMock(...args),
  markConnectionNeedsReauth: (...args: unknown[]) => markReauthMock(...args),
}));

vi.mock("@/lib/shopify/orders", () => ({
  lookupShopifyOrder: (...args: unknown[]) => lookupOrderMock(...args),
}));

import { ShopifyAdminApiError } from "@/lib/shopify/admin-api";
import {
  executeShopifyTool,
  isShopifyToolName,
  resolveShopifyCapabilities,
  SHOPIFY_TOOL_NAMES,
} from "@/lib/shopify/agent-tools";
import { buildShopifyAnthropicTools, buildShopifyVapiTools } from "@/lib/shopify/tool-definitions";
import type { ShopifyCatalogProduct } from "@/lib/shopify/types";

const PRODUCT: ShopifyCatalogProduct = {
  title: "Nike Air Max",
  handle: "nike-air-max",
  url: "https://shop.dk/products/nike-air-max",
  description: "Let løbesko.",
  productType: "Løbesko",
  vendor: "Nike",
  tags: [],
  options: [{ name: "Størrelse", values: ["42", "43"] }],
  variants: [{ title: "Sort / 43", price: "899", compareAtPrice: null, available: true, sku: "S43", options: ["Sort", "43"] }],
  priceMin: "899",
  priceMax: "899",
  imageUrl: null,
  available: true,
};

const CREDENTIALS = { connectionId: "conn-1", shopDomain: "shop.myshopify.com", accessToken: "shpat_x" };

function parse(result: string): Record<string, unknown> {
  return JSON.parse(result) as Record<string, unknown>;
}

beforeEach(() => {
  loadCatalogMock.mockReset().mockResolvedValue({ catalog: [PRODUCT], currency: "DKK", shopUrl: "https://shop.dk" });
  loadAdminCredentialsMock.mockReset().mockResolvedValue(CREDENTIALS);
  // mockReset() alone strips the async implementation, leaving a mock that
  // returns undefined — which would make the production `.catch()` on its
  // promise throw and mask the branch under test.
  markReauthMock.mockReset().mockResolvedValue(undefined);
  lookupOrderMock.mockReset().mockResolvedValue({ found: true, order_number: "10482", status: "fulfilled" });
});

describe("resolveShopifyCapabilities", () => {
  it("separates 'can answer product questions' from 'can look up orders'", async () => {
    expect(await resolveShopifyCapabilities("widget-a")).toEqual({ products: true, orders: true });

    // The expected first step of the setup: URL saved, OAuth not done yet.
    loadAdminCredentialsMock.mockResolvedValue(null);
    expect(await resolveShopifyCapabilities("widget-a")).toEqual({ products: true, orders: false });

    loadCatalogMock.mockResolvedValue({ catalog: [], currency: null, shopUrl: null });
    expect(await resolveShopifyCapabilities("widget-a")).toEqual({ products: false, orders: false });
  });
});

describe("the tools an assistant is given", () => {
  it("offers nothing when no webshop is connected", () => {
    expect(buildShopifyVapiTools({ products: false, orders: false })).toEqual([]);
    expect(buildShopifyAnthropicTools({ products: false, orders: false })).toEqual([]);
  });

  // Offering a tool the widget can't fulfil teaches the agent to promise
  // something it then fails at — worse than not offering it.
  it("offers product search without order tracking when only the shop URL is saved", () => {
    const names = buildShopifyVapiTools({ products: true, orders: false }).map((tool) => tool.function.name);
    expect(names).toEqual(["search_shopify_products"]);
  });

  it("gives voice and chat exactly the same tools and descriptions", () => {
    const capabilities = { products: true, orders: true };
    const vapi = buildShopifyVapiTools(capabilities);
    const anthropic = buildShopifyAnthropicTools(capabilities);

    expect(vapi.map((tool) => tool.function.name)).toEqual(anthropic.map((tool) => tool.name));
    expect(vapi.map((tool) => tool.function.description)).toEqual(anthropic.map((tool) => tool.description));
    expect(anthropic.map((tool) => tool.name).sort()).toEqual([...SHOPIFY_TOOL_NAMES].sort());
  });

  it("recognises its own tool names and nothing else", () => {
    expect(isShopifyToolName("get_shopify_order_status")).toBe(true);
    expect(isShopifyToolName("search_shopify_products")).toBe(true);
    expect(isShopifyToolName("create_booking")).toBe(false);
  });
});

describe("search_shopify_products", () => {
  it("returns structured JSON the agent turns into its own sentence", async () => {
    const result = parse(await executeShopifyTool("search_shopify_products", { query: "løbesko" }, "widget-a"));

    expect(result.found).toBe(true);
    expect(result.shop_url).toBe("https://shop.dk");
    expect(Array.isArray(result.products)).toBe(true);
    expect((result.products as Record<string, unknown>[])[0]).toMatchObject({
      name: "Nike Air Max",
      price: "899",
      currency: "DKK",
      url: "https://shop.dk/products/nike-air-max",
    });
  });

  it("says so plainly when the shop has no such product", async () => {
    const result = parse(await executeShopifyTool("search_shopify_products", { query: "havetraktor" }, "widget-a"));
    expect(result).toMatchObject({ found: false, products: [] });
  });

  it("reads the catalogue of the widget it was given, not one from the arguments", async () => {
    await executeShopifyTool("search_shopify_products", { query: "sko", widgetId: "widget-b" }, "widget-a");
    expect(loadCatalogMock).toHaveBeenCalledWith("widget-a");
  });
});

describe("get_shopify_order_status", () => {
  it("returns the structured shape the spec asks for", async () => {
    lookupOrderMock.mockResolvedValue({
      found: true,
      order_number: "10482",
      status: "fulfilled",
      fulfillment_status: "shipped",
      tracking_number: "123456789",
      tracking_url: "https://track.dhl.com/123456789",
      carrier: "DHL",
    });

    const result = parse(await executeShopifyTool("get_shopify_order_status", { order_number: "#10482" }, "widget-a"));

    expect(result).toMatchObject({
      found: true,
      order_number: "10482",
      status: "fulfilled",
      fulfillment_status: "shipped",
      tracking_number: "123456789",
      // Its own field, so a later SMS step can send just the link.
      tracking_url: "https://track.dhl.com/123456789",
      carrier: "DHL",
    });
  });

  it("asks for a number rather than searching without one", async () => {
    const result = parse(await executeShopifyTool("get_shopify_order_status", {}, "widget-a"));
    expect(result).toEqual({ found: false, error: "missing_order_number" });
    expect(lookupOrderMock).not.toHaveBeenCalled();
  });

  it("refuses to look anything up when the shop isn't connected", async () => {
    loadAdminCredentialsMock.mockResolvedValue(null);
    const result = parse(await executeShopifyTool("get_shopify_order_status", { order_number: "10482" }, "widget-a"));
    expect(result).toEqual({ found: false, error: "not_connected" });
    expect(lookupOrderMock).not.toHaveBeenCalled();
  });

  // The merchant uninstalled or revoked the app. Recording it is what lets the
  // dashboard ask them to reconnect instead of failing silently forever.
  it("marks the connection for reconnection when Shopify rejects the token", async () => {
    lookupOrderMock.mockRejectedValue(new ShopifyAdminApiError("rejected", "unauthorized"));

    const result = parse(await executeShopifyTool("get_shopify_order_status", { order_number: "10482" }, "widget-a"));

    expect(result).toEqual({ found: false, error: "reauth_required" });
    expect(markReauthMock).toHaveBeenCalledWith("conn-1", "unauthorized");
  });

  it("uses the credentials of the widget on the call, never any in the arguments", async () => {
    await executeShopifyTool(
      "get_shopify_order_status",
      { order_number: "10482", shop_domain: "attacker.myshopify.com", widgetId: "widget-b" },
      "widget-a"
    );

    expect(loadAdminCredentialsMock).toHaveBeenCalledWith("widget-a");
    expect(lookupOrderMock).toHaveBeenCalledWith({
      shopDomain: "shop.myshopify.com",
      accessToken: "shpat_x",
      orderNumber: "10482",
    });
  });
});

// A tool call that throws mid-conversation leaves a caller listening to
// silence. Every failure has to come back as something the agent can say.
describe("failure handling", () => {
  it("never throws, whatever goes wrong underneath", async () => {
    lookupOrderMock.mockRejectedValue(new Error("network down"));
    expect(parse(await executeShopifyTool("get_shopify_order_status", { order_number: "1" }, "widget-a"))).toEqual({
      found: false,
      error: "unavailable",
    });

    loadCatalogMock.mockRejectedValue(new Error("db down"));
    expect(parse(await executeShopifyTool("search_shopify_products", { query: "sko" }, "widget-a"))).toEqual({
      found: false,
      error: "unavailable",
    });
  });

  it("answers an unknown tool name instead of crashing the call", async () => {
    expect(parse(await executeShopifyTool("delete_everything", {}, "widget-a"))).toEqual({ error: "unknown_tool" });
  });

  it("ignores a non-string query or order number rather than coercing it", async () => {
    const products = parse(await executeShopifyTool("search_shopify_products", { query: 42 }, "widget-a"));
    expect(products.query).toBe("");

    const order = parse(await executeShopifyTool("get_shopify_order_status", { order_number: { $ne: null } }, "widget-a"));
    expect(order).toEqual({ found: false, error: "missing_order_number" });
    expect(lookupOrderMock).not.toHaveBeenCalled();
  });
});
