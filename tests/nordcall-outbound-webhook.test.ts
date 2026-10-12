import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

// The Nordcall Outbound add-on shares the Stripe webhook with the AIbooking
// packages. Its events must update nordcall.outbound_subscriptions and must
// never reach the package sync or grant package minutes; package events must
// pass through untouched.
const WEBHOOK_SECRET = "whsec_nordcall_test_secret";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

const realStripe = new Stripe("sk_test_dummy_never_used_for_network", { apiVersion: "2025-02-24.acacia" });
const NORDCALL_METADATA = { aibooking_addon: "nordcall_outbound", nordcall_user_id: "11111111-1111-1111-1111-111111111111", nordcall_plan: "minutes_1000" };
const nordcallSubscription = {
  id: "sub_nordcall",
  object: "subscription",
  status: "active",
  customer: "cus_1",
  metadata: NORDCALL_METADATA,
  items: { data: [{ current_period_start: 1_790_000_000, current_period_end: 1_792_600_000 }] },
};
const retrieveMock = vi.fn(async (..._args: unknown[]) => nordcallSubscription);

vi.mock("@/lib/billing/stripe-client", () => ({
  getStripeClient: () => ({ webhooks: realStripe.webhooks, subscriptions: { retrieve: (...args: unknown[]) => retrieveMock(...args) } }),
}));

const grantCreditsForPaidInvoiceMock = vi.fn(async (..._args: unknown[]) => {});
const syncSubscriptionFromStripeMock = vi.fn(async (..._args: unknown[]) => null);

vi.mock("@/lib/billing/subscription-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/subscription-sync")>();
  return {
    getSubscriptionPeriod: actual.getSubscriptionPeriod,
    grantCreditsForPaidInvoice: (...args: unknown[]) => grantCreditsForPaidInvoiceMock(...args),
    syncSubscriptionFromStripe: (...args: unknown[]) => syncSubscriptionFromStripeMock(...args),
    markSubscriptionCanceled: vi.fn(async () => {}),
  };
});

vi.mock("@/lib/phone-numbers", () => ({ provisionVapiNumbersForNewlyPaidCustomer: vi.fn(async () => {}) }));
vi.mock("@/lib/security/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));

const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    schema: () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return { data: fn === "provision_outbound" ? { result: "ok", team_id: "t1" } : "ok", error: null };
      },
    }),
    from: (table: string) => {
      if (table === "stripe_events") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          insert: async () => ({ error: null }),
        };
      }
      if (table === "subscriptions") {
        return { update: () => ({ eq: async () => ({ error: null }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { POST } from "@/app/api/webhooks/stripe/route";

function signedRequest(event: object): Request {
  const payload = JSON.stringify(event);
  const header = realStripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": header, "content-type": "application/json" },
    body: payload,
  });
}

function invoiceEvent(id: string, type: string, metadata: Record<string, string>) {
  return {
    id, object: "event", type,
    data: { object: { id: `in_${id}`, object: "invoice", amount_paid: 50000, currency: "dkk", billing_reason: "subscription_cycle",
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_nordcall", metadata } } } },
  };
}

describe("stripe webhook, Nordcall Outbound add-on", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    grantCreditsForPaidInvoiceMock.mockClear();
    syncSubscriptionFromStripeMock.mockClear();
    retrieveMock.mockClear();
  });

  it("provisions Nordcall on a paid add-on invoice and grants no package minutes", async () => {
    const res = await POST(signedRequest(invoiceEvent("evt_n_paid", "invoice.paid", NORDCALL_METADATA)));
    expect(res.status).toBe(200);
    expect(grantCreditsForPaidInvoiceMock).not.toHaveBeenCalled();
    expect(rpcCalls).toEqual([expect.objectContaining({
      fn: "provision_outbound",
      args: expect.objectContaining({ p_user: NORDCALL_METADATA.nordcall_user_id, p_plan: "minutes_1000", p_status: "active", p_stripe_subscription: "sub_nordcall" }),
    })]);
  });

  it("marks a failed add-on invoice past_due in Nordcall only", async () => {
    const res = await POST(signedRequest(invoiceEvent("evt_n_failed", "invoice.payment_failed", NORDCALL_METADATA)));
    expect(res.status).toBe(200);
    expect(rpcCalls).toEqual([expect.objectContaining({ fn: "update_outbound_subscription", args: expect.objectContaining({ p_status: "past_due" }) })]);
  });

  it("leaves package invoices to the package handling without a Stripe call", async () => {
    const res = await POST(signedRequest(invoiceEvent("evt_pkg_paid", "invoice.paid", {})));
    expect(res.status).toBe(200);
    expect(retrieveMock).not.toHaveBeenCalled();
    expect(rpcCalls).toEqual([]);
    expect(grantCreditsForPaidInvoiceMock).toHaveBeenCalledWith(expect.objectContaining({ stripeSubscriptionId: "sub_nordcall" }));
  });

  it("routes add-on subscription updates to Nordcall, not the package sync", async () => {
    const res = await POST(signedRequest({ id: "evt_n_upd", object: "event", type: "customer.subscription.updated", data: { object: nordcallSubscription } }));
    expect(res.status).toBe(200);
    expect(syncSubscriptionFromStripeMock).not.toHaveBeenCalled();
    expect(rpcCalls[0]?.fn).toBe("provision_outbound");
  });

  it("marks a deleted add-on subscription canceled", async () => {
    const res = await POST(signedRequest({ id: "evt_n_del", object: "event", type: "customer.subscription.deleted", data: { object: nordcallSubscription } }));
    expect(res.status).toBe(200);
    expect(rpcCalls).toEqual([expect.objectContaining({ fn: "update_outbound_subscription", args: expect.objectContaining({ p_status: "canceled" }) })]);
  });
});
