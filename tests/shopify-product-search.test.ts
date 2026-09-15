import { describe, it, expect } from "vitest";
import { searchShopifyCatalog } from "@/lib/shopify/product-search";
import type { ShopifyCatalogProduct } from "@/lib/shopify/types";

function product(overrides: Partial<ShopifyCatalogProduct>): ShopifyCatalogProduct {
  return {
    title: "Produkt",
    handle: "produkt",
    url: "https://shop.dk/products/produkt",
    description: "",
    productType: null,
    vendor: null,
    tags: [],
    options: [],
    variants: [],
    priceMin: null,
    priceMax: null,
    imageUrl: null,
    available: true,
    ...overrides,
  };
}

const CATALOG: ShopifyCatalogProduct[] = [
  product({
    title: "Nike Air Max løbesko",
    handle: "nike-air-max",
    url: "https://shop.dk/products/nike-air-max",
    description: "Let løbesko til asfalt.",
    productType: "Løbesko",
    vendor: "Nike",
    tags: ["løb", "sko"],
    options: [
      { name: "Farve", values: ["Sort", "Hvid"] },
      { name: "Størrelse", values: ["42", "43", "44"] },
    ],
    variants: [
      { title: "Sort / 43", price: "899", compareAtPrice: null, available: true, sku: "NAM-S-43", options: ["Sort", "43"] },
      { title: "Hvid / 42", price: "899", compareAtPrice: null, available: false, sku: "NAM-H-42", options: ["Hvid", "42"] },
    ],
    priceMin: "899",
    priceMax: "899",
  }),
  product({
    title: "Regnjakke Herre",
    handle: "regnjakke",
    url: "https://shop.dk/products/regnjakke",
    description: "Vandtæt jakke med hætte.",
    productType: "Jakke",
    tags: ["regntøj"],
    options: [{ name: "Størrelse", values: ["S", "M", "L"] }],
    variants: [{ title: "M", price: "1299", compareAtPrice: null, available: true, sku: "RJ-M", options: ["M"] }],
    priceMin: "1299",
    priceMax: "1299",
  }),
  product({
    title: "Uldsokker 3-pak",
    handle: "uldsokker",
    url: "https://shop.dk/products/uldsokker",
    description: "Varme sokker i merinould.",
    productType: "Sokker",
    priceMin: "149",
    priceMax: "149",
    available: false,
  }),
];

describe("searchShopifyCatalog", () => {
  it("finds a product by name", () => {
    const results = searchShopifyCatalog(CATALOG, "Nike Air Max", "DKK");
    expect(results[0]?.name).toBe("Nike Air Max løbesko");
  });

  // "Har I størrelse 43?" — a size lives only in the option values, so this is
  // the case that fails if option values aren't searched.
  it("finds a product by a size that only exists as a variant option", () => {
    const results = searchShopifyCatalog(CATALOG, "løbesko i størrelse 43", "DKK");
    expect(results[0]?.name).toBe("Nike Air Max løbesko");
    expect(results[0]?.options.find((o) => o.name === "Størrelse")?.values).toContain("43");
  });

  it("finds a product by colour", () => {
    const results = searchShopifyCatalog(CATALOG, "sorte sko", "DKK");
    expect(results[0]?.name).toBe("Nike Air Max løbesko");
  });

  it("returns the price and currency the agent should quote", () => {
    const [first] = searchShopifyCatalog(CATALOG, "regnjakke", "DKK");
    expect(first).toMatchObject({ price: "1299", currency: "DKK", url: "https://shop.dk/products/regnjakke" });
  });

  it("reports per-variant availability rather than a single yes/no", () => {
    const [first] = searchShopifyCatalog(CATALOG, "Nike Air Max", "DKK");
    expect(first?.variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Sort / 43", available: true }),
        expect.objectContaining({ title: "Hvid / 42", available: false }),
      ])
    );
  });

  it("marks a sold-out product as unavailable instead of hiding it", () => {
    const [first] = searchShopifyCatalog(CATALOG, "uldsokker", "DKK");
    expect(first?.name).toBe("Uldsokker 3-pak");
    expect(first?.available).toBe(false);
  });

  // An empty result is the honest answer for something the shop doesn't sell.
  // Returning a near-miss would let the agent offer a product that isn't there.
  it("returns nothing for a product the shop does not sell", () => {
    expect(searchShopifyCatalog(CATALOG, "havetraktor", "DKK")).toEqual([]);
  });

  // "Hvad sælger I?" is a browse, not a search — answering with nothing would
  // be wrong, and is what a naive stop-word filter produces.
  it("treats an all-stop-word question as a browse", () => {
    // The spec's own opening question. It names no product, so the honest
    // answer is "here is what we have", not an empty list.
    expect(searchShopifyCatalog(CATALOG, "Hvad sælger I?", "DKK").length).toBeGreaterThan(0);
    expect(searchShopifyCatalog(CATALOG, "what do you sell", "DKK").length).toBeGreaterThan(0);
    expect(searchShopifyCatalog(CATALOG, "", "DKK").length).toBeGreaterThan(0);
  });

  it("filters out Shopify's Default Title placeholder option", () => {
    const catalog = [
      product({
        title: "Gavekort",
        options: [{ name: "Title", values: ["Default Title"] }],
      }),
    ];
    expect(searchShopifyCatalog(catalog, "gavekort", "DKK")[0]?.options).toEqual([]);
  });

  it("returns at most five products so a voice answer stays sayable", () => {
    const many = Array.from({ length: 30 }, (_, i) => product({ title: `Løbesko model ${i}`, handle: `sko-${i}` }));
    expect(searchShopifyCatalog(many, "løbesko", "DKK").length).toBe(5);
  });

  it("handles an empty catalogue without throwing", () => {
    expect(searchShopifyCatalog([], "løbesko", null)).toEqual([]);
  });
});
