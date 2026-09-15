import "server-only";
import { assertSafeHttpUrl } from "@/lib/security/ssrf";
import { stripHtml } from "@/lib/knowledge-base/url";
import { normalizeShopUrl } from "./domain";
import type {
  ShopifyCatalogProduct,
  ShopifyCatalogVariant,
  ShopifyCrawledPage,
  ShopifyCrawlResult,
} from "./types";

// Reads a customer's PUBLIC Shopify storefront and turns it into two things:
// a structured product catalogue (what search_shopify_products answers from)
// and the plain text of the shop's own information pages (shipping, returns,
// terms, FAQ, about, contact) for the agent's prompt.
//
// Everything here is data any visitor to the shop can see. No Shopify account
// and no access token is involved — that is the entire point of the split
// described in 0035_shopify_integration.sql. A customer who has only pasted
// their URL, and never run the OAuth install, still gets a fully working
// product-answering agent from this.

const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;

// products.json pages at 250 each. Four pages is 1000 products scanned; the
// catalogue itself is capped lower (MAX_CATALOG_PRODUCTS) because it has to
// fit in a jsonb column and be searched in memory on every tool call.
const MAX_PRODUCT_PAGES = 4;
const PRODUCTS_PER_PAGE = 250;
const MAX_CATALOG_PRODUCTS = 300;
const MAX_VARIANTS_PER_PRODUCT = 30;
const MAX_DESCRIPTION_CHARS = 600;

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

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await safeFetch(url);
  if (!response || !response.ok) return null;
  if (!(response.headers.get("content-type") ?? "").includes("json")) return null;

  const buffer = await response.arrayBuffer().catch(() => null);
  if (!buffer || buffer.byteLength > MAX_RESPONSE_BYTES) return null;
  try {
    return JSON.parse(new TextDecoder().decode(buffer)) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

interface RawVariant {
  title?: string;
  price?: string;
  compare_at_price?: string | null;
  available?: boolean;
  sku?: string | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
}

interface RawProduct {
  title?: string;
  handle?: string;
  body_html?: string;
  product_type?: string;
  vendor?: string;
  tags?: string[] | string;
  options?: { name?: string; values?: string[] }[];
  variants?: RawVariant[];
  images?: { src?: string }[];
}

function toNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapProduct(raw: RawProduct, origin: string): ShopifyCatalogProduct | null {
  const title = raw.title?.trim();
  const handle = raw.handle?.trim();
  if (!title || !handle) return null;

  const variants: ShopifyCatalogVariant[] = (raw.variants ?? [])
    .slice(0, MAX_VARIANTS_PER_PRODUCT)
    .map((variant) => ({
      title: variant.title?.trim() || "Standard",
      price: variant.price ?? null,
      compareAtPrice: variant.compare_at_price ?? null,
      available: typeof variant.available === "boolean" ? variant.available : null,
      sku: variant.sku?.trim() || null,
      options: [variant.option1, variant.option2, variant.option3]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim()),
    }));

  const prices = variants.map((v) => toNumber(v.price)).filter((v): v is number => v !== null);

  const tags = Array.isArray(raw.tags)
    ? raw.tags
    : typeof raw.tags === "string"
      ? raw.tags.split(",").map((tag) => tag.trim())
      : [];

  return {
    title,
    handle,
    url: `${origin}/products/${handle}`,
    description: stripHtml(raw.body_html ?? "").slice(0, MAX_DESCRIPTION_CHARS),
    productType: raw.product_type?.trim() || null,
    vendor: raw.vendor?.trim() || null,
    tags: tags.filter(Boolean).slice(0, 20),
    options: (raw.options ?? [])
      .map((option) => ({
        name: option.name?.trim() ?? "",
        values: (option.values ?? []).map((value) => value.trim()).filter(Boolean).slice(0, 40),
      }))
      .filter((option) => option.name.length > 0),
    variants,
    priceMin: prices.length > 0 ? String(Math.min(...prices)) : null,
    priceMax: prices.length > 0 ? String(Math.max(...prices)) : null,
    imageUrl: raw.images?.[0]?.src ?? null,
    // `available` is per-variant and can be absent; a product counts as
    // available when at least one variant says so. Unknown is not "sold out"
    // — claiming something is out of stock when it isn't costs a sale.
    available: variants.some((variant) => variant.available !== false),
  };
}

// The storefront's own products.json. It is public on every Shopify shop that
// hasn't explicitly disabled it, needs no credentials, and returns exactly
// the structured fields (variants, options, prices, availability) that would
// otherwise have to be scraped back out of rendered HTML.
async function crawlProducts(origin: string): Promise<ShopifyCatalogProduct[]> {
  const products: ShopifyCatalogProduct[] = [];

  for (let page = 1; page <= MAX_PRODUCT_PAGES; page++) {
    const payload = await fetchJson<{ products?: RawProduct[] }>(
      `${origin}/products.json?limit=${PRODUCTS_PER_PAGE}&page=${page}`
    );
    const batch = payload?.products;
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const raw of batch) {
      const product = mapProduct(raw, origin);
      if (product) products.push(product);
      if (products.length >= MAX_CATALOG_PRODUCTS) return products;
    }

    if (batch.length < PRODUCTS_PER_PAGE) break;
  }

  return products;
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
  const products = await crawlProducts(origin);

  // "Is this actually a Shopify shop?" — products.json answering is the
  // strongest signal, and the storefront markup naming Shopify is the
  // fallback for a shop with the JSON endpoint disabled or an empty
  // catalogue. A shop that is neither gets told its URL doesn't look right,
  // rather than silently indexing a WordPress site as a webshop.
  const looksLikeShopify =
    products.length > 0 ||
    (homepageHtml !== null && /cdn\.shopify\.com|shopify\.com\/s\/files|Shopify\.theme/i.test(homepageHtml));

  if (!homepageHtml && products.length === 0) throw new ShopifyCrawlError("unreachable");

  const pageUrls = new Set<string>(POLICY_PATHS.map((path) => `${origin}${path}`));
  if (homepageHtml) {
    for (const link of discoverInfoLinks(homepageHtml, origin)) pageUrls.add(link);
  }

  const pages: ShopifyCrawledPage[] = [];
  if (homepageHtml) {
    const text = stripHtml(homepageHtml).slice(0, MAX_PAGE_TEXT_CHARS);
    if (text.length >= 120) {
      pages.push({ title: extractTitle(homepageHtml) ?? "Forside", url: origin, text });
    }
  }

  const crawled = await Promise.all([...pageUrls].slice(0, MAX_INFO_PAGES).map((url) => crawlPage(url)));
  for (const page of crawled) {
    if (page) pages.push(page);
  }

  const meta = await fetchJson<{ currency?: string }>(`${origin}/meta.json`);

  return { products, pages, currency: meta?.currency?.trim() || null, looksLikeShopify };
}
