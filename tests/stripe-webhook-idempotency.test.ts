import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

interface StripeEventRow {
  id: string;
  type: string;
  payload: unknown;
}

let stripeEvents: StripeEventRow[];

const constructEventMock = vi.fn();

vi.mock("@/lib/billing/stripe-client", () => ({
  getStripeClient: () => ({
    webhooks: { constructEvent: constructEventMock },
    subscriptions: { retrieve: vi.fn() },
  }),
}));

const grantCreditsForPaidInvoiceMock = vi.fn(async (..._args: unknown[]) => {});
const syncSubscriptionFromStripeMock = vi.fn(async (..._args: unknown[]) => {});
const markSubscriptionCanceledMock = vi.fn(async (..._args: unknown[]) => {});

vi.mock("@/lib/billing/subscription-sync", () => ({
  grantCreditsForPaidInvoice: (...args: unknown[]) => grantCreditsForPaidInvoiceMock(...args),
  syncSubscriptionFromStripe: (...args: unknown[]) => syncSubscriptionFromStripeMock(...args),
  markSubscriptionCanceled: (...args: unknown[]) => markSubscriptionCanceledMock(...args),
}));

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

function makeRequest(): Request {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "test-signature" },
    body: JSON.stringify({ id: "evt_paid_1" }),
  });
}

describe("stripe webhook idempotency", () => {
  beforeEach(() => {
    stripeEvents = [];
    grantCreditsForPaidInvoiceMock.mockClear();
    constructEventMock.mockReset();
    constructEventMock.mockReturnValue({
      id: "evt_paid_1",
      type: "invoice.paid",
      data: { object: { subscription: "sub_123" } },
    });
  });

  it("processes a new event exactly once", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(grantCreditsForPaidInvoiceMock).toHaveBeenCalledTimes(1);
    expect(grantCreditsForPaidInvoiceMock).toHaveBeenCalledWith({
      stripeSubscriptionId: "sub_123",
      stripeEventId: "evt_paid_1",
    });
  });

  it("does not grant credits twice for the same Stripe event id", async () => {
    const first = await POST(makeRequest());
    const second = await POST(makeRequest());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const secondBody = await second.json();
    expect(secondBody.duplicate).toBe(true);

    // The same webhook must not grant credits twice.
    expect(grantCreditsForPaidInvoiceMock).toHaveBeenCalledTimes(1);
  });

  it("rejects requests with an invalid signature", async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error("invalid signature");
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    expect(grantCreditsForPaidInvoiceMock).not.toHaveBeenCalled();
  });
});
