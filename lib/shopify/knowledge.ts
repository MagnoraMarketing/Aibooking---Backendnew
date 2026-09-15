import type { KnowledgeBaseSource } from "@/lib/knowledge-base/types";
import type { ShopifyCrawlResult } from "./types";

// The shop's own information pages, formatted as the one knowledge-base
// source the webshop integration writes.
//
// Note what is NOT here: products, prices, variants, stock. Those are live
// Admin API lookups (lib/shopify/products.ts) made per question, so the agent
// quotes today's price and today's stock rather than a snapshot. What remains
// is the prose a customer asks about but no API answers well — delivery
// times, shipping cost, returns, terms, FAQ — which is small, changes rarely,
// and is worth having in the prompt so 'hvor lang tid tager levering?' does
// not need a tool call.
const MAX_TOTAL_CHARS = 6_000;
const MAX_PAGE_CHARS = 1_400;

export const SHOPIFY_SOURCE_ID = "shopify-webshop";

export function formatShopifyKnowledge(result: ShopifyCrawlResult, shopUrl: string): string {
  const sections: string[] = [
    [
      `Virksomhedens webshop er ${shopUrl}.`,
      "Nedenstående er shoppens egne informationssider om levering, retur, betaling og lignende.",
      "Produkter, priser, størrelser, farver og lagerstatus står IKKE her — dem slår du altid op med search_shopify_products,",
      "så du citerer den aktuelle pris og lagerstatus i stedet for at gætte.",
    ].join(" "),
  ];

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
