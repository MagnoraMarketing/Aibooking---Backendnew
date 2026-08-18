import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

interface StripeEventRow {
  id: string;
  type: string;
  payload: unknown;
}

interface PhoneNumberRow {
  id: string;
  purchase_status: string;
  stripe_subscription_id: string | null;
}

let stripeEvents: StripeEventRow[];
let phoneNumbers: Record<string, PhoneNumberRow>;

const constructEventMock = vi.fn();

vi.mock("@/lib/billing/stripe-client", () => ({
  getStripeClient: () => ({
    webhooks: { constructEvent: constructEventMock },
    subscriptions: { retrieve: vi.fn() },
  }),
}));

const provisionPurchasedNumberMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/phone-numbers", () => ({
  provisionPurchasedNumber: (...args: unknown[]) => provisionPurchasedNumberMock(...args),
}));

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
      if (table === "stripe_events") {
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
      }
      if (table === "phone_numbers") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => ({ data: phoneNumbers[val] ?? null, error: null }),
            }),
          }),
          update: (patch: Partial<PhoneNumberRow>) => ({
            eq: async (_col: string, val: string) => {
              const row = phoneNumbers[val];
              if (row) Object.assign(row, patch);
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { POST } from "@/app/api/webhooks/stripe/route";

function makeRequest(eventId: string): Request {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "test-signature" },
    body: JSON.stringify({ id: eventId }),
  });
}

function checkoutCompletedEvent(eventId: string, phoneNumberRowId: string) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        subscription: "sub_phone_1",
        metadata: { type: "phone_number_purchase", phone_number_row_id: phoneNumberRowId },
      },
    },
  };
}

describe("phone number checkout webhook", () => {
  beforeEach(() => {
    stripeEvents = [];
    phoneNumbers = { "pn-1": { id: "pn-1", purchase_status: "pending_payment", stripe_subscription_id: null } };
    provisionPurchasedNumberMock.mockClear();
    constructEventMock.mockReset();
  });

  it("provisions the number and marks payment confirmed on a fresh event", async () => {
    constructEventMock.mockReturnValue(checkoutCompletedEvent("evt_1", "pn-1"));

    const res = await POST(makeRequest("evt_1"));

    expect(res.status).toBe(200);
    expect(provisionPurchasedNumberMock).toHaveBeenCalledTimes(1);
    expect(provisionPurchasedNumberMock).toHaveBeenCalledWith("pn-1");
    const row = phoneNumbers["pn-1"];
    expect(row?.purchase_status).toBe("payment_confirmed");
    expect(row?.stripe_subscription_id).toBe("sub_phone_1");
  });

  it("does not provision twice for the same Stripe event id", async () => {
    constructEventMock.mockReturnValue(checkoutCompletedEvent("evt_2", "pn-1"));

    await POST(makeRequest("evt_2"));
    const second = await POST(makeRequest("evt_2"));

    const secondBody = await second.json();
    expect(secondBody.duplicate).toBe(true);
    expect(provisionPurchasedNumberMock).toHaveBeenCalledTimes(1);
  });

  it("is a no-op if the row is no longer pending_payment (already provisioned)", async () => {
    const existing = phoneNumbers["pn-1"];
    if (existing) existing.purchase_status = "active";
    constructEventMock.mockReturnValue(checkoutCompletedEvent("evt_3", "pn-1"));

    const res = await POST(makeRequest("evt_3"));

    expect(res.status).toBe(200);
    expect(provisionPurchasedNumberMock).not.toHaveBeenCalled();
  });
});
