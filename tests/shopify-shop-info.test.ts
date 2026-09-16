import { describe, it, expect, vi, beforeEach } from "vitest";

// Delivery, shipping cost and returns. These used to be crawled off the
// storefront and parked in the agent's prompt; they are a live policy read
// now, so the agent quotes what the merchant has in Shopify today.
const graphQLMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(null));
vi.mock("@/lib/shopify/admin-api", () => ({
  shopifyAdminGraphQL: (...args: unknown[]) => graphQLMock(...args),
  SHOPIFY_API_VERSION: "2026-07",
  ShopifyAdminApiError: class extends Error {},
}));

import { fetchShopifyShopInfo } from "@/lib/shopify/shop-info";

const CREDENTIALS = { shopDomain: "myshop.myshopify.com", accessToken: "shpat_token" };

const SHOP = {
  shop: {
    name: "Shoppen",
    contactEmail: "hej@shop.dk",
    currencyCode: "DKK",
    shippingPolicy: {
      title: "Leveringspolitik",
      body: "<p>Vi sender med <b>DHL</b> på 1-3 hverdage. Fragt koster 39 kr.</p>",
      url: "https://shop.dk/policies/shipping-policy",
    },
    refundPolicy: {
      title: "Returpolitik",
      body: "<p>Du har 30 dages returret.</p>",
      url: "https://shop.dk/policies/refund-policy",
    },
    termsOfService: null,
    privacyPolicy: { title: "Privatliv", body: "   ", url: "https://shop.dk/policies/privacy-policy" },
  },
};

beforeEach(() => graphQLMock.mockReset());

describe("fetchShopifyShopInfo", () => {
  it("returns the policy text as prose the agent can say out loud", async () => {
    graphQLMock.mockResolvedValueOnce(SHOP);

    const info = await fetchShopifyShopInfo(CREDENTIALS);

    expect(info).toMatchObject({ shop_name: "Shoppen", currency: "DKK", contact_email: "hej@shop.dk" });
    const shipping = info.policies.find((policy) => policy.kind === "shipping");
    // HTML out: the body is spoken on a call and written in a chat.
    expect(shipping?.body).toBe("Vi sender med DHL på 1-3 hverdage. Fragt koster 39 kr.");
    expect(shipping?.url).toBe("https://shop.dk/policies/shipping-policy");
  });

  it("narrows to the policy that was asked about", async () => {
    graphQLMock.mockResolvedValueOnce(SHOP);

    const info = await fetchShopifyShopInfo({ ...CREDENTIALS, which: ["shipping"] });

    expect(info.policies.map((policy) => policy.kind)).toEqual(["shipping"]);
  });

  // A policy the merchant never filled in is not an answer. Returning an empty
  // one would invite the agent to say something about nothing.
  it("drops policies that are empty or missing", async () => {
    graphQLMock.mockResolvedValueOnce(SHOP);

    const kinds = (await fetchShopifyShopInfo(CREDENTIALS)).policies.map((policy) => policy.kind);

    expect(kinds).toContain("shipping");
    expect(kinds).toContain("refund");
    expect(kinds).not.toContain("terms");
    expect(kinds).not.toContain("privacy");
  });

  it("survives a shop with no policies at all", async () => {
    graphQLMock.mockResolvedValueOnce({ shop: {} });

    const info = await fetchShopifyShopInfo(CREDENTIALS);

    expect(info.policies).toEqual([]);
    expect(info.shop_name).toBeNull();
  });
});
