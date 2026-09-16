import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.SHOPIFY_API_KEY = "test-client-id";
  process.env.SHOPIFY_API_SECRET = "test-client-secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://aibooking-backendnew.vercel.app";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function oauth() {
  return import("@/lib/shopify/oauth");
}

function signed(params: Record<string, string>, secret = "test-client-secret"): URLSearchParams {
  const message = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const search = new URLSearchParams(params);
  search.set("hmac", createHmac("sha256", secret).update(message).digest("hex"));
  return search;
}

describe("buildShopifyAuthorizeUrl", () => {
  it("sends the merchant to their own shop with only the scopes we need", async () => {
    const { buildShopifyAuthorizeUrl, SHOPIFY_SCOPES } = await oauth();
    const url = new URL(buildShopifyAuthorizeUrl("myshop.myshopify.com", "state-123"));

    expect(url.origin).toBe("https://myshop.myshopify.com");
    expect(url.pathname).toBe("/admin/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://aibooking-backendnew.vercel.app/api/customer/shopify/callback"
    );
    // Products and orders, both read-only. Nothing here may write, and nothing
    // else may be requested — a merchant sees this list on the consent screen,
    // and every extra scope is one more thing to have to justify.
    expect(SHOPIFY_SCOPES).toBe("read_products,read_orders,read_legal_policies");
    expect(url.searchParams.get("scope")).toBe("read_products,read_orders,read_legal_policies");
    expect(SHOPIFY_SCOPES).not.toMatch(/write_/);
    // Empty grant_options[] = offline token, which is what a background order
    // lookup needs.
    expect(url.searchParams.get("grant_options[]")).toBe("");
  });

  it("refuses to build an authorize URL for a non-Shopify domain", async () => {
    const { buildShopifyAuthorizeUrl } = await oauth();
    expect(() => buildShopifyAuthorizeUrl("evil-myshopify.com", "s")).toThrow();
    expect(() => buildShopifyAuthorizeUrl("myshop.myshopify.com.attacker.net", "s")).toThrow();
  });

  it("never puts the client secret in the URL handed to the browser", async () => {
    const { buildShopifyAuthorizeUrl } = await oauth();
    expect(buildShopifyAuthorizeUrl("myshop.myshopify.com", "s")).not.toContain("test-client-secret");
  });
});

describe("verifyCallbackHmac", () => {
  it("accepts a callback Shopify actually signed", async () => {
    const { verifyCallbackHmac } = await oauth();
    expect(
      verifyCallbackHmac(
        signed({ code: "abc", shop: "myshop.myshopify.com", state: "s1", timestamp: "1700000000" })
      )
    ).toBe(true);
  });

  // Each of these is a forged callback. Accepting one would let an attacker
  // attach a shop of their choosing to a widget.
  it("rejects a tampered, unsigned or wrongly-signed callback", async () => {
    const { verifyCallbackHmac } = await oauth();

    const tampered = signed({ code: "abc", shop: "myshop.myshopify.com", state: "s1" });
    tampered.set("shop", "attacker.myshopify.com");
    expect(verifyCallbackHmac(tampered)).toBe(false);

    const unsigned = new URLSearchParams({ code: "abc", shop: "myshop.myshopify.com", state: "s1" });
    expect(verifyCallbackHmac(unsigned)).toBe(false);

    const wrongSecret = signed({ code: "abc", shop: "myshop.myshopify.com", state: "s1" }, "not-our-secret");
    expect(verifyCallbackHmac(wrongSecret)).toBe(false);

    const empty = signed({ code: "abc", shop: "myshop.myshopify.com" });
    empty.set("hmac", "");
    expect(verifyCallbackHmac(empty)).toBe(false);
  });

  it("ignores the signature parameter when computing the digest, as Shopify does", async () => {
    const { verifyCallbackHmac } = await oauth();
    const params = signed({ code: "abc", shop: "myshop.myshopify.com", state: "s1" });
    params.set("signature", "legacy-value");
    expect(verifyCallbackHmac(params)).toBe(true);
  });
});

describe("exchangeShopifyCode", () => {
  // The client secret is POSTed to this host. Sending it anywhere but a
  // verified myshopify.com domain would hand our app's credentials to whoever
  // owns the lookalike.
  it("refuses to POST credentials to a non-Shopify domain", async () => {
    const { exchangeShopifyCode } = await oauth();
    await expect(exchangeShopifyCode("evil-myshopify.com", "code")).rejects.toThrow();
    await expect(exchangeShopifyCode("myshop.myshopify.com.attacker.net", "code")).rejects.toThrow();
  });
});

describe("isShopifyOAuthConfigured", () => {
  it("is false when the platform has no Shopify app, so the UI can hide the button", async () => {
    delete process.env.SHOPIFY_API_KEY;
    const { isShopifyOAuthConfigured } = await oauth();
    expect(isShopifyOAuthConfigured()).toBe(false);
  });
});
