import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

interface StripeEventRow {
  id: string;
  type: string;
  payload: unknown;
}

let stripeEvents: StripeEventRow[];

const constructEventMock = vi.fn();
const subscriptionsRetrieveMock = vi.fn(async () => ({ id: "sub_123" }));

vi.mock("@/lib/billing/stripe-client", () => ({
  getStripeClient: () => ({
    webhooks: { constructEvent: constructEventMock },
    subscriptions: { retrieve: (...args: unknown[]) => subscriptionsRetrieveMock(...(args as [])) },
  }),
}));

const syncSubscriptionFromStripeMock = vi.fn(async (..._args: unknown[]) => {});

vi.mock("@/lib/billing/subscription-sync", () => ({
  syncSubscriptionFromStripe: (...args: unknown[]) => syncSubscriptionFromStripeMock(...args),
  grantCreditsForPaidInvoice: vi.fn(async () => {}),
  markSubscriptionCanceled: vi.fn(async () => {}),
}));

vi.mock("@/lib/billing/widget-launch", async () => {
  const offer = await vi.importActual<typeof import("@/lib/billing/widget-launch-offer")>(
    "@/lib/billing/widget-launch-offer"
  );
  return { ...offer, grantWidgetLaunchCredits: vi.fn(async () => ({ granted: true })) };
});

vi.mock("@/lib/security/audit", () => ({
  writeAuditLog: vi.fn(async () => {}),
}));

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
import { buildPackageLaunchReference } from "@/lib/billing/package-launch-offer";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const PACKAGE_ID = "22222222-2222-4222-8222-222222222222";

function makeRequest(eventId: string): Request {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "test-signature" },
    body: JSON.stringify({ id: eventId }),
  });
}

function checkoutCompleted(eventId: string, session: Record<string, unknown>) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_1", payment_status: "paid", ...session } },
  };
}

describe("package launch offer via the Stripe webhook", () => {
  beforeEach(() => {
    stripeEvents = [];
    syncSubscriptionFromStripeMock.mockClear();
    constructEventMock.mockReset();
  });

  it("syncs the subscription using the reference carried on the checkout session, not Stripe metadata", async () => {
    constructEventMock.mockReturnValue(
      checkoutCompleted("evt_pkg_1", {
        subscription: "sub_123",
        client_reference_id: buildPackageLaunchReference({ customerId: CUSTOMER_ID, packageId: PACKAGE_ID }),
      })
    );

    const res = await POST(makeRequest("evt_pkg_1"));

    expect(res.status).toBe(200);
    expect(syncSubscriptionFromStripeMock).toHaveBeenCalledTimes(1);
    expect(syncSubscriptionFromStripeMock).toHaveBeenCalledWith(
      { id: "sub_123" },
      { customerId: CUSTOMER_ID, packageId: PACKAGE_ID }
    );
  });

  it("falls back to metadata-based sync when the session carries no package-launch reference", async () => {
    constructEventMock.mockReturnValue(
      checkoutCompleted("evt_pkg_2", { subscription: "sub_123", client_reference_id: null })
    );

    await POST(makeRequest("evt_pkg_2"));

    expect(syncSubscriptionFromStripeMock).toHaveBeenCalledWith({ id: "sub_123" }, undefined);
  });

  it("does not treat a widget launch reference as a package reference", async () => {
    constructEventMock.mockReturnValue(
      checkoutCompleted("evt_pkg_3", {
        subscription: "sub_123",
        // Only a customer id, no separator — a valid widget reference, not a package one.
        client_reference_id: CUSTOMER_ID,
      })
    );

    await POST(makeRequest("evt_pkg_3"));

    expect(syncSubscriptionFromStripeMock).toHaveBeenCalledWith({ id: "sub_123" }, undefined);
  });
});
