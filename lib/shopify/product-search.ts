// Turning a customer's own words into a Shopify product query, and picking the
// variant they actually asked about out of what comes back.
//
// Pure and dependency-free: no network, no database. lib/shopify/products.ts
// runs the query this builds against the Admin API.
//
// This file used to rank a crawled catalogue held in our own database. It
// doesn't any more — the catalogue is gone, and the only product data that
// reaches the agent is what a live Shopify query returns for the question
// being asked.

// Words that carry no signal in a product query — dropping them stops "har I
// sorte løbesko" from searching for the word "i".
const STOP_WORDS = new Set([
  "har", "i", "en", "et", "og", "til", "med", "på", "den", "det", "de", "er", "jeg", "vil", "gerne",
  "hvad", "koster", "hvilke", "hvilken", "findes", "kan", "man", "få", "købe", "jeres", "din", "dine",
  "the", "a", "an", "and", "or", "of", "for", "with", "do", "does", "you", "your", "have", "any",
  "in", "is", "it", "are", "we", "what", "which", "show", "me", "tell", "about", "there", "to", "buy",
  // "Hvad sælger I?" is a browse, not a search for a product called "salg".
  "sælger", "sælge", "salg", "sell", "sells", "sale", "selling", "stock", "lager",
  // These name the ATTRIBUTE, not the product: "størrelse 42" should search
  // for nothing and match the variant option value 42.
  "størrelse", "str", "size", "farve", "farver", "colour", "color",
]);

// A token that describes a variant rather than a product. Sizes are the common
// case and are almost always numeric ("42", "43", "XL"), so they are matched
// against option VALUES rather than sent to Shopify's product search — which
// indexes titles, tags, vendors and types, not option values.
const SIZE_LIKE = /^(\d{1,3}([.,]\d)?|xxs|xs|s|m|l|xl|xxl|xxxl|one ?size)$/i;

export interface ParsedProductQuery {
  /** Shopify product query syntax, or null for a plain browse. */
  shopifyQuery: string | null;
  /** Free-text terms describing the product itself. */
  productTerms: string[];
  /** Terms that look like a size or other variant option value. */
  variantTerms: string[];
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}.,]+/u)
    .map((token) => token.replace(/^[.,]+|[.,]+$/g, ""))
    .filter((token) => token.length > 0);
}

// Shopify's search query syntax gives ':' '(' ')' '"' and '\' their own
// meaning. A customer's words are data, not syntax, so anything structural is
// dropped before the term is interpolated — a stray quote would otherwise
// change which products the query returns.
function escapeTerm(term: string): string {
  return term.replace(/[\\"():*~^<>=-]/g, "").trim();
}

export function parseProductQuery(query: string): ParsedProductQuery {
  const tokens = tokenize(query).filter((token) => !STOP_WORDS.has(token));

  const variantTerms: string[] = [];
  const productTerms: string[] = [];
  for (const token of tokens) {
    (SIZE_LIKE.test(token) ? variantTerms : productTerms).push(token);
  }

  const usable = productTerms.map(escapeTerm).filter((term) => term.length > 1);

  if (usable.length === 0) {
    // "Hvad sælger I?" names no product. A null query lists what the shop has
    // rather than searching for nothing and answering "we sell nothing".
    return { shopifyQuery: null, productTerms, variantTerms };
  }

  // Each term is OR'd across the fields Shopify indexes, and the groups are
  // AND'd — so "nike løbesko" needs both words somewhere, while either may sit
  // in the title, the tags, the type or the vendor. Trailing '*' is a prefix
  // match ("sko*" finds "skorem"); Shopify does not support a leading one.
  const shopifyQuery = usable
    .map((term) => `(title:${term}* OR tag:${term}* OR product_type:${term}* OR vendor:${term}*)`)
    .join(" AND ");

  return { shopifyQuery, productTerms, variantTerms };
}

export interface VariantLike {
  title: string;
  options: { name: string; value: string }[];
}

// Whether a variant matches the size/option words the customer used. Compared
// against option VALUES and the variant title, case-insensitively, as whole
// values — so "42" matches the size 42 but not 42.5 or 142.
export function variantMatchesTerms(variant: VariantLike, variantTerms: string[]): boolean {
  if (variantTerms.length === 0) return true;

  const values = [
    ...variant.options.map((option) => option.value),
    ...variant.title.split(/\s*\/\s*/),
  ].map((value) => value.trim().toLowerCase());

  return variantTerms.every((term) => values.includes(term.toLowerCase()));
}
