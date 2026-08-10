import { describe, it, expect, vi, beforeEach } from "vitest";

interface Account {
  id: string;
  customer_id: string;
  balance_seconds: number;
}
interface Txn {
  id: string;
  customer_id: string;
  credit_account_id: string;
  amount_seconds: number;
  type: string;
}

let accounts: Account[];
let txns: Txn[];
let idCounter: number;

function nextId(): string {
  idCounter += 1;
  return `id-${idCounter}`;
}

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    rpc: (fnName: string, params: Record<string, unknown>) => ({
      single: async () => {
        if (fnName !== "record_credit_transaction") throw new Error(`unexpected rpc ${fnName}`);
        const customerId = params.p_customer_id as string;
        const amount = params.p_amount_seconds as number;

        let account = accounts.find((a) => a.customer_id === customerId);
        if (!account) {
          account = { id: nextId(), customer_id: customerId, balance_seconds: 0 };
          accounts.push(account);
        }

        const txn: Txn = {
          id: nextId(),
          customer_id: customerId,
          credit_account_id: account.id,
          amount_seconds: amount,
          type: params.p_type as string,
        };
        txns.push(txn);
        account.balance_seconds += amount;

        return { data: txn, error: null };
      },
    }),
    from: (table: string) => {
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
  }),
}));

import { grantCredits, deductUsage, manualAdjustment, getBalanceSeconds } from "@/lib/credits/ledger";

describe("credit ledger", () => {
  beforeEach(() => {
    accounts = [];
    txns = [];
    idCounter = 0;
  });

  it("SUM(transactions) matches the cached balance for a grant + usage sequence", async () => {
    await grantCredits({
      customerId: "cust-1",
      seconds: 150 * 60,
      description: "AIbooking 999: 150 minutter",
    });
    expect(await getBalanceSeconds("cust-1")).toBe(150 * 60);

    await deductUsage({ customerId: "cust-1", seconds: 10 * 60, usageSessionId: "sess-1" });
    expect(await getBalanceSeconds("cust-1")).toBe(140 * 60);

    const ledgerSum = txns
      .filter((t) => t.customer_id === "cust-1")
      .reduce((sum, t) => sum + t.amount_seconds, 0);
    expect(ledgerSum).toBe(140 * 60);
  });

  it("supports manual adjustments in both directions", async () => {
    await grantCredits({ customerId: "cust-2", seconds: 60, description: "seed" });
    await manualAdjustment({
      customerId: "cust-2",
      seconds: -30,
      description: "correction",
      createdBy: "admin-1",
    });
    expect(await getBalanceSeconds("cust-2")).toBe(30);
  });

  it("rejects non-positive amounts on grant/deduct helpers", async () => {
    await expect(grantCredits({ customerId: "cust-3", seconds: 0, description: "x" })).rejects.toThrow();
    await expect(
      deductUsage({ customerId: "cust-3", seconds: -5, usageSessionId: "s" })
    ).rejects.toThrow();
  });

  it("returns 0 balance for a customer with no credit account yet", async () => {
    expect(await getBalanceSeconds("never-seen")).toBe(0);
  });
});
