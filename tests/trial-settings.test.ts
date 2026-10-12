import { describe, it, expect, vi, beforeEach } from "vitest";

// The free trial's size is set by the master admin (Indstillinger → Gratis
// prøveperiode) instead of being fixed at 10 minutes in the code.

let settings: Record<string, unknown> = {};
let trialGrant: { amount_seconds: number } | null = null;

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      let key: string | null = null;
      const chain = {
        select: () => chain,
        eq(column: string, value: string) {
          if (column === "key") key = value;
          return chain;
        },
        like: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          if (table === "credit_transactions") return { data: trialGrant, error: null };
          return { data: key && key in settings ? { value: settings[key] } : null, error: null };
        },
      };
      return chain;
    },
  }),
}));

const { getTrialMinutes, getTrialSettings, getCustomerTrialMinutes, trialGrantDescription } = await import(
  "@/lib/settings/platform"
);

beforeEach(() => {
  settings = {};
  trialGrant = null;
});

describe("the admin-set trial", () => {
  it("defaults to 10 minutes until the admin sets it", async () => {
    expect(await getTrialMinutes()).toBe(10);
  });

  it("uses the admin's number", async () => {
    settings.trial_minutes = 25;
    expect(await getTrialMinutes()).toBe(25);
  });

  it("allows zero, meaning no free minutes", async () => {
    settings.trial_minutes = 0;
    expect(await getTrialMinutes()).toBe(0);
  });

  it("ignores a stored value that is not a sensible number", async () => {
    settings.trial_minutes = "mange";
    expect(await getTrialMinutes()).toBe(10);
    settings.trial_minutes = -5;
    expect(await getTrialMinutes()).toBe(10);
  });

  it("returns the internal note with the minutes", async () => {
    settings.trial_minutes = 15;
    settings.trial_internal_note = "Koster os ca. 15 kr pr. kunde";
    expect(await getTrialSettings()).toEqual({ minutes: 15, internalNote: "Koster os ca. 15 kr pr. kunde" });
  });

  it("describes the grant with only the minutes, never the note", () => {
    expect(trialGrantDescription(12)).toBe("Gratis prøveperiode: 12 minutter (7 dage)");
  });
});

// A customer given 10 minutes keeps seeing "af 10" on their billing page
// after the admin raises the trial to 20 for new customers.
describe("a customer's own trial size", () => {
  it("is what they were granted, not today's setting", async () => {
    settings.trial_minutes = 20;
    trialGrant = { amount_seconds: 600 };
    expect(await getCustomerTrialMinutes("cust-1")).toBe(10);
  });

  it("falls back to the setting when no grant is found", async () => {
    settings.trial_minutes = 20;
    expect(await getCustomerTrialMinutes("cust-1")).toBe(20);
  });
});
