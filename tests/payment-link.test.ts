import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Two things decide whether a customer can actually pay: a Stripe Price to
// bill the subscription against, and the URL Stripe sends them back to.
// Both were broken on the live platform — every package had a null
// stripe_price_id (checkout answered "Kontakt support"), and the return URL
// fell back to localhost whenever NEXT_PUBLIC_APP_URL wasn't set.

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("public app URL", () => {
  async function appUrl() {
    vi.resetModules();
    const { getPublicAppUrl, isPubliclyReachableAppUrl } = await import("@/lib/app-url");
    return { getPublicAppUrl, isPubliclyReachableAppUrl };
  }

  it("uses the configured domain", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://aibooking.dk";
    const { getPublicAppUrl } = await appUrl();
    expect(getPublicAppUrl()).toBe("https://aibooking.dk");
  });

  it("drops a trailing slash so callers can append a path safely", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://aibooking.dk/";
    const { getPublicAppUrl } = await appUrl();
    expect(getPublicAppUrl()).toBe("https://aibooking.dk");
  });

  it("falls back to the deployment's own URL rather than localhost", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_URL = "aibooking-backendnew.vercel.app";
    const { getPublicAppUrl, isPubliclyReachableAppUrl } = await appUrl();
    expect(getPublicAppUrl()).toBe("https://aibooking-backendnew.vercel.app");
    expect(isPubliclyReachableAppUrl()).toBe(true);
  });

  it("reports localhost as unreachable, so nothing hands it to a third party", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;
    const { getPublicAppUrl, isPubliclyReachableAppUrl } = await appUrl();
    expect(getPublicAppUrl()).toBe("http://localhost:3000");
    expect(isPubliclyReachableAppUrl()).toBe(false);
  });
});

// --- checkout -------------------------------------------------------------

const created: { prices: Record<string, unknown>[]; sessions: Record<string, unknown>[] } = {
  prices: [],
  sessions: [],
};
let packageUpdate: Record<string, unknown> | null = null;

vi.mock("@/lib/billing/stripe-client", () => ({
  getStripeClient: () => ({
    customers: { create: async () => ({ id: "cus_1" }) },
    prices: {
      create: async (payload: Record<string, unknown>) => {
        created.prices.push(payload);
        return { id: "price_created_1" };
      },
      retrieve: async (id: string) => ({ id, product: { id: "prod_manual", tax_code: "txcd_10103001" } }),
    },
    checkout: {
      sessions: {
        create: async (payload: Record<string, unknown>) => {
          created.sessions.push(payload);
          return { url: "https://checkout.stripe.com/c/pay/cs_test_1" };
        },
      },
    },
  }),
}));

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      const chain = {
        update(payload: Record<string, unknown>) {
          if (table === "packages") packageUpdate = payload;
          return chain;
        },
        eq: async () => ({ error: null }),
      };
      return chain;
    },
  }),
}));

const { createCheckoutSession } = await import("@/lib/billing/checkout");

const CUSTOMER = {
  id: "cust-a",
  email: "kunde@example.dk",
  name: "Kunde ApS",
  stripe_customer_id: "cus_1",
} as Parameters<typeof createCheckoutSession>[0]["customer"];

function pkg(overrides: Record<string, unknown> = {}) {
  return {
    id: "pkg-a",
    package_name: "Starter",
    monthly_price: 999,
    currency: "DKK",
    included_minutes: 200,
    setup_fee: null,
    stripe_price_id: null,
    ...overrides,
  } as Parameters<typeof createCheckoutSession>[0]["pkg"];
}

beforeEach(() => {
  created.prices = [];
  created.sessions = [];
  packageUpdate = null;
  process.env.NEXT_PUBLIC_APP_URL = "https://aibooking.dk";
});

describe("checkout for a package with no Stripe price", () => {
  it("creates the price from the package's own numbers instead of refusing", async () => {
    const result = await createCheckoutSession({ customer: CUSTOMER, pkg: pkg() });

    expect(result.url).toContain("checkout.stripe.com");
    expect(created.prices[0]).toMatchObject({
      currency: "dkk",
      unit_amount: 99900,
      recurring: { interval: "month" },
    });
  });

  it("stores the new price on the package so the next checkout reuses it", async () => {
    await createCheckoutSession({ customer: CUSTOMER, pkg: pkg() });

    expect(packageUpdate).toEqual({ stripe_price_id: "price_created_1" });
  });

  it("leaves a price configured by hand alone", async () => {
    await createCheckoutSession({ customer: CUSTOMER, pkg: pkg({ stripe_price_id: "price_manual" }) });

    expect(created.prices).toHaveLength(0);
    expect(created.sessions[0]).toMatchObject({ line_items: [{ price: "price_manual", quantity: 1 }] });
  });

  it("sends the customer back to the real domain after paying", async () => {
    await createCheckoutSession({ customer: CUSTOMER, pkg: pkg() });

    expect(created.sessions[0]).toMatchObject({
      success_url: "https://aibooking.dk/dashboard/billing?checkout=success",
      cancel_url: "https://aibooking.dk/dashboard/billing?checkout=cancelled",
    });
  });

  it("leaves the one-time setup fee out by default — it's an opt-in add-on", async () => {
    await createCheckoutSession({ customer: CUSTOMER, pkg: pkg({ setup_fee: 999 }) });

    const session = created.sessions[0];
    expect(session).toBeDefined();
    const lineItems = session!.line_items as Record<string, unknown>[];
    expect(lineItems).toHaveLength(1);
  });

  it("bills the one-time setup fee alongside the subscription when the customer opts in", async () => {
    await createCheckoutSession({ customer: CUSTOMER, pkg: pkg({ setup_fee: 999 }), includeSetup: true });

    const session = created.sessions[0];
    expect(session).toBeDefined();
    const lineItems = session!.line_items as Record<string, unknown>[];
    expect(lineItems).toHaveLength(2);
    expect(lineItems[1]).toMatchObject({ price_data: { currency: "dkk", unit_amount: 99900 } });
  });
});
