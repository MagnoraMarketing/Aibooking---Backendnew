import { describe, it, expect, vi, beforeEach } from "vitest";

interface SubaccountRow {
  customer_id: string;
  twilio_subaccount_sid: string;
  twilio_subaccount_auth_token: string;
  status: string;
}

let rows: SubaccountRow[];
let insertShouldConflict: boolean;

const twilioFetchMock = vi.fn();

vi.mock("@/lib/twilio/client", () => ({
  getPlatformTwilioCredentials: () => ({ accountSid: "AC_master", authToken: "master_token" }),
  twilioFetch: (...args: unknown[]) => twilioFetchMock(...args),
}));

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table !== "twilio_subaccounts") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: async () => ({ data: rows.find((r) => r.customer_id === val) ?? null, error: null }),
            single: async () => {
              const row = rows.find((r) => r.customer_id === val);
              return row ? { data: row, error: null } : { data: null, error: new Error("not found") };
            },
          }),
        }),
        insert: (row: Omit<SubaccountRow, "status"> & { status: string }) => ({
          select: () => ({
            single: async () => {
              if (insertShouldConflict) {
                // Simulate a concurrent request having already inserted the row.
                rows.push({ ...row });
                return { data: null, error: new Error("duplicate key value violates unique constraint") };
              }
              rows.push({ ...row });
              return { data: row, error: null };
            },
          }),
        }),
      };
    },
  }),
}));

import { getOrCreateSubaccount } from "@/lib/twilio/subaccounts";

describe("getOrCreateSubaccount", () => {
  beforeEach(() => {
    rows = [];
    insertShouldConflict = false;
    twilioFetchMock.mockReset();
    twilioFetchMock.mockResolvedValue({
      json: async () => ({ sid: "AC_sub_new", auth_token: "sub_token_new" }),
    });
  });

  it("creates a new subaccount via the Twilio API on first call", async () => {
    const credentials = await getOrCreateSubaccount("customer-1");

    expect(credentials).toEqual({ accountSid: "AC_sub_new", authToken: "sub_token_new" });
    expect(twilioFetchMock).toHaveBeenCalledTimes(1);
    expect(twilioFetchMock).toHaveBeenCalledWith(
      "/Accounts.json",
      { accountSid: "AC_master", authToken: "master_token" },
      expect.objectContaining({ method: "POST" })
    );
  });

  it("reuses an existing subaccount without calling Twilio again", async () => {
    rows.push({
      customer_id: "customer-1",
      twilio_subaccount_sid: "AC_existing",
      twilio_subaccount_auth_token: "existing_token",
      status: "active",
    });

    const credentials = await getOrCreateSubaccount("customer-1");

    expect(credentials).toEqual({ accountSid: "AC_existing", authToken: "existing_token" });
    expect(twilioFetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the winning row when it loses a create race", async () => {
    insertShouldConflict = true;

    const credentials = await getOrCreateSubaccount("customer-1");

    // The "conflict" path in this mock still pushes the row (standing in for
    // the concurrent winner's insert) — getOrCreateSubaccount should recover
    // by reading it back rather than throwing.
    expect(credentials).toEqual({ accountSid: "AC_sub_new", authToken: "sub_token_new" });
  });

  it("rejects a customer whose subaccount is suspended rather than silently reusing it", async () => {
    rows.push({
      customer_id: "customer-1",
      twilio_subaccount_sid: "AC_existing",
      twilio_subaccount_auth_token: "existing_token",
      status: "suspended",
    });

    await expect(getOrCreateSubaccount("customer-1")).rejects.toThrow(/suspended/);
  });
});
