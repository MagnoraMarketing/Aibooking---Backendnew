import { describe, it, expect, vi, beforeEach } from "vitest";

// The tools the agent is given, and what comes back when it calls them. Voice
// and chat both run through exactly this, so anything asserted here holds on
// the phone and in the widget alike.

const loadAdminCredentialsMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(null));
const markReauthMock = vi.fn((..._args: unknown[]) => Promise.resolve<void>(undefined));
const lookupOrderMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(null));
const searchProductsMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(null));
const getProductMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(null));
const shopInfoMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(null));

vi.mock("@/lib/shopify/connection", () => ({
  loadAdminCredentials: (...args: unknown[]) => loadAdminCredentialsMock(...args),
  markConnectionNeedsReauth: (...args: unknown[]) => markReauthMock(...args),
}));

vi.mock("@/lib/shopify/orders", () => ({
  lookupShopifyOrder: (...args: unknown[]) => lookupOrderMock(...args),
}));

vi.mock("@/lib/shopify/products", () => ({
  searchShopifyProducts: (...args: unknown[]) => searchProductsMock(...args),
  getShopifyProduct: (...args: unknown[]) => getProductMock(...args),
}));

vi.mock("@/lib/shopify/shop-info", () => ({
  fetchShopifyShopInfo: (...args: unknown[]) => shopInfoMock(...args),
}));

import { ShopifyAdminApiError } from "@/lib/shopify/admin-api";
import {
  executeShopifyTool,
  isShopifyToolName,
  resolveShopifyCapabilities,
  SHOPIFY_TOOL_NAMES,
} from "@/lib/shopify/agent-tools";
import { buildShopifyAnthropicTools, buildShopifyVapiTools } from "@/lib/shopify/tool-definitions";

const PRODUCT = {
  name: "Nike Air Max",
  price: "899",
  price_max: null,
  currency: "DKK",
  url: "https://shop.dk/products/nike-air-max",
  product_type: "Løbesko",
  vendor: "Nike",
  available: true,
  total_inventory: 4,
  variants: [
    {
      title: "Sort / 42",
      sku: "S42",
      price: "899",
      currency: "DKK",
      available: true,
      inventory: 4,
      options: [{ name: "Størrelse", value: "42" }],
      matches_request: true,
    },
  ],
};

const CREDENTIALS = {
  connectionId: "conn-1",
  shopDomain: "shop.myshopify.com",
  accessToken: "shpat_x",
  scopes: "read_products,read_orders,read_legal_policies",
};

function parse(result: string): Record<string, unknown> {
  return JSON.parse(result) as Record<string, unknown>;
}

beforeEach(() => {
  loadAdminCredentialsMock.mockReset().mockResolvedValue(CREDENTIALS);
  searchProductsMock.mockReset().mockResolvedValue({ products: [PRODUCT], requested_options: ["42"] });
  getProductMock.mockReset().mockResolvedValue(PRODUCT);
  shopInfoMock.mockReset().mockResolvedValue({
    shop_name: "Shoppen",
    currency: "DKK",
    contact_email: "hej@shop.dk",
    policies: [
      { kind: "shipping", title: "Levering", body: "Vi sender med DHL på 1-3 hverdage.", url: "https://shop.dk/policies/shipping-policy" },
    ],
  });
  // mockReset() alone strips the async implementation, leaving a mock that
  // returns undefined — which would make the production `.catch()` on its
  // promise throw and mask the branch under test.
  markReauthMock.mockReset().mockResolvedValue(undefined);
  lookupOrderMock.mockReset().mockResolvedValue({ found: true, order_number: "10482", status: "fulfilled" });
});

describe("resolveShopifyCapabilities", () => {
  it("follows the scopes Shopify actually granted, not the ones we asked for", async () => {
    expect(await resolveShopifyCapabilities("widget-a")).toEqual({
      products: true,
      orders: true,
      policies: true,
    });

    // A merchant who installed the app before a scope was added keeps what
    // they granted. Handing the agent a tool it cannot fulfil would just make
    // it fail mid-conversation.
    loadAdminCredentialsMock.mockResolvedValue({ ...CREDENTIALS, scopes: "read_orders" });
    expect(await resolveShopifyCapabilities("widget-a")).toEqual({
      products: false,
      orders: true,
      policies: false,
    });

    // Not connected at all.
    loadAdminCredentialsMock.mockResolvedValue(null);
    expect(await resolveShopifyCapabilities("widget-a")).toEqual({
      products: false,
      orders: false,
      policies: false,
    });
  });
});

describe("the tools an assistant is given", () => {
  it("offers nothing when no webshop is connected", () => {
    expect(buildShopifyVapiTools({ products: false, orders: false, policies: false })).toEqual([]);
    expect(buildShopifyAnthropicTools({ products: false, orders: false, policies: false })).toEqual([]);
  });

  // Offering a tool the widget can't fulfil teaches the agent to promise
  // something it then fails at — worse than not offering it.
  it("offers only what the granted scopes allow", () => {
    expect(
      buildShopifyVapiTools({ products: true, orders: false, policies: false }).map((tool) => tool.function.name)
    ).toEqual(["search_shopify_products", "get_shopify_product"]);
    expect(
      buildShopifyVapiTools({ products: false, orders: true, policies: false }).map((tool) => tool.function.name)
    ).toEqual(["get_shopify_order_status"]);
    expect(
      buildShopifyVapiTools({ products: false, orders: false, policies: true }).map((tool) => tool.function.name)
    ).toEqual(["get_shopify_shop_info"]);
  });

  // The agent is told to copy the tool's url verbatim. A description that
  // stopped saying so would let it start building links from product names,
  // which 404 in front of a customer about to buy.
  it("tells the agent to use the product's real link and never invent one", () => {
    const description = buildShopifyAnthropicTools({ products: true, orders: false, policies: false })[0]!.description!;
    expect(description).toContain("[Se produkt](url)");
    expect(description).toMatch(/opfind aldrig et link/i);
  });

  it("gives voice and chat exactly the same tools and descriptions", () => {
    const capabilities = { products: true, orders: true, policies: true };
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
    expect(result.requested_options).toEqual(["42"]);
    expect((result.products as Record<string, unknown>[])[0]).toMatchObject({
      name: "Nike Air Max",
      price: "899",
      currency: "DKK",
      url: "https://shop.dk/products/nike-air-max",
    });
  });

  // The behaviour the whole rework exists for: the question goes to Shopify,
  // not to a catalogue sitting in the agent's prompt.
  it("queries Shopify live with the customer's own words", async () => {
    await executeShopifyTool("search_shopify_products", { query: "Nike i størrelse 42" }, "widget-a");

    expect(searchProductsMock).toHaveBeenCalledWith({
      shopDomain: "shop.myshopify.com",
      accessToken: "shpat_x",
      query: "Nike i størrelse 42",
    });
  });

  it("says so plainly when the shop has no such product", async () => {
    searchProductsMock.mockResolvedValue({ products: [], requested_options: [] });
    const result = parse(await executeShopifyTool("search_shopify_products", { query: "havetraktor" }, "widget-a"));
    expect(result).toMatchObject({ found: false, products: [] });
  });

  it("refuses to look anything up when Shopify isn't connected", async () => {
    loadAdminCredentialsMock.mockResolvedValue(null);
    const result = parse(await executeShopifyTool("search_shopify_products", { query: "sko" }, "widget-a"));
    expect(result).toMatchObject({ found: false, error: "not_connected" });
    expect(searchProductsMock).not.toHaveBeenCalled();
  });

  it("marks the connection for reconnection when Shopify rejects the token", async () => {
    searchProductsMock.mockRejectedValue(new ShopifyAdminApiError("rejected", "unauthorized"));

    const result = parse(await executeShopifyTool("search_shopify_products", { query: "sko" }, "widget-a"));

    expect(result).toMatchObject({ found: false, error: "reauth_required" });
    expect(markReauthMock).toHaveBeenCalledWith("conn-1", "unauthorized");
  });

  it("uses the credentials of the widget on the call, not any in the arguments", async () => {
    await executeShopifyTool("search_shopify_products", { query: "sko", widgetId: "widget-b" }, "widget-a");
    expect(loadAdminCredentialsMock).toHaveBeenCalledWith("widget-a");
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

describe("get_shopify_product", () => {
  it("returns one product's full detail", async () => {
    const result = parse(await executeShopifyTool("get_shopify_product", { identifier: "nike-air-max" }, "widget-a"));

    expect(result.found).toBe(true);
    expect(result.product).toMatchObject({ name: "Nike Air Max", url: "https://shop.dk/products/nike-air-max" });
    expect(getProductMock).toHaveBeenCalledWith({
      shopDomain: "shop.myshopify.com",
      accessToken: "shpat_x",
      identifier: "nike-air-max",
    });
  });

  it("asks for an identifier rather than guessing one", async () => {
    const result = parse(await executeShopifyTool("get_shopify_product", {}, "widget-a"));
    expect(result).toEqual({ found: false, error: "missing_identifier" });
    expect(getProductMock).not.toHaveBeenCalled();
  });

  it("says not found rather than returning a different product", async () => {
    getProductMock.mockResolvedValue(null);
    const result = parse(await executeShopifyTool("get_shopify_product", { identifier: "findes-ikke" }, "widget-a"));
    expect(result).toEqual({ found: false });
  });
});

describe("get_shopify_shop_info", () => {
  // "Hvor lang tid tager levering?" used to be answered from crawled text in
  // the prompt. It is a live policy read now, so the agent quotes what the
  // merchant has in Shopify today.
  it("returns the shop's own delivery and returns text", async () => {
    const result = parse(await executeShopifyTool("get_shopify_shop_info", {}, "widget-a"));

    expect(result.found).toBe(true);
    expect((result.policies as Record<string, unknown>[])[0]).toMatchObject({
      kind: "shipping",
      body: "Vi sender med DHL på 1-3 hverdage.",
      url: "https://shop.dk/policies/shipping-policy",
    });
  });

  it("narrows to the policy that was asked about", async () => {
    await executeShopifyTool("get_shopify_shop_info", { topics: ["shipping"] }, "widget-a");
    expect(shopInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({ which: ["shipping"] })
    );
  });

  it("ignores a topic value it doesn't recognise instead of passing it through", async () => {
    await executeShopifyTool("get_shopify_shop_info", { topics: ["nonsense", 42] }, "widget-a");
    expect(shopInfoMock).toHaveBeenCalledWith(expect.objectContaining({ which: undefined }));
  });

  it("refuses when Shopify isn't connected", async () => {
    loadAdminCredentialsMock.mockResolvedValue(null);
    const result = parse(await executeShopifyTool("get_shopify_shop_info", {}, "widget-a"));
    expect(result).toMatchObject({ found: false, error: "not_connected" });
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

    searchProductsMock.mockRejectedValue(new Error("shopify down"));
    expect(parse(await executeShopifyTool("search_shopify_products", { query: "sko" }, "widget-a"))).toMatchObject({
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
