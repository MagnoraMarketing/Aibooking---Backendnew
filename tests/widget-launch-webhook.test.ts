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

const grantWidgetLaunchCreditsMock = vi.fn(async (..._args: unknown[]) => ({ granted: true }));

vi.mock("@/lib/billing/widget-launch", async () => {
  const offer = await vi.importActual<typeof import("@/lib/billing/widget-launch-offer")>(
    "@/lib/billing/widget-launch-offer"
  );
  return {
    ...offer,
    grantWidgetLaunchCredits: (...args: unknown[]) => grantWidgetLaunchCreditsMock(...args),
  };
});

vi.mock("@/lib/billing/subscription-sync", () => ({
  grantCreditsForPaidInvoice: vi.fn(async () => {}),
  syncSubscriptionFromStripe: vi.fn(async () => {}),
  markSubscriptionCanceled: vi.fn(async () => {}),
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
import { buildWidgetLaunchReference } from "@/lib/billing/widget-launch-offer";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const WIDGET_ID = "22222222-2222-4222-8222-222222222222";

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

describe("widget launch offer via the Stripe webhook", () => {
  beforeEach(() => {
    stripeEvents = [];
    grantWidgetLaunchCreditsMock.mockClear();
    constructEventMock.mockReset();
  });

  it("credits the launch minutes for a paid Payment Link session", async () => {
    constructEventMock.mockReturnValue(
      checkoutCompleted("evt_launch_1", {
        client_reference_id: buildWidgetLaunchReference({ customerId: CUSTOMER_ID, widgetId: WIDGET_ID }),
      })
    );

    const res = await POST(makeRequest("evt_launch_1"));

    expect(res.status).toBe(200);
    expect(grantWidgetLaunchCreditsMock).toHaveBeenCalledTimes(1);
    expect(grantWidgetLaunchCreditsMock).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      widgetId: WIDGET_ID,
      // Keyed on the Checkout Session, not the event: the return page knows
      // only the session id, and the two must collide so whichever runs
      // second is a no-op.
      stripeEventId: "cs_test_1",
    });
  });

  it("ignores a checkout session that carries no reference of ours", async () => {
    constructEventMock.mockReturnValue(checkoutCompleted("evt_launch_2", { client_reference_id: null }));

    await POST(makeRequest("evt_launch_2"));

    expect(grantWidgetLaunchCreditsMock).not.toHaveBeenCalled();
  });

  it("ignores an unpaid checkout session", async () => {
    constructEventMock.mockReturnValue(
      checkoutCompleted("evt_launch_3", {
        payment_status: "unpaid",
        client_reference_id: buildWidgetLaunchReference({ customerId: CUSTOMER_ID, widgetId: WIDGET_ID }),
      })
    );

    await POST(makeRequest("evt_launch_3"));

    expect(grantWidgetLaunchCreditsMock).not.toHaveBeenCalled();
  });

  it("leaves subscription checkouts to the invoice.paid path", async () => {
    constructEventMock.mockReturnValue(
      checkoutCompleted("evt_launch_4", {
        subscription: "sub_123",
        client_reference_id: buildWidgetLaunchReference({ customerId: CUSTOMER_ID, widgetId: WIDGET_ID }),
      })
    );

    await POST(makeRequest("evt_launch_4"));

    expect(grantWidgetLaunchCreditsMock).not.toHaveBeenCalled();
  });

  it("does not credit the same session twice when Stripe redelivers the event", async () => {
    constructEventMock.mockReturnValue(
      checkoutCompleted("evt_launch_5", {
        client_reference_id: buildWidgetLaunchReference({ customerId: CUSTOMER_ID, widgetId: WIDGET_ID }),
      })
    );

    await POST(makeRequest("evt_launch_5"));
    const second = await POST(makeRequest("evt_launch_5"));

    expect((await second.json()).duplicate).toBe(true);
    expect(grantWidgetLaunchCreditsMock).toHaveBeenCalledTimes(1);
  });
});
