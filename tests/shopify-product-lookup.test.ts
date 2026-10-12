import { describe, it, expect, vi, beforeEach } from "vitest";

// The live product lookup. The Admin API is stubbed; the query built for it,
// the variant matching and the field mapping under test are all real.
const graphQLMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(null));
vi.mock("@/lib/shopify/admin-api", () => ({
  shopifyAdminGraphQL: (...args: unknown[]) => graphQLMock(...args),
  SHOPIFY_API_VERSION: "2026-07",
  ShopifyAdminApiError: class extends Error {},
}));

import { searchShopifyProducts } from "@/lib/shopify/products";

const CREDENTIALS = { shopDomain: "myshop.myshopify.com", accessToken: "shpat_token" };

function variant(options: Record<string, string>, extra: Record<string, unknown> = {}) {
  return {
    title: Object.values(options).join(" / "),
    sku: "SKU-1",
    price: "899.00",
    availableForSale: true,
    inventoryQuantity: 4,
    selectedOptions: Object.entries(options).map(([name, value]) => ({ name, value })),
    ...extra,
  };
}

const NIKE = {
  title: "Nike Air Max",
  handle: "nike-air-max",
  onlineStoreUrl: "https://shop.dk/products/nike-air-max",
  productType: "Løbesko",
  vendor: "Nike",
  status: "ACTIVE",
  totalInventory: 9,
  priceRangeV2: {
    minVariantPrice: { amount: "899.00", currencyCode: "DKK" },
    maxVariantPrice: { amount: "999.00", currencyCode: "DKK" },
  },
  variants: {
    nodes: [
      variant({ Farve: "Sort", Størrelse: "42" }),
      variant({ Farve: "Sort", Størrelse: "43" }, { availableForSale: false, inventoryQuantity: 0 }),
    ],
  },
};

function productsResponse(nodes: unknown[]) {
  return { products: { nodes } };
}

beforeEach(() => graphQLMock.mockReset());

describe("searchShopifyProducts", () => {
  it("returns the live price, stock and the product's own storefront URL", async () => {
    graphQLMock.mockResolvedValueOnce(productsResponse([NIKE]));

    const result = await searchShopifyProducts({ ...CREDENTIALS, query: "Nike Air Max" });
    const [product] = result.products;

    expect(product).toMatchObject({
      name: "Nike Air Max",
      price: "899",
      price_max: "999",
      currency: "DKK",
      url: "https://shop.dk/products/nike-air-max",
      vendor: "Nike",
      available: true,
      total_inventory: 9,
    });
  });

  // The whole point of the change: only the products relevant to the question
  // come back, never the shop's catalogue.
  it("asks Shopify for the customer's terms rather than listing everything", async () => {
    graphQLMock.mockResolvedValueOnce(productsResponse([NIKE]));

    await searchShopifyProducts({ ...CREDENTIALS, query: "Nike sko i størrelse 42" });

    const call = graphQLMock.mock.calls[0]![0] as { variables: { query: string; first: number } };
    expect(call.variables.query).toContain("title:nike*");
    // Drafts and archived products are not for sale, so they are excluded.
    expect(call.variables.query).toContain("status:active");
    expect(call.variables.first).toBeLessThanOrEqual(5);
  });

  it("answers a size question about the exact variant", async () => {
    graphQLMock.mockResolvedValueOnce(productsResponse([NIKE]));

    const result = await searchShopifyProducts({ ...CREDENTIALS, query: "Nike sko i størrelse 42" });

    expect(result.requested_options).toEqual(["42"]);
    const matching = result.products[0]!.variants.filter((v) => v.matches_request);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({ title: "Sort / 42", available: true, inventory: 4, sku: "SKU-1" });
  });

  it("reports a size that exists but is sold out as sold out", async () => {
    graphQLMock.mockResolvedValueOnce(productsResponse([NIKE]));

    const result = await searchShopifyProducts({ ...CREDENTIALS, query: "Nike størrelse 43" });
    const matching = result.products[0]!.variants.find((v) => v.matches_request);

    expect(matching).toMatchObject({ title: "Sort / 43", available: false, inventory: 0 });
  });

  // Offering a product that has nothing in the requested size is not an answer
  // to the question that was asked.
  it("drops a product with no variant in the requested size", async () => {
    graphQLMock.mockResolvedValueOnce(
      productsResponse([{ ...NIKE, variants: { nodes: [variant({ Størrelse: "45" })] } }])
    );

    const result = await searchShopifyProducts({ ...CREDENTIALS, query: "Nike størrelse 42" });
    expect(result.products).toEqual([]);
  });

  it("ranks a product that has the size in stock above one that doesn't", async () => {
    const soldOut = {
      ...NIKE,
      title: "Nike Pegasus",
      onlineStoreUrl: "https://shop.dk/products/nike-pegasus",
      variants: { nodes: [variant({ Størrelse: "42" }, { availableForSale: false, inventoryQuantity: 0 })] },
    };
    graphQLMock.mockResolvedValueOnce(productsResponse([soldOut, NIKE]));

    const result = await searchShopifyProducts({ ...CREDENTIALS, query: "Nike størrelse 42" });
    expect(result.products[0]!.name).toBe("Nike Air Max");
  });

  // A URL built from the handle would 404 for an unpublished product, in front
  // of a customer who was about to buy. Null means "say no link".
  it("never fabricates a product URL", async () => {
    graphQLMock.mockResolvedValueOnce(productsResponse([{ ...NIKE, onlineStoreUrl: null }]));

    const result = await searchShopifyProducts({ ...CREDENTIALS, query: "Nike" });

    expect(result.products[0]!.url).toBeNull();
    expect(JSON.stringify(result)).not.toContain("nike-air-max");
  });

  it("hides Shopify's Default Title placeholder option", async () => {
    graphQLMock.mockResolvedValueOnce(
      productsResponse([{ ...NIKE, variants: { nodes: [variant({ Title: "Default Title" })] } }])
    );

    const result = await searchShopifyProducts({ ...CREDENTIALS, query: "Nike" });
    expect(result.products[0]!.variants[0]!.options).toEqual([]);
  });

  it("lists what the shop has when the question names no product", async () => {
    graphQLMock.mockResolvedValueOnce(productsResponse([NIKE]));

    const result = await searchShopifyProducts({ ...CREDENTIALS, query: "Hvad sælger I?" });

    const call = graphQLMock.mock.calls[0]![0] as { variables: { query: string } };
    expect(call.variables.query).toBe("status:active");
    expect(result.products).toHaveLength(1);
  });

  it("survives a product Shopify returns with missing fields", async () => {
    graphQLMock.mockResolvedValueOnce(productsResponse([{ title: "Bare produkt" }, { title: null }]));

    const result = await searchShopifyProducts({ ...CREDENTIALS, query: "produkt" });

    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ name: "Bare produkt", url: null, price: null, available: false });
  });
});

describe("productHandleFromIdentifier", () => {
  it("accepts the product URL the agent was just given", async () => {
    const { productHandleFromIdentifier } = await import("@/lib/shopify/products");
    expect(productHandleFromIdentifier("https://shop.dk/products/nike-air-max")).toBe("nike-air-max");
    expect(productHandleFromIdentifier("https://shop.dk/products/nike-air-max?variant=1#reviews")).toBe("nike-air-max");
  });

  it("accepts a bare handle", async () => {
    const { productHandleFromIdentifier } = await import("@/lib/shopify/products");
    expect(productHandleFromIdentifier("nike-air-max")).toBe("nike-air-max");
  });

  // A title is not a handle. Treating "Nike Air Max" as one would query for a
  // handle that doesn't exist and answer "we don't stock it".
  it("returns null for a product title, so it is matched as a title instead", async () => {
    const { productHandleFromIdentifier } = await import("@/lib/shopify/products");
    expect(productHandleFromIdentifier("Nike Air Max")).toBeNull();
    expect(productHandleFromIdentifier("https://shop.dk/collections/all")).toBeNull();
    expect(productHandleFromIdentifier("")).toBeNull();
  });
});

describe("getShopifyProduct", () => {
  it("looks a product up by its exact handle", async () => {
    const { getShopifyProduct } = await import("@/lib/shopify/products");
    graphQLMock.mockResolvedValueOnce(
      productsResponse([{ ...NIKE, description: "Let løbesko til asfalt.", collections: { nodes: [{ title: "Sko" }] } }])
    );

    const product = await getShopifyProduct({ ...CREDENTIALS, identifier: "https://shop.dk/products/nike-air-max" });

    const call = graphQLMock.mock.calls[0]![0] as { variables: { query: string } };
    expect(call.variables.query).toBe("handle:nike-air-max");
    expect(product).toMatchObject({
      name: "Nike Air Max",
      description: "Let løbesko til asfalt.",
      collections: ["Sko"],
      url: "https://shop.dk/products/nike-air-max",
    });
  });

  it("matches an exact title when no handle was given, rather than free-text searching", async () => {
    const { getShopifyProduct } = await import("@/lib/shopify/products");
    graphQLMock.mockResolvedValueOnce(productsResponse([NIKE]));

    await getShopifyProduct({ ...CREDENTIALS, identifier: 'Nike "Air" Max' });

    const call = graphQLMock.mock.calls[0]![0] as { variables: { query: string } };
    // The quotes the customer's text carried are stripped, so they cannot end
    // the term early and change which product is returned.
    expect(call.variables.query).toBe('title:"Nike Air Max"');
  });

  it("returns null when the shop has no such product", async () => {
    const { getShopifyProduct } = await import("@/lib/shopify/products");
    graphQLMock.mockResolvedValueOnce(productsResponse([]));
    expect(await getShopifyProduct({ ...CREDENTIALS, identifier: "findes-ikke" })).toBeNull();
  });
});
