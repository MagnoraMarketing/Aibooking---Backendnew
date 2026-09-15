import type { KnowledgeBaseSource } from "@/lib/knowledge-base/types";
import type { ShopifyCatalogProduct, ShopifyCrawlResult } from "./types";

// Turns a storefront crawl into the one knowledge-base source the agent reads
// from its prompt. Kept free of server-only imports so it can be unit-tested
// as the pure formatter it is.
//
// The prompt gets an OVERVIEW — enough to answer "what do you sell?", "what
// does it cost?", "how long is delivery?" without a tool call. Anything more
// specific ("do you have it in size 43?") is what search_shopify_products is
// for, which reads the full catalogue server-side. So this budget is
// deliberately modest: the knowledge base is stuffed whole into the system
// prompt (see lib/knowledge-base/format.ts) and is shared with every other
// source the customer added.
const MAX_TOTAL_CHARS = 12_000;
const MAX_PRODUCTS_IN_PROMPT = 60;
const MAX_PAGE_CHARS = 1_400;

export const SHOPIFY_SOURCE_ID = "shopify-webshop";

function formatPrice(product: ShopifyCatalogProduct, currency: string | null): string | null {
  if (!product.priceMin) return null;
  const suffix = currency ? ` ${currency}` : "";
  if (product.priceMax && product.priceMax !== product.priceMin) {
    return `${product.priceMin}–${product.priceMax}${suffix}`;
  }
  return `${product.priceMin}${suffix}`;
}

function describeProduct(product: ShopifyCatalogProduct, currency: string | null): string {
  const bits: string[] = [product.title];

  const price = formatPrice(product, currency);
  if (price) bits.push(`pris ${price}`);

  for (const option of product.options) {
    // Shopify names the placeholder option on a product with no real variants
    // "Title" with the single value "Default Title" — noise, not an option.
    if (option.values.length === 0 || option.values[0] === "Default Title") continue;
    bits.push(`${option.name}: ${option.values.join("/")}`);
  }

  if (!product.available) bits.push("udsolgt");
  bits.push(product.url);

  return `- ${bits.join(" — ")}`;
}

export function formatShopifyKnowledge(result: ShopifyCrawlResult, shopUrl: string): string {
  const sections: string[] = [
    `Webshoppen ${shopUrl} er forbundet til denne agent. Nedenstående er hentet direkte fra shoppens offentlige sider.`,
  ];

  if (result.products.length > 0) {
    const shown = result.products.slice(0, MAX_PRODUCTS_IN_PROMPT);
    const lines = shown.map((product) => describeProduct(product, result.currency));
    sections.push(
      [
        `## Produkter (${shown.length} af ${result.products.length})`,
        "Brug funktionen search_shopify_products til at slå et bestemt produkt, en størrelse eller en farve op — listen her er kun et overblik.",
        ...lines,
      ].join("\n")
    );
  }

  for (const page of result.pages) {
    sections.push(`## ${page.title}\n${page.url}\n${page.text.slice(0, MAX_PAGE_CHARS)}`);
  }

  return sections.join("\n\n").slice(0, MAX_TOTAL_CHARS);
}

// Replaces the widget's Shopify source in place, under one fixed id, so a
// re-sync updates the shop rather than stacking a second copy of it.
//
// It goes FIRST, not last. formatKnowledgeBaseForPrompt fills a single 20,000
// character budget in array order and drops whatever doesn't fit — so a
// customer with a lot of their own uploaded content would otherwise see the
// webshop they just connected silently truncated to nothing, and an agent that
// couldn't name a single product. The Shopify source caps itself at 12,000
// (MAX_TOTAL_CHARS above), which leaves room for the rest.
export function replaceShopifySource(
  existing: KnowledgeBaseSource[],
  source: KnowledgeBaseSource | null
): KnowledgeBaseSource[] {
  const others = existing.filter((entry) => entry.id !== SHOPIFY_SOURCE_ID);
  return source ? [source, ...others] : others;
}
