import "server-only";
import { stripHtml } from "@/lib/knowledge-base/url";
import { shopifyAdminGraphQL } from "./admin-api";

// The shop's own policies — delivery, shipping cost, returns, terms — read
// live from the Admin API when a customer asks.
//
// These used to be crawled off the storefront and parked in the agent's
// prompt. They are fetched here instead, for the same reason products are: the
// merchant edits them in Shopify, and the agent should quote what they say
// today, not what they said at some earlier sync. Nothing is stored.

const MAX_POLICY_CHARS = 2_500;

export type ShopifyPolicyKind = "shipping" | "refund" | "terms" | "privacy";

export interface ShopifyPolicy {
  kind: ShopifyPolicyKind;
  title: string;
  /** The policy text, HTML stripped — it is read out or written to a customer. */
  body: string;
  /** The policy's own public page, so the agent can link to the full text. */
  url: string | null;
}

export interface ShopifyShopInfo {
  shop_name: string | null;
  currency: string | null;
  contact_email: string | null;
  policies: ShopifyPolicy[];
}

const SHOP_INFO_QUERY = `
  query AIbookingShopInfo {
    shop {
      name
      contactEmail
      currencyCode
      shippingPolicy { title body url }
      refundPolicy { title body url }
      termsOfService { title body url }
      privacyPolicy { title body url }
    }
  }
`;

interface RawPolicy {
  title?: string | null;
  body?: string | null;
  url?: string | null;
}

interface RawShop {
  name?: string | null;
  contactEmail?: string | null;
  currencyCode?: string | null;
  shippingPolicy?: RawPolicy | null;
  refundPolicy?: RawPolicy | null;
  termsOfService?: RawPolicy | null;
  privacyPolicy?: RawPolicy | null;
}

const POLICY_FIELDS: { kind: ShopifyPolicyKind; field: keyof RawShop; fallbackTitle: string }[] = [
  { kind: "shipping", field: "shippingPolicy", fallbackTitle: "Levering" },
  { kind: "refund", field: "refundPolicy", fallbackTitle: "Retur og refusion" },
  { kind: "terms", field: "termsOfService", fallbackTitle: "Handelsbetingelser" },
  { kind: "privacy", field: "privacyPolicy", fallbackTitle: "Privatlivspolitik" },
];

function mapPolicy(raw: RawPolicy | null | undefined, kind: ShopifyPolicyKind, fallbackTitle: string): ShopifyPolicy | null {
  // ShopPolicy.body is HTML. The agent speaks or writes it to a customer, so
  // markup has to go — and an empty policy is one the merchant never filled
  // in, which is not an answer.
  const body = stripHtml(raw?.body ?? "").slice(0, MAX_POLICY_CHARS);
  if (!body) return null;

  return { kind, title: raw?.title?.trim() || fallbackTitle, body, url: raw?.url ?? null };
}

// `which` narrows the answer to the policy actually asked about, so a delivery
// question doesn't return the privacy policy as well. Omitted means all of
// them — which is what a vague "hvad er jeres betingelser?" deserves.
export async function fetchShopifyShopInfo(params: {
  shopDomain: string;
  accessToken: string;
  which?: ShopifyPolicyKind[];
}): Promise<ShopifyShopInfo> {
  const data = await shopifyAdminGraphQL<{ shop?: RawShop }>({
    shopDomain: params.shopDomain,
    accessToken: params.accessToken,
    query: SHOP_INFO_QUERY,
  });

  const shop = data.shop ?? {};
  const wanted = params.which?.length ? new Set(params.which) : null;

  const policies = POLICY_FIELDS.filter((entry) => !wanted || wanted.has(entry.kind))
    .map((entry) => mapPolicy(shop[entry.field] as RawPolicy | null, entry.kind, entry.fallbackTitle))
    .filter((policy): policy is ShopifyPolicy => policy !== null);

  return {
    shop_name: shop.name?.trim() || null,
    currency: shop.currencyCode ?? null,
    contact_email: shop.contactEmail?.trim() || null,
    policies,
  };
}
