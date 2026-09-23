import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

// End-to-end through the real Stripe SDK's signature check: these payloads
// are signed exactly the way Stripe signs a delivery, so this exercises
// constructEvent for real rather than a mock. The payload shapes cover both
// the pre-2025-03-31 API versions and "basil" and later, since webhook
// payloads follow the endpoint's API version in the Stripe dashboard, not
// the version our SDK pins.
const WEBHOOK_SECRET = "whsec_e2e_test_secret";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

const realStripe = new Stripe("sk_test_dummy_never_used_for_network", { apiVersion: "2025-02-24.acacia" });

vi.mock("@/lib/billing/stripe-client", () => ({
  getStripeClient: () => realStripe,
}));

const grantCreditsForPaidInvoiceMock = vi.fn(async (..._args: unknown[]) => {});
const syncSubscriptionFromStripeMock = vi.fn(async (..._args: unknown[]) => null);

vi.mock("@/lib/billing/subscription-sync", () => ({
  grantCreditsForPaidInvoice: (...args: unknown[]) => grantCreditsForPaidInvoiceMock(...args),
  syncSubscriptionFromStripe: (...args: unknown[]) => syncSubscriptionFromStripeMock(...args),
  markSubscriptionCanceled: vi.fn(async () => {}),
}));

vi.mock("@/lib/phone-numbers", () => ({
  provisionVapiNumbersForNewlyPaidCustomer: vi.fn(async () => {}),
}));

vi.mock("@/lib/security/audit", () => ({
  writeAuditLog: vi.fn(async () => {}),
}));

const subscriptionStatusUpdates: Array<{ status: string; id: string }> = [];

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table === "stripe_events") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          insert: async () => ({ error: null }),
        };
      }
      if (table === "subscriptions") {
        return {
          update: (row: { status: string }) => ({
            eq: async (_col: string, id: string) => {
              subscriptionStatusUpdates.push({ status: row.status, id });
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

function signedRequest(event: object, secret = WEBHOOK_SECRET): Request {
  const payload = JSON.stringify(event);
  const header = realStripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": header, "content-type": "application/json" },
    body: payload,
  });
}

const legacyInvoicePaid = {
  id: "evt_legacy_invoice_paid",
  object: "event",
  type: "invoice.paid",
  data: {
    object: {
      id: "in_legacy",
      object: "invoice",
      subscription: "sub_legacy",
      amount_paid: 99900,
      currency: "dkk",
      billing_reason: "subscription_create",
    },
  },
};

const basilInvoicePaid = {
  id: "evt_basil_invoice_paid",
  object: "event",
  type: "invoice.paid",
  data: {
    object: {
      id: "in_basil",
      object: "invoice",
      amount_paid: 49950,
      currency: "dkk",
      billing_reason: "subscription_cycle",
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_basil", metadata: {} },
      },
    },
  },
};

describe("stripe webhook, real signatures, old and new API versions", () => {
  beforeEach(() => {
    grantCreditsForPaidInvoiceMock.mockClear();
    subscriptionStatusUpdates.length = 0;
  });

  it("credits a paid invoice in the pre-basil payload shape", async () => {
    const res = await POST(signedRequest(legacyInvoicePaid));
    expect(res.status).toBe(200);
    expect(grantCreditsForPaidInvoiceMock).toHaveBeenCalledWith({
      stripeSubscriptionId: "sub_legacy",
      stripeEventId: "evt_legacy_invoice_paid",
      amountPaid: 99900,
      currency: "dkk",
      billingReason: "subscription_create",
    });
  });

  it("credits a paid invoice in the basil+ payload shape (subscription under parent)", async () => {
    const res = await POST(signedRequest(basilInvoicePaid));
    expect(res.status).toBe(200);
    expect(grantCreditsForPaidInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({ stripeSubscriptionId: "sub_basil", stripeEventId: "evt_basil_invoice_paid" })
    );
  });

  it("marks the subscription past_due on a failed basil+ invoice", async () => {
    const res = await POST(
      signedRequest({ ...basilInvoicePaid, id: "evt_basil_failed", type: "invoice.payment_failed" })
    );
    expect(res.status).toBe(200);
    expect(subscriptionStatusUpdates).toEqual([{ status: "past_due", id: "sub_basil" }]);
  });

  it("rejects a delivery signed with a different webhook secret", async () => {
    const res = await POST(signedRequest(legacyInvoicePaid, "whsec_someone_else"));
    expect(res.status).toBe(400);
    expect(grantCreditsForPaidInvoiceMock).not.toHaveBeenCalled();
  });

  it("rejects a delivery whose body was altered after signing", async () => {
    const original = signedRequest(legacyInvoicePaid);
    const tampered = new Request(original.url, {
      method: "POST",
      headers: original.headers,
      body: JSON.stringify({ ...legacyInvoicePaid, data: { object: { subscription: "sub_attacker" } } }),
    });
    const res = await POST(tampered);
    expect(res.status).toBe(400);
    expect(grantCreditsForPaidInvoiceMock).not.toHaveBeenCalled();
  });
});
