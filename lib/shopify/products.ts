import "server-only";
import { shopifyAdminGraphQL } from "./admin-api";
import { parseProductQuery, variantMatchesTerms } from "./product-search";

// Live product lookups against the Shopify Admin GraphQL API.
//
// Nothing is cached and nothing is stored: the agent asks a question, we ask
// Shopify that question, and only the matching products come back. The shop's
// catalogue never enters the agent's prompt, so prices and stock are whatever
// they are right now rather than whatever they were at the last sync.

const MAX_PRODUCTS = 5;
const MAX_VARIANTS = 30;

export interface ShopifyProductVariantResult {
  title: string;
  sku: string | null;
  price: string | null;
  currency: string | null;
  available: boolean;
  /** Null when Shopify doesn't track inventory for this variant. */
  inventory: number | null;
  options: { name: string; value: string }[];
  /** True when this variant matches the size/colour the customer named. */
  matches_request: boolean;
}

export interface ShopifyProductResult {
  name: string;
  price: string | null;
  price_max: string | null;
  currency: string | null;
  /**
   * The product's real page on the merchant's storefront, straight from
   * Shopify. Null when the product isn't published to the online store —
   * there is genuinely no page to link to, and the agent must not invent one.
   */
  url: string | null;
  product_type: string | null;
  vendor: string | null;
  available: boolean;
  total_inventory: number | null;
  variants: ShopifyProductVariantResult[];
}

// `status:active` keeps drafts and archived products out: they are not for
// sale, and offering one is worse than saying it isn't stocked.
const PRODUCT_SEARCH_QUERY = `
  query AIbookingProductSearch($query: String, $first: Int!, $variants: Int!) {
    products(first: $first, query: $query, sortKey: RELEVANCE) {
      nodes {
        title
        handle
        onlineStoreUrl
        productType
        vendor
        status
        totalInventory
        priceRangeV2 {
          minVariantPrice { amount currencyCode }
          maxVariantPrice { amount currencyCode }
        }
        variants(first: $variants) {
          nodes {
            title
            sku
            price
            availableForSale
            inventoryQuantity
            selectedOptions { name value }
          }
        }
      }
    }
  }
`;

interface RawVariant {
  title?: string | null;
  sku?: string | null;
  price?: string | null;
  availableForSale?: boolean | null;
  inventoryQuantity?: number | null;
  selectedOptions?: { name?: string | null; value?: string | null }[] | null;
}

interface RawProduct {
  title?: string | null;
  handle?: string | null;
  onlineStoreUrl?: string | null;
  productType?: string | null;
  vendor?: string | null;
  status?: string | null;
  totalInventory?: number | null;
  priceRangeV2?: {
    minVariantPrice?: { amount?: string | null; currencyCode?: string | null } | null;
    maxVariantPrice?: { amount?: string | null; currencyCode?: string | null } | null;
  } | null;
  variants?: { nodes?: RawVariant[] | null } | null;
}

// Shopify returns money as a decimal string ("899.00"). Spoken or written back
// as "899" it reads the way a person would say it, but a genuine 899.50 keeps
// its decimals.
function formatAmount(amount: string | null | undefined): string | null {
  if (!amount) return null;
  const value = Number(amount);
  if (!Number.isFinite(value)) return amount;
  return Number.isInteger(value) ? String(value) : String(value);
}

function mapVariant(raw: RawVariant, currency: string | null, variantTerms: string[]): ShopifyProductVariantResult {
  const options = (raw.selectedOptions ?? [])
    .map((option) => ({ name: option?.name?.trim() ?? "", value: option?.value?.trim() ?? "" }))
    .filter((option) => option.name.length > 0 && option.value.length > 0)
    // Shopify names the placeholder option on a product with no real variants
    // "Title" with the value "Default Title" — noise, not an option.
    .filter((option) => option.value !== "Default Title");

  const title = raw.title?.trim() || "Standard";

  return {
    title,
    sku: raw.sku?.trim() || null,
    price: formatAmount(raw.price),
    currency,
    available: raw.availableForSale === true,
    inventory: typeof raw.inventoryQuantity === "number" ? raw.inventoryQuantity : null,
    options,
    matches_request: variantMatchesTerms({ title, options }, variantTerms),
  };
}

function mapProduct(raw: RawProduct, variantTerms: string[]): ShopifyProductResult | null {
  const name = raw.title?.trim();
  if (!name) return null;

  const currency =
    raw.priceRangeV2?.minVariantPrice?.currencyCode ?? raw.priceRangeV2?.maxVariantPrice?.currencyCode ?? null;

  const variants = (raw.variants?.nodes ?? []).map((variant) => mapVariant(variant, currency, variantTerms));

  const min = formatAmount(raw.priceRangeV2?.minVariantPrice?.amount);
  const max = formatAmount(raw.priceRangeV2?.maxVariantPrice?.amount);

  return {
    name,
    price: min,
    price_max: max && max !== min ? max : null,
    currency,
    // Never derived from the handle: a product that isn't published has no
    // storefront page, and a guessed URL would 404 in front of the customer.
    url: raw.onlineStoreUrl ?? null,
    product_type: raw.productType?.trim() || null,
    vendor: raw.vendor?.trim() || null,
    available: variants.some((variant) => variant.available),
    total_inventory: typeof raw.totalInventory === "number" ? raw.totalInventory : null,
    variants,
  };
}

// Ranks a product that actually has the requested size in stock above one that
// merely matched the words. "Har I Nike i 42?" is a question about stock, and
// the useful answer is the product that can be bought.
function score(product: ShopifyProductResult, variantTerms: string[]): number {
  if (variantTerms.length === 0) return product.available ? 1 : 0;
  const matching = product.variants.filter((variant) => variant.matches_request);
  if (matching.some((variant) => variant.available)) return 3;
  if (matching.length > 0) return 2;
  return 0;
}

export interface ShopifyProductSearchResponse {
  products: ShopifyProductResult[];
  /** The size/colour words the customer used, echoed so the agent can be specific. */
  requested_options: string[];
}

export async function searchShopifyProducts(params: {
  shopDomain: string;
  accessToken: string;
  query: string;
}): Promise<ShopifyProductSearchResponse> {
  const parsed = parseProductQuery(params.query);

  const data = await shopifyAdminGraphQL<{ products?: { nodes?: RawProduct[] } }>({
    shopDomain: params.shopDomain,
    accessToken: params.accessToken,
    query: PRODUCT_SEARCH_QUERY,
    variables: {
      // A null query is a plain "first N products" browse.
      query: parsed.shopifyQuery ? `${parsed.shopifyQuery} AND status:active` : "status:active",
      first: MAX_PRODUCTS,
      variants: MAX_VARIANTS,
    },
  });

  const products = (data.products?.nodes ?? [])
    .map((raw) => mapProduct(raw, parsed.variantTerms))
    .filter((product): product is ShopifyProductResult => product !== null);

  // When the customer named a size, a product with no variant in that size is
  // not an answer to their question — drop it rather than offering it.
  const filtered =
    parsed.variantTerms.length > 0
      ? products.filter((product) => product.variants.some((variant) => variant.matches_request))
      : products;

  filtered.sort((a, b) => score(b, parsed.variantTerms) - score(a, parsed.variantTerms));

  return { products: filtered, requested_options: parsed.variantTerms };
}
