import type { ShopifyCatalogProduct } from "./types";

// Searches the crawled catalogue in memory. No network, no Shopify account:
// this answers from the public storefront data the crawler already collected,
// which is what keeps product questions working for a customer who has saved
// their webshop URL but not yet run the OAuth install.
//
// Pure and dependency-free so the ranking can be tested directly.

const MAX_RESULTS = 5;
const MAX_DESCRIPTION_CHARS = 300;

export interface ShopifyProductMatch {
  name: string;
  price: string | null;
  price_max: string | null;
  currency: string | null;
  url: string;
  description: string;
  available: boolean;
  variants: { title: string; price: string | null; available: boolean | null }[];
  options: { name: string; values: string[] }[];
}

// Words that carry no signal in a product query — dropping them stops "har I
// sorte løbesko" from scoring every product that happens to contain "i".
const STOP_WORDS = new Set([
  "har", "i", "en", "et", "og", "til", "med", "på", "den", "det", "de", "er", "jeg", "vil", "gerne",
  "hvad", "koster", "hvilke", "hvilken", "findes", "kan", "man", "få", "købe", "jeres", "din", "dine",
  "the", "a", "an", "and", "or", "of", "for", "with", "do", "does", "you", "your", "have", "any",
  "in", "is", "it", "are", "we", "what", "which", "show", "me", "tell", "about", "there", "to", "buy",
  "size", "colour", "color", "størrelse", "farve", "farver",
  // "Hvad sælger I?" is a browse, not a search for a product called "salg".
  "sælger", "sælge", "salg", "sell", "sells", "sale", "selling", "stock", "lager",
]);

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

function scoreProduct(product: ShopifyCatalogProduct, tokens: string[]): number {
  const title = product.title.toLowerCase();
  const description = product.description.toLowerCase();
  const meta = [product.productType ?? "", product.vendor ?? "", ...product.tags].join(" ").toLowerCase();
  const optionValues = product.options
    .flatMap((option) => option.values)
    .concat(product.variants.flatMap((variant) => variant.options))
    .join(" ")
    .toLowerCase();

  let score = 0;

  for (const token of tokens) {
    // Weighted by how much each field says about what the product IS. A hit in
    // the title is close to decisive; one in the description is a hint.
    if (title.includes(token)) score += 10;
    if (meta.includes(token)) score += 4;
    // Option values are how "43" and "sort" find the right product — a size or
    // a colour appears nowhere else.
    if (optionValues.includes(token)) score += 4;
    if (description.includes(token)) score += 1;
  }

  // With everything else equal, offer something that can actually be bought.
  if (score > 0 && product.available) score += 2;

  return score;
}

export function searchShopifyCatalog(
  catalog: ShopifyCatalogProduct[],
  query: string,
  currency: string | null = null
): ShopifyProductMatch[] {
  const tokens = tokenize(query).filter((token) => !STOP_WORDS.has(token));

  // An empty or all-stop-word query ("hvad sælger I?") is a browse, not a
  // search — answer with what the shop has rather than nothing at all.
  const ranked =
    tokens.length === 0
      ? catalog.slice(0, MAX_RESULTS)
      : catalog
          .map((product) => ({ product, score: scoreProduct(product, tokens) }))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_RESULTS)
          .map((entry) => entry.product);

  return ranked.map((product) => ({
    name: product.title,
    price: product.priceMin,
    price_max: product.priceMax !== product.priceMin ? product.priceMax : null,
    currency,
    url: product.url,
    description: product.description.slice(0, MAX_DESCRIPTION_CHARS),
    available: product.available,
    variants: product.variants.map((variant) => ({
      title: variant.title,
      price: variant.price,
      available: variant.available,
    })),
    options: product.options.filter(
      (option) => option.values.length > 0 && option.values[0] !== "Default Title"
    ),
  }));
}
