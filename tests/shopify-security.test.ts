import { describe, it, expect, vi, beforeEach } from "vitest";

// What must hold no matter how the Shopify feature grows:
//   1. the access token never leaves the server or reaches a response;
//   2. a webshop is only ever reachable through the widget that owns it;
//   3. a token is only ever sent to a verified myshopify.com host.

interface Query {
  table: string;
  columns?: string;
  filters: Record<string, unknown>;
}

const queries: Query[] = [];
// Per-table canned rows, so a query against the wrong table returns nothing
// rather than quietly succeeding.
let rows: Record<string, Record<string, unknown> | null> = {};

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      const query: Query = { table, filters: {} };
      const chain = {
        select: (columns?: string) => {
          query.columns = columns;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          query.filters[column] = value;
          return chain;
        },
        update: () => chain,
        maybeSingle: async () => {
          queries.push(query);
          return { data: rows[table] ?? null, error: null };
        },
      };
      return chain;
    },
  }),
}));

vi.mock("@/lib/security/crypto", () => ({
  encryptSecret: (v: string) => `cipher:${v}`,
  decryptSecret: (v: string) => v.replace(/^cipher:/, ""),
}));

const CONNECTED_ROW = {
  id: "conn-1",
  customer_id: "cust-a",
  widget_id: "widget-a",
  shop_url: "https://shop-a.dk",
  currency: "DKK",
  crawl_status: "ok",
  crawl_error: null,
  crawled_product_count: 12,
  crawled_page_count: 4,
  last_sync_at: "2026-09-15T18:30:00Z",
  shop_domain: "shop-a.myshopify.com",
  access_token: "cipher:shpat_supersecret",
  scopes: "read_orders",
  status: "connected",
  status_error: null,
  connected_at: "2026-09-15T18:00:00Z",
};

import { getConnectionSummary, loadAdminCredentials, loadCatalog, toSummary } from "@/lib/shopify/connection";
import { shopifyAdminGraphQL } from "@/lib/shopify/admin-api";

beforeEach(() => {
  queries.length = 0;
  rows = { shopify_connections: { ...CONNECTED_ROW } };
});

describe("the access token never reaches the dashboard", () => {
  it("is not even selected by the summary query", async () => {
    await getConnectionSummary("widget-a");
    const [query] = queries;
    expect(query?.columns).toBeDefined();
    expect(query!.columns).not.toContain("access_token");
  });

  it("is absent from the summary object itself", async () => {
    const summary = await getConnectionSummary("widget-a");
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("shpat_");
    expect(serialized).not.toContain("access_token");
    expect(Object.keys(summary!)).not.toContain("accessToken");
  });

  it("returns only status, shop identity and counts", async () => {
    expect(await getConnectionSummary("widget-a")).toEqual({
      shopUrl: "https://shop-a.dk",
      shopDomain: "shop-a.myshopify.com",
      status: "connected",
      statusError: null,
      crawlStatus: "ok",
      crawlError: null,
      productCount: 12,
      pageCount: 4,
      lastSyncAt: "2026-09-15T18:30:00Z",
      connectedAt: "2026-09-15T18:00:00Z",
    });
  });

  it("stays clean even if a row somehow carries a token through toSummary", () => {
    // Belt and braces: toSummary maps explicit fields, so a row that arrived
    // with a token (a future caller selecting "*") still can't leak one.
    const summary = toSummary(CONNECTED_ROW as never);
    expect(JSON.stringify(summary)).not.toContain("shpat_");
  });
});

describe("one customer cannot reach another's webshop", () => {
  it("scopes every read to the widget it was asked about", async () => {
    await getConnectionSummary("widget-a");
    await loadAdminCredentials("widget-a");
    await loadCatalog("widget-a");

    expect(queries.length).toBe(3);
    for (const query of queries) {
      expect(query.table).toBe("shopify_connections");
      expect(query.filters.widget_id).toBe("widget-a");
    }
  });

  it("looks a connection up by widget, never by a shop domain from the caller", async () => {
    await loadAdminCredentials("widget-a");
    expect(Object.keys(queries[0]!.filters)).toEqual(["widget_id"]);
  });
});

describe("loadAdminCredentials", () => {
  it("decrypts the token only for the caller that needs it", async () => {
    expect(await loadAdminCredentials("widget-a")).toEqual({
      connectionId: "conn-1",
      shopDomain: "shop-a.myshopify.com",
      accessToken: "shpat_supersecret",
    });
  });

  it("refuses a connection that is not fully installed", async () => {
    rows = { shopify_connections: { ...CONNECTED_ROW, status: "reauth_required" } };
    expect(await loadAdminCredentials("widget-a")).toBeNull();

    rows = { shopify_connections: { ...CONNECTED_ROW, access_token: null } };
    expect(await loadAdminCredentials("widget-a")).toBeNull();

    rows = { shopify_connections: null };
    expect(await loadAdminCredentials("widget-a")).toBeNull();
  });
});

describe("shopifyAdminGraphQL", () => {
  it("refuses to send a token to a host that isn't a verified Shopify domain", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      shopifyAdminGraphQL({
        shopDomain: "evil-myshopify.com",
        accessToken: "shpat_supersecret",
        query: "{ shop { name } }",
      })
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
