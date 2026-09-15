import "server-only";
import { assertSafeHttpUrl } from "@/lib/security/ssrf";
import { stripHtml } from "@/lib/knowledge-base/url";
import { normalizeShopUrl } from "./domain";
import type { ShopifyCrawledPage, ShopifyCrawlResult } from "./types";

// Reads the shop's own PUBLIC information pages — shipping, returns, terms,
// FAQ, about, contact — as plain text for the agent's prompt.
//
// It deliberately does NOT read products. Product names, prices, variants,
// sizes, colours, SKUs and stock are live Shopify Admin API lookups made per
// question (lib/shopify/products.ts), so the agent answers from what the shop
// holds right now instead of from a catalogue copied into its prompt at some
// earlier sync. The two must not overlap: a stale price quoted confidently is
// worse than no price at all.

const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const MAX_INFO_PAGES = 14;
const MAX_PAGE_TEXT_CHARS = 4_000;

const USER_AGENT = "AIbookingShopBot/1.0";

// Shopify serves every shop's policies at these fixed paths, so they need no
// discovery — and they are exactly the pages a customer asks an agent about.
const POLICY_PATHS = [
  "/policies/shipping-policy",
  "/policies/refund-policy",
  "/policies/terms-of-service",
  "/policies/privacy-policy",
  "/policies/contact-information",
];

// Anything a logged-in customer sees is off limits: it is either personal
// data or a page that only exists behind a session. Checkout and cart are
// excluded for the same reason plus a practical one — they are per-visitor
// and carry nothing worth indexing.
const PRIVATE_PATH_PATTERNS = [
  /^\/account/i,
  /^\/cart/i,
  /^\/checkout/i,
  /^\/orders/i,
  /^\/admin/i,
  /^\/apps/i,
  /^\/tools/i,
  /^\/customer_identity/i,
  /^\/challenge/i,
  /^\/wallets/i,
  /^\/services/i,
  /^\/recover/i,
  /^\/\.well-known/i,
];

// Which discovered /pages/ links are worth a request. A shop can have dozens;
// these are the ones that answer the questions an agent actually gets.
const INTERESTING_PAGE_KEYWORDS = [
  "about", "om-os", "om", "contact", "kontakt", "faq", "help", "hjaelp", "hjælp",
  "shipping", "delivery", "fragt", "levering", "forsendelse",
  "return", "retur", "refund", "fortrydelse", "bytte",
  "terms", "betingelser", "handelsbetingelser", "vilkaar", "vilkår",
  "payment", "betaling", "size", "storrelse", "størrelse", "guide", "care",
];

export class ShopifyCrawlError extends Error {}

function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

// Follows redirects by hand instead of handing them to fetch(): a customer's
// URL can legitimately redirect (shop.dk -> www.shop.dk), but an unchecked
// `redirect: "follow"` would also follow one into a private address, which is
// precisely what assertSafeHttpUrl exists to prevent. So every hop is checked
// again before it is taken.
async function safeFetch(rawUrl: string): Promise<Response | null> {
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let url: URL;
    try {
      url = new URL(current);
      assertSafeHttpUrl(url);
    } catch {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json" },
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      current = new URL(location, url).toString();
      continue;
    }

    return response;
  }

  return null;
}

async function fetchText(url: string): Promise<string | null> {
  const response = await safeFetch(url);
  if (!response || !response.ok) return null;

  const buffer = await response.arrayBuffer().catch(() => null);
  if (!buffer || buffer.byteLength > MAX_RESPONSE_BYTES) return null;
  return new TextDecoder().decode(buffer);
}

// ---------------------------------------------------------------------------
// Information pages
// ---------------------------------------------------------------------------

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match?.[1] ? stripHtml(match[1]).slice(0, 120) : null;
}

// Internal links only, from this exact origin. A link to an external site is
// somebody else's content and is not ours to index.
function discoverInfoLinks(html: string, origin: string): string[] {
  const found = new Set<string>();

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    const href = match[1];
    if (!href) continue;

    let url: URL;
    try {
      url = new URL(href, origin);
    } catch {
      continue;
    }

    if (`${url.protocol}//${url.host}` !== origin) continue;
    if (isPrivatePath(url.pathname)) continue;
    if (!/^\/(pages|blogs)\//i.test(url.pathname)) continue;

    const slug = url.pathname.toLowerCase();
    if (!INTERESTING_PAGE_KEYWORDS.some((keyword) => slug.includes(keyword))) continue;

    found.add(`${origin}${url.pathname}`);
    if (found.size >= MAX_INFO_PAGES) break;
  }

  return [...found];
}

async function crawlPage(url: string): Promise<ShopifyCrawledPage | null> {
  const html = await fetchText(url);
  if (!html) return null;

  const text = stripHtml(html).slice(0, MAX_PAGE_TEXT_CHARS);
  // A Shopify policy page that was never filled in still renders a shell of
  // nav and footer. Below this it carries no answer worth giving.
  if (text.length < 120) return null;

  return { title: extractTitle(html) ?? url, url, text };
}

// ---------------------------------------------------------------------------

export async function crawlShopifyStore(rawShopUrl: string): Promise<ShopifyCrawlResult> {
  const normalized = normalizeShopUrl(rawShopUrl);
  if (!normalized) throw new ShopifyCrawlError("invalid_url");

  const { origin } = normalized;

  const homepageHtml = await fetchText(origin);
  if (!homepageHtml) throw new ShopifyCrawlError("unreachable");

  // "Is this actually a Shopify shop?" — the storefront markup naming Shopify
  // is the signal. Telling the customer their address doesn't look right beats
  // silently indexing an unrelated website as their webshop.
  const looksLikeShopify = /cdn\.shopify\.com|shopify\.com\/s\/files|Shopify\.theme|myshopify\.com/i.test(
    homepageHtml
  );

  const pageUrls = new Set<string>(POLICY_PATHS.map((path) => `${origin}${path}`));
  for (const link of discoverInfoLinks(homepageHtml, origin)) pageUrls.add(link);

  const pages: ShopifyCrawledPage[] = [];
  const homepageText = stripHtml(homepageHtml).slice(0, MAX_PAGE_TEXT_CHARS);
  if (homepageText.length >= 120) {
    pages.push({ title: extractTitle(homepageHtml) ?? "Forside", url: origin, text: homepageText });
  }

  const crawled = await Promise.all([...pageUrls].slice(0, MAX_INFO_PAGES).map((url) => crawlPage(url)));
  for (const page of crawled) {
    if (page) pages.push(page);
  }

  return { pages, looksLikeShopify };
}
