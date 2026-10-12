import { describe, it, expect, vi, beforeEach } from "vitest";

// Connecting a shop by pasting a custom-app Admin API token — the path for a
// platform that has no Shopify app of its own. The token is verified against
// Shopify before anything is stored, which is the whole point: a token that
// cannot be used is worse stored than rejected, because the failure would
// then surface mid-conversation instead of in the form.

const graphQLMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(null));
vi.mock("@/lib/shopify/admin-api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, shopifyAdminGraphQL: (...args: unknown[]) => graphQLMock(...args) };
});

import { fetchShopifyAccessScopes, ShopifyAdminApiError } from "@/lib/shopify/admin-api";

const CREDENTIALS = { shopDomain: "myshop.myshopify.com", accessToken: "shpat_token" };

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
});

function stub(handler: (url: string, init?: RequestInit) => Response) {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) =>
    handler(String(input), init as RequestInit)
  ) as never;
}

describe("fetchShopifyAccessScopes", () => {
  it("returns the scopes the token actually carries", async () => {
    stub(() =>
      new Response(
        JSON.stringify({
          access_scopes: [{ handle: "read_products" }, { handle: "read_orders" }, { handle: "read_legal_policies" }],
        }),
        { headers: { "content-type": "application/json" } }
      )
    );

    expect(await fetchShopifyAccessScopes(CREDENTIALS)).toEqual([
      "read_products",
      "read_orders",
      "read_legal_policies",
    ]);
  });

  it("sends the token to the shop's own host, in the header Shopify expects", async () => {
    stub(() => new Response(JSON.stringify({ access_scopes: [] }), { headers: { "content-type": "application/json" } }));

    await fetchShopifyAccessScopes(CREDENTIALS);

    const [url, init] = (fetchSpy.mock.calls[0] ?? []) as [string, RequestInit];
    expect(String(url)).toBe("https://myshop.myshopify.com/admin/oauth/access_scopes.json");
    expect((init.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe("shpat_token");
  });

  // The same anchored-domain rule the rest of the integration follows: a
  // lookalike host must never be handed a merchant's token.
  it("refuses a non-Shopify domain without making a request", async () => {
    stub(() => new Response("{}", { headers: { "content-type": "application/json" } }));

    await expect(
      fetchShopifyAccessScopes({ shopDomain: "evil-myshopify.com", accessToken: "shpat_token" })
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a rejected token as unauthorized, so the form can say what is wrong", async () => {
    stub(() => new Response("unauthorized", { status: 401 }));

    await expect(fetchShopifyAccessScopes(CREDENTIALS)).rejects.toMatchObject({ kind: "unauthorized" });
  });

  it("survives a response without the expected shape", async () => {
    stub(() => new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } }));
    expect(await fetchShopifyAccessScopes(CREDENTIALS)).toEqual([]);
  });

  it("is a real ShopifyAdminApiError, so callers can branch on the kind", async () => {
    stub(() => new Response("nope", { status: 403 }));
    await expect(fetchShopifyAccessScopes(CREDENTIALS)).rejects.toBeInstanceOf(ShopifyAdminApiError);
  });
});
