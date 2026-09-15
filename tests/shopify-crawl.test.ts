import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { crawlShopifyStore } from "@/lib/shopify/crawl";
import { formatShopifyKnowledge, replaceShopifySource, SHOPIFY_SOURCE_ID } from "@/lib/shopify/knowledge";
import { formatKnowledgeBaseForPrompt } from "@/lib/knowledge-base/format";
import type { KnowledgeBaseSource } from "@/lib/knowledge-base/types";

// The crawler reads the shop's public INFORMATION pages — and nothing else.
// Products, prices, variants and stock are live Admin API lookups
// (tests/shopify-product-lookup.test.ts), so a crawl that started fetching
// products again would be a regression, not a feature. That is asserted here.

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

  it("indexes the shop's own information pages", async () => {
    stubStorefront((url) => {
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
      if (isHomepage(url)) return htmlResponse(HOMEPAGE);
      return PAGE_HTML("Side");
    });

    await crawlShopifyStore("https://shop.dk");

    const requested = requestedUrls;
    expect(requested.some((url) => url.includes("facebook.com"))).toBe(false);
  });

  // shop.dk -> www.shop.dk is an ordinary, legitimate redirect; refusing it
  // would fail on a large share of real shops.

  // A redirect is the classic way past an SSRF hostname check, so the guard
  // has to run on every hop, not just the URL the customer typed.
  it("refuses a redirect into a private address", async () => {
    stubStorefront((url) => {
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
  it("never requests products.json — products come from the Admin API", async () => {
    stubStorefront((url) => (isHomepage(url) ? htmlResponse(HOMEPAGE) : PAGE_HTML("Side")));

    await crawlShopifyStore("https://shop.dk");

    expect(requestedUrls.some((url) => url.includes("products.json"))).toBe(false);
    expect(requestedUrls.some((url) => url.includes("/products/"))).toBe(false);
  });

  it("reports a site that isn't a Shopify shop", async () => {
    stubStorefront((url) => {
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
        pages: [{ title: "Fragt", url: "https://shop.dk/policies/shipping-policy", text: "Vi sender med DHL på 1-3 hverdage." }],
        looksLikeShopify: true,
      },
      "https://shop.dk"
    );

    expect(text).toContain("https://shop.dk");
    expect(text).toContain("Vi sender med DHL");
    // The prompt must point the agent at the tool for anything about a
    // product, so it never answers a price question from this text.
    expect(text).toContain("search_shopify_products");
  });

  it("stays within the prompt budget for a shop with a lot of policy text", () => {
    const pages = Array.from({ length: 20 }, (_, i) => ({
      title: `Side ${i}`,
      url: `https://shop.dk/pages/p-${i}`,
      text: "x".repeat(4_000),
    }));

    const text = formatShopifyKnowledge({ pages, looksLikeShopify: true }, "https://shop.dk");

    // The knowledge base is stuffed whole into the system prompt and shared
    // with the customer's own sources — one shop must not crowd it out.
    expect(text.length).toBeLessThanOrEqual(6_000);
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
