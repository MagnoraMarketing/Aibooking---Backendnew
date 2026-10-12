import "server-only";
import { shopifyAdminGraphQL } from "./admin-api";
import { normalizeOrderNumber, orderNameMatches } from "./domain";

// Order status + tracking, read live from the Admin API. Nothing from here is
// ever stored: an order is somebody's personal data, and the only reason we
// hold it at all is to say one sentence back to the caller who asked about
// their own order.

// What the agent is given. Deliberately narrow — no customer name, no email,
// no address, no line items, no prices, no payment details. The question
// being answered is "where is my parcel?", and everything beyond that is
// personal data the agent has no business reciting out loud to whoever is on
// the line.
export interface ShopifyOrderStatus {
  found: boolean;
  order_number?: string;
  status?: string;
  fulfillment_status?: string;
  tracking_number?: string;
  /** Kept as its own field so an SMS/e-mail step can send just the link later. */
  tracking_url?: string;
  carrier?: string;
  fulfilled_at?: string;
  estimated_delivery?: string;
  delivered_at?: string;
  cancelled?: boolean;
}

interface RawFulfillment {
  createdAt?: string | null;
  displayStatus?: string | null;
  status?: string | null;
  estimatedDeliveryAt?: string | null;
  deliveredAt?: string | null;
  inTransitAt?: string | null;
  trackingInfo?: { company?: string | null; number?: string | null; url?: string | null }[] | null;
}

interface RawOrder {
  name?: string | null;
  createdAt?: string | null;
  cancelledAt?: string | null;
  displayFulfillmentStatus?: string | null;
  displayFinancialStatus?: string | null;
  fulfillments?: RawFulfillment[] | null;
}

const ORDER_LOOKUP_QUERY = `
  query AIbookingOrderLookup($query: String!) {
    orders(first: 5, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        name
        createdAt
        cancelledAt
        displayFulfillmentStatus
        displayFinancialStatus
        fulfillments(first: 10) {
          createdAt
          displayStatus
          status
          estimatedDeliveryAt
          deliveredAt
          inTransitAt
          trackingInfo(first: 5) {
            company
            number
            url
          }
        }
      }
    }
  }
`;

// Shopify's enums are SCREAMING_SNAKE; the agent speaks to a person.
function humanize(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value.toLowerCase().replace(/_/g, " ");
}

function toStatus(order: RawOrder): ShopifyOrderStatus {
  // The newest fulfilment that actually carries a tracking number is the one
  // worth reading out; a split shipment can have an older one without.
  const fulfillments = (order.fulfillments ?? []).filter(Boolean);
  const withTracking = fulfillments.find((fulfillment) =>
    (fulfillment.trackingInfo ?? []).some((info) => info?.number || info?.url)
  );
  const fulfillment = withTracking ?? fulfillments[0];
  const tracking = (fulfillment?.trackingInfo ?? []).find((info) => info?.number || info?.url);

  const status: ShopifyOrderStatus = {
    found: true,
    order_number: normalizeOrderNumber(order.name) ?? order.name ?? undefined,
    status: order.cancelledAt ? "cancelled" : humanize(order.displayFulfillmentStatus),
    fulfillment_status: humanize(fulfillment?.displayStatus ?? order.displayFulfillmentStatus),
  };

  if (order.cancelledAt) status.cancelled = true;
  if (tracking?.number) status.tracking_number = tracking.number;
  if (tracking?.url) status.tracking_url = tracking.url;
  if (tracking?.company) status.carrier = tracking.company;
  if (fulfillment?.createdAt) status.fulfilled_at = fulfillment.createdAt;
  if (fulfillment?.estimatedDeliveryAt) status.estimated_delivery = fulfillment.estimatedDeliveryAt;
  if (fulfillment?.deliveredAt) status.delivered_at = fulfillment.deliveredAt;

  return status;
}

async function runLookup(
  shopDomain: string,
  accessToken: string,
  searchQuery: string
): Promise<RawOrder[]> {
  const data = await shopifyAdminGraphQL<{ orders?: { nodes?: RawOrder[] } }>({
    shopDomain,
    accessToken,
    query: ORDER_LOOKUP_QUERY,
    variables: { query: searchQuery },
  });
  return data.orders?.nodes ?? [];
}

// Looks an order up by the number the caller gave. Returns `{ found: false }`
// rather than throwing when there is no match, so the agent can ask them to
// check the number instead of apologising for a system error.
export async function lookupShopifyOrder(params: {
  shopDomain: string;
  accessToken: string;
  orderNumber: string;
}): Promise<ShopifyOrderStatus> {
  const normalized = normalizeOrderNumber(params.orderNumber);
  // An empty search term would match every order in the shop. Never run it.
  if (!normalized) return { found: false };

  // Shopify order names carry the shop's prefix ("#10482"), so both forms are
  // tried — the customer read one of them off a receipt, and we don't know
  // which.
  const candidates = [`name:"#${normalized}"`, `name:"${normalized}"`];

  for (const searchQuery of candidates) {
    const orders = await runLookup(params.shopDomain, params.accessToken, searchQuery);

    // Shopify's search is a match, not an equality test: "1048" can come back
    // with "#10482". Confirming the name is what stops this from reading
    // somebody else's order out loud to the caller.
    const exact = orders.find((order) => order.name && orderNameMatches(order.name, normalized));
    if (exact) return toStatus(exact);
  }

  return { found: false };
}
