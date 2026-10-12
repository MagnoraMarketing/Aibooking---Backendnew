import { describe, it, expect, vi, beforeEach } from "vitest";

// The Admin API is the only thing stubbed here — the normalisation, the exact
// -name check and the field mapping under test are all real.
const graphQLMock = vi.fn();
vi.mock("@/lib/shopify/admin-api", () => ({
  shopifyAdminGraphQL: (...args: unknown[]) => graphQLMock(...args),
  SHOPIFY_API_VERSION: "2026-07",
  ShopifyAdminApiError: class extends Error {},
}));

import { lookupShopifyOrder } from "@/lib/shopify/orders";

const CREDENTIALS = { shopDomain: "myshop.myshopify.com", accessToken: "shpat_token" };

function ordersResponse(nodes: unknown[]) {
  return { orders: { nodes } };
}

const SHIPPED_ORDER = {
  name: "#10482",
  createdAt: "2026-09-01T10:00:00Z",
  cancelledAt: null,
  displayFulfillmentStatus: "FULFILLED",
  displayFinancialStatus: "PAID",
  fulfillments: [
    {
      createdAt: "2026-09-02T08:00:00Z",
      displayStatus: "IN_TRANSIT",
      status: "SUCCESS",
      estimatedDeliveryAt: "2026-09-05T12:00:00Z",
      deliveredAt: null,
      inTransitAt: "2026-09-02T09:00:00Z",
      trackingInfo: [{ company: "DHL", number: "123456789", url: "https://track.dhl.com/123456789" }],
    },
  ],
};

beforeEach(() => graphQLMock.mockReset());

describe("lookupShopifyOrder", () => {
  it("returns the tracking details the agent needs", async () => {
    graphQLMock.mockResolvedValueOnce(ordersResponse([SHIPPED_ORDER]));

    const result = await lookupShopifyOrder({ ...CREDENTIALS, orderNumber: "10482" });

    expect(result).toMatchObject({
      found: true,
      order_number: "10482",
      status: "fulfilled",
      fulfillment_status: "in transit",
      tracking_number: "123456789",
      tracking_url: "https://track.dhl.com/123456789",
      carrier: "DHL",
      estimated_delivery: "2026-09-05T12:00:00Z",
    });
  });

  // The spec's requirement, and the one a caller hits by reading their receipt
  // aloud: both forms have to reach the same order.
  it("finds the same order from '10482' and '#10482'", async () => {
    graphQLMock.mockResolvedValue(ordersResponse([SHIPPED_ORDER]));

    const bare = await lookupShopifyOrder({ ...CREDENTIALS, orderNumber: "10482" });
    const hashed = await lookupShopifyOrder({ ...CREDENTIALS, orderNumber: "#10482" });

    expect(bare.found).toBe(true);
    expect(hashed.found).toBe(true);
    expect(hashed.order_number).toBe(bare.order_number);
  });

  it("handles an order that is fulfilled but has no tracking number", async () => {
    graphQLMock.mockResolvedValueOnce(
      ordersResponse([
        {
          ...SHIPPED_ORDER,
          fulfillments: [
            {
              createdAt: "2026-09-02T08:00:00Z",
              displayStatus: "FULFILLED",
              status: "SUCCESS",
              trackingInfo: [],
            },
          ],
        },
      ])
    );

    const result = await lookupShopifyOrder({ ...CREDENTIALS, orderNumber: "10482" });

    expect(result.found).toBe(true);
    expect(result.fulfillment_status).toBe("fulfilled");
    expect(result.tracking_number).toBeUndefined();
    expect(result.tracking_url).toBeUndefined();
  });

  it("reports an unfulfilled order without inventing a shipment", async () => {
    graphQLMock.mockResolvedValueOnce(
      ordersResponse([
        { name: "#10482", displayFulfillmentStatus: "UNFULFILLED", cancelledAt: null, fulfillments: [] },
      ])
    );

    const result = await lookupShopifyOrder({ ...CREDENTIALS, orderNumber: "10482" });

    expect(result).toMatchObject({ found: true, status: "unfulfilled" });
    expect(result.tracking_number).toBeUndefined();
  });

  it("says not found rather than guessing", async () => {
    graphQLMock.mockResolvedValue(ordersResponse([]));

    const result = await lookupShopifyOrder({ ...CREDENTIALS, orderNumber: "99999" });

    expect(result).toEqual({ found: false });
  });

  // Shopify's search matches rather than equals. If a near-miss were accepted,
  // the agent would read a stranger's order status out to the caller.
  it("refuses an order whose number only partially matches", async () => {
    graphQLMock.mockResolvedValue(ordersResponse([{ name: "#104820", displayFulfillmentStatus: "FULFILLED" }]));

    const result = await lookupShopifyOrder({ ...CREDENTIALS, orderNumber: "10482" });

    expect(result).toEqual({ found: false });
  });

  it("picks the exact order out of a multi-result search", async () => {
    graphQLMock.mockResolvedValueOnce(
      ordersResponse([
        { name: "#104821", displayFulfillmentStatus: "UNFULFILLED" },
        SHIPPED_ORDER,
        { name: "#110482", displayFulfillmentStatus: "UNFULFILLED" },
      ])
    );

    const result = await lookupShopifyOrder({ ...CREDENTIALS, orderNumber: "10482" });

    expect(result.order_number).toBe("10482");
    expect(result.tracking_number).toBe("123456789");
  });

  // An empty search term is `query: ""`, which Shopify answers with the shop's
  // most recent orders — i.e. somebody else's. It must never be sent.
  it("never queries Shopify for an empty order number", async () => {
    const result = await lookupShopifyOrder({ ...CREDENTIALS, orderNumber: "  #  " });

    expect(result).toEqual({ found: false });
    expect(graphQLMock).not.toHaveBeenCalled();
  });

  it("reports a cancelled order as cancelled", async () => {
    graphQLMock.mockResolvedValueOnce(
      ordersResponse([
        {
          name: "#10482",
          cancelledAt: "2026-09-03T09:00:00Z",
          displayFulfillmentStatus: "UNFULFILLED",
          fulfillments: [],
        },
      ])
    );

    const result = await lookupShopifyOrder({ ...CREDENTIALS, orderNumber: "10482" });

    expect(result).toMatchObject({ found: true, status: "cancelled", cancelled: true });
  });

  // Nothing beyond status and tracking may come back: the caller is whoever is
  // on the line, and they've proved nothing except knowing an order number.
  it("returns no customer, address or payment data", async () => {
    graphQLMock.mockResolvedValueOnce(ordersResponse([SHIPPED_ORDER]));

    const result = await lookupShopifyOrder({ ...CREDENTIALS, orderNumber: "10482" });

    const allowed = new Set([
      "found", "order_number", "status", "fulfillment_status", "tracking_number",
      "tracking_url", "carrier", "fulfilled_at", "estimated_delivery", "delivered_at", "cancelled",
    ]);
    for (const key of Object.keys(result)) {
      expect(allowed.has(key), `unexpected field returned to the agent: ${key}`).toBe(true);
    }
  });

  it("asks Shopify for the order by name, not by a free-text search", async () => {
    graphQLMock.mockResolvedValueOnce(ordersResponse([SHIPPED_ORDER]));

    await lookupShopifyOrder({ ...CREDENTIALS, orderNumber: "10482" });

    const call = graphQLMock.mock.calls[0]![0] as { variables: { query: string } };
    expect(call.variables.query).toBe('name:"#10482"');
  });
});
