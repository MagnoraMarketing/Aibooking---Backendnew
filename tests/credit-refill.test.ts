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
          update: (patch: Row) => ({
            eq: (_col: string, val: string) => {
              const account = creditAccounts.find((a) => a.customer_id === val);
              if (account) Object.assign(account, patch);
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (fnName: string, params: Record<string, unknown>) => {
      if (fnName === "try_claim_recharge") {
        const customerId = params.p_customer_id as string;
        let account = creditAccounts.find((a) => a.customer_id === customerId);
        if (!account) {
          account = { id: "acc-1", customer_id: customerId, balance_seconds: 0, recharge_pending_at: null };
          creditAccounts.push(account);
        }
        if (account.recharge_pending_at) {
          return Promise.resolve({ data: false, error: null });
        }
        account.recharge_pending_at = new Date().toISOString();
        return Promise.resolve({ data: true, error: null });
      }
      return {
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
      };
    },
  }),
}));

const chargePackageRechargeMock = vi.fn();
vi.mock("@/lib/billing/recharge", () => ({
  chargePackageRecharge: (...args: unknown[]) => chargePackageRechargeMock(...args),
}));

import { checkAndRefillIfNeeded, canUserMakeCall } from "@/lib/credits/refill";

describe("automatic credit refill", () => {
  beforeEach(() => {
    customers = [{ id: "cust-1", status: "active", stripe_customer_id: "cus_123", is_platform_owned: false }];
    subscriptions = [{ customer_id: "cust-1", package_id: "pkg-1", status: "active", stripe_subscription_id: "sub_123" }];
    packages = [
      {
        id: "pkg-1",
        package_name: "Starter",
        monthly_price: 999,
        included_minutes: 150,
        overage_price_per_minute: 6.66,
        currency: "DKK",
        active: true,
      },
    ];
    creditAccounts = [{ id: "acc-1", customer_id: "cust-1", balance_seconds: 0, recharge_pending_at: null }];
    creditTransactions = [];
    chargePackageRechargeMock.mockReset();
  });

  it("does nothing when the balance is still positive", async () => {
    creditAccounts[0]!.balance_seconds = 60;
    const result = await checkAndRefillIfNeeded("cust-1");
    expect(result.refilled).toBe(false);
    expect(chargePackageRechargeMock).not.toHaveBeenCalled();
  });

  it("charges the full package price and grants a fresh 150 minutes when balance hits 0", async () => {
    chargePackageRechargeMock.mockResolvedValue({ success: true, stripeEventHintId: "in_123" });

    const result = await checkAndRefillIfNeeded("cust-1");

    expect(chargePackageRechargeMock).toHaveBeenCalledTimes(1);
    const chargeArgs = chargePackageRechargeMock.mock.calls[0]![0] as { pkg: Row };
    expect(chargeArgs.pkg.monthly_price).toBe(999);
    expect(result.refilled).toBe(true);
    expect(result.balanceSeconds).toBe(150 * 60);
    // The claim is released once the attempt finishes.
    expect(creditAccounts[0]!.recharge_pending_at).toBeNull();
  });

  it("does not grant credits when the recharge charge fails, and releases the claim", async () => {
    chargePackageRechargeMock.mockResolvedValue({ success: false, failureReason: "card_declined" });

    const result = await checkAndRefillIfNeeded("cust-1");

    expect(result.refilled).toBe(false);
    expect(result.reason).toBe("card_declined");
    expect(result.balanceSeconds).toBe(0);
    expect(creditAccounts[0]!.recharge_pending_at).toBeNull();
  });

  it("does not attempt a refill without an active subscription", async () => {
    subscriptions = [];
    const result = await checkAndRefillIfNeeded("cust-1");
    expect(result.refilled).toBe(false);
    expect(result.reason).toBe("no_active_subscription");
    expect(chargePackageRechargeMock).not.toHaveBeenCalled();
  });

  it("never charges the platform-owned internal customer — needs a manual top-up instead", async () => {
    customers[0]!.is_platform_owned = true;
    const result = await checkAndRefillIfNeeded("cust-1");
    expect(result.refilled).toBe(false);
    expect(result.reason).toBe("platform_owned_needs_manual_topup");
    expect(chargePackageRechargeMock).not.toHaveBeenCalled();
  });

  it("skips a second recharge attempt while one is already claimed", async () => {
    creditAccounts[0]!.recharge_pending_at = new Date().toISOString();
    const result = await checkAndRefillIfNeeded("cust-1");
    expect(result.refilled).toBe(false);
    expect(result.reason).toBe("recharge_already_in_progress");
    expect(chargePackageRechargeMock).not.toHaveBeenCalled();
  });

  it("canUserMakeCall reflects whether the balance ends up positive", async () => {
    creditAccounts[0]!.balance_seconds = 60;
    expect(await canUserMakeCall("cust-1")).toBe(true);

    creditAccounts[0]!.balance_seconds = 0;
    chargePackageRechargeMock.mockResolvedValue({ success: false, failureReason: "card_declined" });
    expect(await canUserMakeCall("cust-1")).toBe(false);
  });
});
