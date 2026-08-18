import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row {
  [key: string]: unknown;
}

let subscriptions: Row[];
let packages: Row[];
let accounts: { customer_id: string; balance_seconds: number }[];
let txns: Row[];
let idCounter: number;

function nextId(): string {
  idCounter += 1;
  return `id-${idCounter}`;
}

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => ({ data: subscriptions.find((s) => s.stripe_subscription_id === val) ?? null, error: null }),
            }),
          }),
        };
      }
      if (table === "packages") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => ({ data: packages.find((p) => p.id === val) ?? null, error: null }),
            }),
          }),
        };
      }
      if (table === "credit_accounts") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => {
                const account = accounts.find((a) => a.customer_id === val);
                return { data: account ? { balance_seconds: account.balance_seconds } : null, error: null };
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (fnName: string, params: Record<string, unknown>) => ({
      single: async () => {
        if (fnName !== "record_credit_transaction") throw new Error("unexpected rpc");
        const customerId = params.p_customer_id as string;
        const amount = params.p_amount_seconds as number;
        let account = accounts.find((a) => a.customer_id === customerId);
        if (!account) {
          account = { customer_id: customerId, balance_seconds: 0 };
          accounts.push(account);
        }
        account.balance_seconds += amount;
        const txn = { id: nextId(), customer_id: customerId, amount_seconds: amount, type: params.p_type };
        txns.push(txn);
        return { data: txn, error: null };
      },
    }),
  }),
}));

import { grantCreditsForPaidInvoice } from "@/lib/billing/subscription-sync";

describe("grantCreditsForPaidInvoice rollover cap", () => {
  beforeEach(() => {
    subscriptions = [{ stripe_subscription_id: "sub_1", customer_id: "cust-1", package_id: "pkg-1" }];
    packages = [{ id: "pkg-1", package_name: "Starter", included_minutes: 200 }];
    accounts = [];
    txns = [];
    idCounter = 0;
  });

  it("grants the full included minutes when starting from zero balance", async () => {
    await grantCreditsForPaidInvoice({ stripeSubscriptionId: "sub_1", stripeEventId: "evt_1" });
    expect(accounts[0]!.balance_seconds).toBe(200 * 60);
  });

  it("does not expire anything when the resulting balance is within the 3-month cap", async () => {
    accounts.push({ customer_id: "cust-1", balance_seconds: 200 * 60 }); // 1 month unused
    await grantCreditsForPaidInvoice({ stripeSubscriptionId: "sub_1", stripeEventId: "evt_2" });
    // 200 (existing) + 200 (this grant) = 400 min, cap is 600 min (3 x 200) — no expiration.
    expect(accounts[0]!.balance_seconds).toBe(400 * 60);
    expect(txns.some((t) => t.type === "expiration")).toBe(false);
  });

  it("expires the excess above 3x included_minutes after granting", async () => {
    accounts.push({ customer_id: "cust-1", balance_seconds: 650 * 60 }); // already over cap before this grant
    await grantCreditsForPaidInvoice({ stripeSubscriptionId: "sub_1", stripeEventId: "evt_3" });
    // 650 + 200 = 850 min granted, capped down to 600 min (3 x 200).
    expect(accounts[0]!.balance_seconds).toBe(600 * 60);
    const expiration = txns.find((t) => t.type === "expiration");
    expect(expiration).toBeTruthy();
    expect(expiration!.amount_seconds).toBe(-(850 - 600) * 60);
  });
});
