import "server-only";
import { isMyshopifyDomain } from "./domain";

// Thin Admin GraphQL client. GraphQL rather than the REST Admin API because
// Shopify has made GraphQL the API for new work — the REST Admin API is
// legacy for apps built from 2025 onwards.
//
// 2026-07 is the current stable version at the time of writing. Shopify
// releases quarterly and supports each version for a year, so this constant is
// the one thing to bump on a version upgrade.
export const SHOPIFY_API_VERSION = "2026-07";

const REQUEST_TIMEOUT_MS = 10_000;

export class ShopifyAdminApiError extends Error {
  constructor(
    message: string,
    readonly kind: "unauthorized" | "rate_limited" | "request_failed" | "graphql_error"
  ) {
    super(message);
  }
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message?: string; extensions?: { code?: string } }[];
}

export async function shopifyAdminGraphQL<T>(params: {
  shopDomain: string;
  accessToken: string;
  query: string;
  variables?: Record<string, unknown>;
}): Promise<T> {
  if (!isMyshopifyDomain(params.shopDomain)) {
    throw new ShopifyAdminApiError("Refusing to send an access token to a non-Shopify domain", "request_failed");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `https://${params.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": params.accessToken,
        },
        body: JSON.stringify({ query: params.query, variables: params.variables ?? {} }),
      }
    );
  } catch (err) {
    throw new ShopifyAdminApiError(
      `Shopify Admin API request failed: ${err instanceof Error ? err.message : "unknown error"}`,
      "request_failed"
    );
  } finally {
    clearTimeout(timeout);
  }

  // 401/403 is the signal that the merchant uninstalled the app or revoked the
  // token. Callers turn this into "needs reconnecting" rather than a generic
  // error, because the customer can actually fix that one themselves.
  if (response.status === 401 || response.status === 403) {
    throw new ShopifyAdminApiError("Shopify rejected the stored access token", "unauthorized");
  }
  if (response.status === 429) {
    throw new ShopifyAdminApiError("Shopify rate limit reached", "rate_limited");
  }
  if (!response.ok) {
    throw new ShopifyAdminApiError(`Shopify Admin API returned ${response.status}`, "request_failed");
  }

  const payload = (await response.json().catch(() => null)) as GraphQLResponse<T> | null;
  if (!payload) throw new ShopifyAdminApiError("Shopify Admin API returned an unreadable body", "request_failed");

  if (payload.errors?.length) {
    const unauthorized = payload.errors.some(
      (error) => error.extensions?.code === "ACCESS_DENIED" || /access denied/i.test(error.message ?? "")
    );
    throw new ShopifyAdminApiError(
      payload.errors.map((error) => error.message).filter(Boolean).join("; ") || "Shopify GraphQL error",
      unauthorized ? "unauthorized" : "graphql_error"
    );
  }

  if (!payload.data) throw new ShopifyAdminApiError("Shopify Admin API returned no data", "graphql_error");
  return payload.data;
}
