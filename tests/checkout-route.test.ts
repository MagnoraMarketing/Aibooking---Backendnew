import { describe, it, expect, vi, beforeEach } from "vitest";

// The dashboard's "buy this package" button always posts to
// /api/billing/checkout. For Starter/Professional/Enterprise it must now
// return the fixed Payment Link built by package-launch-offer.ts (so the
// price the customer pays matches the marketing site) rather than a
// dynamically created Checkout Session — see app/api/billing/checkout/route.ts.

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const STARTER_PACKAGE_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOM_PACKAGE_ID = "33333333-3333-4333-8333-333333333333";
const CUSTOMER = { id: CUSTOMER_ID, email: "kunde@example.dk", name: "Kunde ApS", stripe_customer_id: null };

let packagesById: Record<string, Record<string, unknown>>;

vi.mock("@/lib/auth", () => ({
  requireCustomerAdmin: async () => ({
    userId: "user-a",
    profile: { role: "CUSTOMER_ADMIN", customer_id: CUSTOMER_ID },
  }),
}));

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from(table: string) {
      const chain = {
        select: () => chain,
        eq(col: string, val: string) {
          if (table === "packages" && col === "id") {
            (chain as { _pkgId?: string })._pkgId = val;
          }
          return chain;
        },
        single: async () => ({ data: table === "customers" ? CUSTOMER : null, error: null }),
        maybeSingle: async () => {
          if (table !== "packages") return { data: null, error: null };
          const id = (chain as { _pkgId?: string })._pkgId;
          return { data: id ? (packagesById[id] ?? null) : null, error: null };
        },
      } as Record<string, unknown> & { _pkgId?: string };
      return chain;
    },
  }),
}));

const createCheckoutSessionMock = vi.fn(async (..._args: unknown[]) => ({
  url: "https://checkout.stripe.com/c/pay/cs_dynamic_1",
}));
vi.mock("@/lib/billing", () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSessionMock(...args),
}));

import { POST } from "@/app/api/billing/checkout/route";

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/billing/checkout", () => {
  beforeEach(() => {
    createCheckoutSessionMock.mockClear();
    packagesById = {
      [STARTER_PACKAGE_ID]: { id: STARTER_PACKAGE_ID, package_name: "Starter", active: true },
      [CUSTOM_PACKAGE_ID]: { id: CUSTOM_PACKAGE_ID, package_name: "Custom Enterprise Deal", active: true },
    };
  });

  it("sends Starter to the fixed Payment Link with the account's own reference", async () => {
    const res = await POST(request({ packageId: STARTER_PACKAGE_ID }), { params: {} });
    const body = await res.json();

    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    expect(body.url).toContain("buy.stripe.com/14A00iepJ1xp9AU2AP4AU06");
    expect(body.url).toContain(`client_reference_id=${CUSTOMER_ID}__${STARTER_PACKAGE_ID}`);
  });

  it("falls back to a dynamic Checkout Session for a package outside the three fixed tiers", async () => {
    const res = await POST(request({ packageId: CUSTOM_PACKAGE_ID }), { params: {} });
    const body = await res.json();

    expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1);
    expect(body.url).toBe("https://checkout.stripe.com/c/pay/cs_dynamic_1");
  });
});
