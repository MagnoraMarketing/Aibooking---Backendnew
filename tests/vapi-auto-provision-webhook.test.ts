import { describe, it, expect, vi, beforeEach } from "vitest";

// A phone agent set up during the trial has no number yet (that's gated on
// payment — see app/api/customer/phone-numbers/vapi/route.ts). This pins
// where it actually gets one: the Stripe webhook, the moment a subscription
// syncs as "active" — see provisionInboundNumbersIfNewlyActive in
// app/api/webhooks/stripe/route.ts.

process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

interface StripeEventRow {
  id: string;
  type: string;
  payload: unknown;
}

let stripeEvents: StripeEventRow[];

const constructEventMock = vi.fn();
const syncSubscriptionFromStripeMock = vi.fn();
const provisionVapiNumbersForNewlyPaidCustomerMock = vi.fn(async (_customerId: string) => {});

vi.mock("@/lib/billing/stripe-client", () => ({
  getStripeClient: () => ({
    webhooks: { constructEvent: constructEventMock },
    subscriptions: { retrieve: vi.fn(async () => ({ id: "sub_123" })) },
  }),
}));

vi.mock("@/lib/billing/subscription-sync", () => ({
  grantCreditsForPaidInvoice: vi.fn(async () => {}),
  syncSubscriptionFromStripe: (...args: unknown[]) => syncSubscriptionFromStripeMock(...args),
  markSubscriptionCanceled: vi.fn(async () => {}),
}));

vi.mock("@/lib/phone-numbers", () => ({
  provisionVapiNumbersForNewlyPaidCustomer: (customerId: string) =>
    provisionVapiNumbersForNewlyPaidCustomerMock(customerId),
}));

vi.mock("@/lib/billing/widget-launch", () => ({
  grantWidgetLaunchCredits: vi.fn(async () => {}),
  parseWidgetLaunchReference: () => null,
}));

vi.mock("@/lib/billing/package-launch-offer", () => ({
  parsePackageLaunchReference: () => null,
}));

vi.mock("@/lib/security/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table !== "stripe_events") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: async () => ({ data: stripeEvents.find((e) => e.id === val) ?? null, error: null }),
          }),
        }),
        insert: async (row: StripeEventRow) => {
          stripeEvents.push(row);
          return { error: null };
        },
      };
    },
  }),
}));

import { POST } from "@/app/api/webhooks/stripe/route";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

function makeRequest(eventId: string): Request {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "test-signature" },
    body: JSON.stringify({ id: eventId }),
  });
}

function subscriptionEvent(eventId: string, status: string) {
  return {
    id: eventId,
    type: "customer.subscription.updated",
    data: { object: { id: "sub_123", status } },
  };
}

describe("auto-assigning a free Vapi number once a subscription is active", () => {
  beforeEach(() => {
    stripeEvents = [];
    constructEventMock.mockReset();
    provisionVapiNumbersForNewlyPaidCustomerMock.mockClear();
    syncSubscriptionFromStripeMock.mockReset();
  });

  it("provisions numbers once the synced subscription is active", async () => {
    syncSubscriptionFromStripeMock.mockResolvedValue({ customerId: CUSTOMER_ID, status: "active" });
    constructEventMock.mockReturnValue(subscriptionEvent("evt_active", "active"));

    const res = await POST(makeRequest("evt_active"));

    expect(res.status).toBe(200);
    expect(provisionVapiNumbersForNewlyPaidCustomerMock).toHaveBeenCalledWith(CUSTOMER_ID);
  });

  it("does not provision anything for a past_due sync", async () => {
    syncSubscriptionFromStripeMock.mockResolvedValue({ customerId: CUSTOMER_ID, status: "past_due" });
    constructEventMock.mockReturnValue(subscriptionEvent("evt_past_due", "past_due"));

    await POST(makeRequest("evt_past_due"));

    expect(provisionVapiNumbersForNewlyPaidCustomerMock).not.toHaveBeenCalled();
  });

  it("does not provision anything for a subscription that isn't ours", async () => {
    syncSubscriptionFromStripeMock.mockResolvedValue(null);
    constructEventMock.mockReturnValue(subscriptionEvent("evt_foreign", "active"));

    await POST(makeRequest("evt_foreign"));

    expect(provisionVapiNumbersForNewlyPaidCustomerMock).not.toHaveBeenCalled();
  });
});
