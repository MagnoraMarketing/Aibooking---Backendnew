import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { crawlShopifyStore } from "@/lib/shopify/crawl";
import { formatShopifyKnowledge, replaceShopifySource, SHOPIFY_SOURCE_ID } from "@/lib/shopify/knowledge";
import { formatKnowledgeBaseForPrompt } from "@/lib/knowledge-base/format";
import type { KnowledgeBaseSource } from "@/lib/knowledge-base/types";

// The crawler reads a real Shopify storefront's public endpoints. Everything
// below stubs the network and asserts on what it makes of the responses.

const PRODUCTS_JSON = {
  products: [
    {
      title: "Nike Air Max",
      handle: "nike-air-max",
      body_html: "<p>Let <b>løbesko</b> til asfalt.</p>",
      product_type: "Løbesko",
      vendor: "Nike",
      tags: ["løb", "sko"],
      options: [
        { name: "Farve", values: ["Sort", "Hvid"] },
        { name: "Størrelse", values: ["42", "43"] },
      ],
      variants: [
        { title: "Sort / 43", price: "899.00", compare_at_price: "999.00", available: true, sku: "S43", option1: "Sort", option2: "43" },
        { title: "Hvid / 42", price: "949.00", compare_at_price: null, available: false, sku: "H42", option1: "Hvid", option2: "42" },
      ],
      images: [{ src: "https://cdn.shopify.com/img.jpg" }],
    },
  ],
};

const HOMEPAGE = `<!doctype html><html><head><title>Shoppen</title></head><body>
  <script>window.Shopify = {};</script>
  <p>Velkommen til shoppen. Vi sender med DHL til hele Danmark, og du kan returnere alt inden for 30 dage. Vi har sko, jakker og sokker på lager, og vi pakker alle ordrer samme dag.</p>
  <a href="/pages/om-os">Om os</a>
  <a href="/pages/levering">Levering</a>
  <a href="/account/login">Log ind</a>
  <a href="/cart">Kurv</a>
  <a href="https://facebook.com/pages/om-os">Facebook</a>
  <link rel="stylesheet" href="https://cdn.shopify.com/s/files/theme.css">
</body></html>`;

function isHomepage(url: string): boolean {
  return /^https:\/\/(www\.)?shop\.dk\/?$/.test(url) || url === "https://ikke-en-shop.dk/";
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const PAGE_HTML = (title: string) =>
  htmlResponse(
    `<html><head><title>${title}</title></head><body><p>${"Her står vilkårene for shoppen. ".repeat(12)}</p></body></html>`
  );

// Every URL the crawler asked for, in order. Several tests assert on what it
// did NOT request, which is the point of recording them.
const requestedUrls: string[] = [];

function stubStorefront(handler: (url: string) => Response | null) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    requestedUrls.push(url);
    return handler(url) ?? new Response("not found", { status: 404 });
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  requestedUrls.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("crawlShopifyStore", () => {
  it("builds a structured catalogue from the storefront's products.json", async () => {
    stubStorefront((url) => {
      if (url.includes("/products.json?limit=250&page=1")) return jsonResponse(PRODUCTS_JSON);
      if (url.includes("/products.json")) return jsonResponse({ products: [] });
      if (url.includes("/meta.json")) return jsonResponse({ currency: "DKK" });
      if (isHomepage(url)) return htmlResponse(HOMEPAGE);
      if (url.includes("/policies/")) return PAGE_HTML("Handelsbetingelser");
      if (url.includes("/pages/")) return PAGE_HTML("Levering");
      return null;
    });

    const result = await crawlShopifyStore("shop.dk");

    expect(result.looksLikeShopify).toBe(true);
    expect(result.currency).toBe("DKK");
    expect(result.products).toHaveLength(1);

    const [product] = result.products;
    expect(product).toMatchObject({
      title: "Nike Air Max",
      handle: "nike-air-max",
      url: "https://shop.dk/products/nike-air-max",
      productType: "Løbesko",
      vendor: "Nike",
      // Cheapest and dearest variant, so the agent can quote "from 899".
      priceMin: "899",
      priceMax: "949",
      available: true,
    });
    // HTML out of body_html, so the prompt gets prose rather than markup.
    expect(product!.description).toBe("Let løbesko til asfalt.");
    expect(product!.options).toEqual([
      { name: "Farve", values: ["Sort", "Hvid"] },
      { name: "Størrelse", values: ["42", "43"] },
    ]);
    expect(product!.variants[0]).toMatchObject({ title: "Sort / 43", price: "899.00", available: true, options: ["Sort", "43"] });
    expect(product!.variants[1]).toMatchObject({ available: false });
  });

  it("indexes the shop's own information pages", async () => {
    stubStorefront((url) => {
      if (url.includes("/products.json")) return jsonResponse(PRODUCTS_JSON);
      if (url.includes("/meta.json")) return jsonResponse({ currency: "DKK" });
      if (isHomepage(url)) return htmlResponse(HOMEPAGE);
      if (url.includes("/policies/shipping-policy")) return PAGE_HTML("Fragt og levering");
      if (url.includes("/pages/levering")) return PAGE_HTML("Levering");
      return null;
    });

    const result = await crawlShopifyStore("https://shop.dk");
    const titles = result.pages.map((page) => page.title);

    expect(titles).toContain("Fragt og levering");
    // Discovered by following an internal /pages/ link off the homepage.
    expect(titles).toContain("Levering");
    expect(result.pages.map((page) => page.url)).toContain("https://shop.dk/pages/levering");
  });

  // "Den skal IKKE forsøge at crawle private/customer-only sider."
  it("never requests account, cart or checkout pages", async () => {
    stubStorefront((url) => {
      if (url.includes("/products.json")) return jsonResponse(PRODUCTS_JSON);
      if (url.includes("/meta.json")) return jsonResponse({ currency: "DKK" });
      if (isHomepage(url)) return htmlResponse(HOMEPAGE);
      return PAGE_HTML("Side");
    });

    await crawlShopifyStore("https://shop.dk");

    const requested = requestedUrls;
    expect(requested.some((url) => url.includes("/account"))).toBe(false);
    expect(requested.some((url) => url.includes("/cart"))).toBe(false);
    expect(requested.some((url) => url.includes("/checkout"))).toBe(false);
  });

  it("does not follow links off the shop's own domain", async () => {
    stubStorefront((url) => {
      if (url.includes("/products.json")) return jsonResponse(PRODUCTS_JSON);
      if (url.includes("/meta.json")) return jsonResponse({ currency: "DKK" });
      if (isHomepage(url)) return htmlResponse(HOMEPAGE);
      return PAGE_HTML("Side");
    });

    await crawlShopifyStore("https://shop.dk");

    const requested = requestedUrls;
    expect(requested.some((url) => url.includes("facebook.com"))).toBe(false);
  });

  // shop.dk -> www.shop.dk is an ordinary, legitimate redirect; refusing it
  // would fail on a large share of real shops.
  it("follows a redirect to the shop's canonical host", async () => {
    stubStorefront((url) => {
      if (url === "https://shop.dk/products.json?limit=250&page=1") {
        return new Response(null, { status: 301, headers: { location: "https://www.shop.dk/products.json" } });
      }
      if (url.includes("www.shop.dk/products.json")) return jsonResponse(PRODUCTS_JSON);
      if (url.includes("/products.json")) return jsonResponse({ products: [] });
      if (url.includes("/meta.json")) return jsonResponse({ currency: "DKK" });
      if (isHomepage(url)) return htmlResponse(HOMEPAGE);
      return PAGE_HTML("Side");
    });

    const result = await crawlShopifyStore("https://shop.dk");
    expect(result.products).toHaveLength(1);
  });

  // A redirect is the classic way past an SSRF hostname check, so the guard
  // has to run on every hop, not just the URL the customer typed.
  it("refuses a redirect into a private address", async () => {
    stubStorefront((url) => {
      if (url.includes("/products.json")) {
        return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
      }
      if (isHomepage(url)) {
        return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } });
      }
      return null;
    });

    await expect(crawlShopifyStore("https://shop.dk")).rejects.toThrow();
    const requested = requestedUrls;
    expect(requested.some((url) => url.includes("169.254.169.254"))).toBe(false);
    expect(requested.some((url) => url.includes("127.0.0.1"))).toBe(false);
  });

  it("refuses a private address outright", async () => {
    stubStorefront(() => htmlResponse(HOMEPAGE));
    await expect(crawlShopifyStore("http://localhost:3000")).rejects.toThrow();
    await expect(crawlShopifyStore("not a url at all")).rejects.toThrow();
  });

  // Telling the customer "that doesn't look like a Shopify shop" beats
  // silently indexing an unrelated website as their webshop.
  it("reports a site that isn't a Shopify shop", async () => {
    stubStorefront((url) => {
      if (url.includes("/products.json")) return htmlResponse("<html>404</html>", 404);
      if (url.includes("/meta.json")) return jsonResponse({});
      return htmlResponse("<html><head><title>Blog</title></head><body>Et wordpress-site</body></html>");
    });

    const result = await crawlShopifyStore("https://ikke-en-shop.dk");
    expect(result.looksLikeShopify).toBe(false);
  });

  it("throws when the shop can't be reached at all", async () => {
    stubStorefront(() => new Response("gone", { status: 500 }));
    await expect(crawlShopifyStore("https://shop.dk")).rejects.toThrow();
  });
});

describe("formatShopifyKnowledge", () => {
  it("writes an overview the agent can answer from, and points at the tool for detail", () => {
    const text = formatShopifyKnowledge(
      {
        products: [
          {
            title: "Nike Air Max",
            handle: "nike-air-max",
            url: "https://shop.dk/products/nike-air-max",
            description: "Let løbesko.",
            productType: "Løbesko",
            vendor: "Nike",
            tags: [],
            options: [{ name: "Størrelse", values: ["42", "43"] }],
            variants: [],
            priceMin: "899",
            priceMax: "949",
            imageUrl: null,
            available: true,
          },
        ],
        pages: [{ title: "Fragt", url: "https://shop.dk/policies/shipping-policy", text: "Vi sender med DHL på 1-3 hverdage." }],
        currency: "DKK",
        looksLikeShopify: true,
      },
      "https://shop.dk"
    );

    expect(text).toContain("https://shop.dk");
    expect(text).toContain("Nike Air Max");
    expect(text).toContain("899–949 DKK");
    expect(text).toContain("Størrelse: 42/43");
    expect(text).toContain("search_shopify_products");
    expect(text).toContain("Vi sender med DHL");
  });

  it("stays within the prompt budget for a very large shop", () => {
    const many = Array.from({ length: 400 }, (_, i) => ({
      title: `Produkt ${i}`,
      handle: `p-${i}`,
      url: `https://shop.dk/products/p-${i}`,
      description: "x".repeat(600),
      productType: null,
      vendor: null,
      tags: [],
      options: [],
      variants: [],
      priceMin: "100",
      priceMax: "100",
      imageUrl: null,
      available: true,
    }));

    const text = formatShopifyKnowledge(
      { products: many, pages: [], currency: "DKK", looksLikeShopify: true },
      "https://shop.dk"
    );

    // The knowledge base is stuffed whole into the system prompt and shared
    // with the customer's own sources — one shop must not crowd it out.
    expect(text.length).toBeLessThanOrEqual(12_000);
  });
});

describe("replaceShopifySource", () => {
  function source(id: string, chars: number): KnowledgeBaseSource {
    return {
      id,
      type: id === SHOPIFY_SOURCE_ID ? "shopify" : "text",
      label: id,
      content: `${id}:${"x".repeat(chars)}`,
      characterCount: chars,
      costSeconds: 0,
      createdAt: "2026-09-15T18:00:00Z",
    };
  }

  it("updates the shop in place instead of stacking a second copy", () => {
    const existing = [source("own-notes", 10), source(SHOPIFY_SOURCE_ID, 10)];
    const updated = replaceShopifySource(existing, source(SHOPIFY_SOURCE_ID, 20));

    expect(updated.filter((entry) => entry.id === SHOPIFY_SOURCE_ID)).toHaveLength(1);
    expect(updated).toHaveLength(2);
    expect(updated.find((entry) => entry.id === SHOPIFY_SOURCE_ID)?.characterCount).toBe(20);
  });

  it("removes it when the webshop is disconnected", () => {
    const updated = replaceShopifySource([source("own-notes", 10), source(SHOPIFY_SOURCE_ID, 10)], null);
    expect(updated.map((entry) => entry.id)).toEqual(["own-notes"]);
  });

  // The prompt budget is shared and filled in array order. A customer with a
  // lot of their own uploads would otherwise connect a webshop and get an
  // agent that could not name a single product.
  it("keeps the webshop in the prompt even when the customer's own sources fill the budget", () => {
    const existing = [source("own-notes", 25_000)];
    const updated = replaceShopifySource(existing, source(SHOPIFY_SOURCE_ID, 5_000));

    const prompt = formatKnowledgeBaseForPrompt(updated);
    expect(prompt).toContain(`${SHOPIFY_SOURCE_ID}:`);
  });
});
