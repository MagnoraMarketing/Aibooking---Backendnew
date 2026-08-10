import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row {
  [key: string]: unknown;
}

let customers: Row[];
let subscriptions: Row[];
let packages: Row[];
let creditAccounts: Row[];
let creditTransactions: Row[];

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table === "customers") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => ({ data: customers.find((c) => c.id === val) ?? null, error: null }),
            }),
          }),
        };
      }
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: subscriptions.find((s) => s.customer_id === val) ?? null,
                    error: null,
                  }),
                }),
              }),
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
                const account = creditAccounts.find((a) => a.customer_id === val);
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
        let account = creditAccounts.find((a) => a.customer_id === customerId);
        if (!account) {
          account = { id: "acc-1", customer_id: customerId, balance_seconds: 0 };
          creditAccounts.push(account);
        }
        (account.balance_seconds as number) += amount;
        const txn = { id: `txn-${creditTransactions.length + 1}`, customer_id: customerId, amount_seconds: amount };
        creditTransactions.push(txn);
        return { data: txn, error: null };
      },
    }),
  }),
}));

const chargeOverageBlockMock = vi.fn();
vi.mock("@/lib/billing/overage", () => ({
  chargeOverageBlock: (...args: unknown[]) => chargeOverageBlockMock(...args),
}));

import { checkAndRefillIfNeeded } from "@/lib/credits/refill";

describe("automatic credit refill", () => {
  beforeEach(() => {
    customers = [{ id: "cust-1", status: "active", stripe_customer_id: "cus_123" }];
    subscriptions = [{ customer_id: "cust-1", package_id: "pkg-1", status: "active" }];
    packages = [
      {
        id: "pkg-1",
        package_name: "AIbooking 999",
        included_minutes: 150,
        overage_price_per_minute: 6.66,
        currency: "DKK",
        active: true,
      },
    ];
    creditAccounts = [{ id: "acc-1", customer_id: "cust-1", balance_seconds: 0 }];
    creditTransactions = [];
    chargeOverageBlockMock.mockReset();
  });

  it("does nothing when the balance is still positive", async () => {
    creditAccounts[0]!.balance_seconds = 60;
    const result = await checkAndRefillIfNeeded("cust-1");
    expect(result.refilled).toBe(false);
    expect(chargeOverageBlockMock).not.toHaveBeenCalled();
  });

  it("charges the card and grants a fresh 150 minutes when balance hits 0", async () => {
    chargeOverageBlockMock.mockResolvedValue({ success: true, stripeEventHintId: "in_123" });

    const result = await checkAndRefillIfNeeded("cust-1");

    expect(chargeOverageBlockMock).toHaveBeenCalledTimes(1);
    expect(result.refilled).toBe(true);
    expect(result.balanceSeconds).toBe(150 * 60);
  });

  it("does not grant credits when the overage charge fails", async () => {
    chargeOverageBlockMock.mockResolvedValue({ success: false, failureReason: "card_declined" });

    const result = await checkAndRefillIfNeeded("cust-1");

    expect(result.refilled).toBe(false);
    expect(result.reason).toBe("card_declined");
    expect(result.balanceSeconds).toBe(0);
  });

  it("does not attempt a refill without an active subscription", async () => {
    subscriptions = [];
    const result = await checkAndRefillIfNeeded("cust-1");
    expect(result.refilled).toBe(false);
    expect(result.reason).toBe("no_active_subscription");
    expect(chargeOverageBlockMock).not.toHaveBeenCalled();
  });
});
