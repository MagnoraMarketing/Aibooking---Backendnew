import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

const upserts: Array<Record<string, unknown>> = [];

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table !== "subscriptions") throw new Error(`unexpected table ${table}`);
      return {
        upsert: async (row: Record<string, unknown>) => {
          upserts.push(row);
          return { error: null };
        },
      };
    },
  }),
}));

vi.mock("@/lib/credits/ledger", () => ({
  grantCredits: vi.fn(async () => {}),
  getBalanceSeconds: vi.fn(async () => 0),
  expireCredits: vi.fn(async () => {}),
}));

vi.mock("@/lib/email/internal-notifications", () => ({
  notifyCustomerPayment: vi.fn(async () => {}),
}));

import { syncSubscriptionFromStripe } from "@/lib/billing/subscription-sync";

const CUSTOMER_ID = "11111111-1111-1111-1111-111111111111";
const PACKAGE_ID = "22222222-2222-2222-2222-222222222222";
const START = 1790000000;
const END = 1792592000;

function subscription(shape: "legacy" | "basil"): Stripe.Subscription {
  const item = {
    id: "si_1",
    price: { id: "price_1" },
    ...(shape === "basil" ? { current_period_start: START, current_period_end: END } : {}),
  };
  return {
    id: `sub_${shape}`,
    object: "subscription",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    metadata: { aibooking_customer_id: CUSTOMER_ID, aibooking_package_id: PACKAGE_ID },
    items: { data: [item] },
    ...(shape === "legacy" ? { current_period_start: START, current_period_end: END } : {}),
  } as unknown as Stripe.Subscription;
}

describe("syncSubscriptionFromStripe across Stripe API versions", () => {
  beforeEach(() => {
    upserts.length = 0;
  });

  it.each(["legacy", "basil"] as const)("stores the billing period from a %s-shaped subscription", async (shape) => {
    const synced = await syncSubscriptionFromStripe(subscription(shape));

    expect(synced).toEqual({ customerId: CUSTOMER_ID, status: "active" });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      customer_id: CUSTOMER_ID,
      package_id: PACKAGE_ID,
      stripe_subscription_id: `sub_${shape}`,
      current_period_start: new Date(START * 1000).toISOString(),
      current_period_end: new Date(END * 1000).toISOString(),
    });
  });
});
