import { describe, it, expect, vi, beforeEach } from "vitest";

// The dashboard's "buy this package" button always posts to
// /api/billing/checkout. Every package — Starter/Professional/Enterprise
// included — now goes through the same code-driven Stripe Checkout Session
// (createCheckoutSession) rather than the old fixed Payment Links, so the
// setup fee and package validation are enforced from here. A customer who
// already has an active/trialing subscription and picks a DIFFERENT package
// gets it switched in place instead (no second subscription, no double
// billing) — see app/api/billing/checkout/route.ts.

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const STARTER_PACKAGE_ID = "22222222-2222-4222-8222-222222222222";
const PROFESSIONAL_PACKAGE_ID = "33333333-3333-4333-8333-333333333333";
const CUSTOMER = { id: CUSTOMER_ID, email: "kunde@example.dk", name: "Kunde ApS", stripe_customer_id: null };

let packagesById: Record<string, Record<string, unknown>>;
let currentSubscription: Record<string, unknown> | null;

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
        order: () => chain,
        limit: () => chain,
        single: async () => ({ data: table === "customers" ? CUSTOMER : null, error: null }),
        maybeSingle: async () => {
          if (table === "packages") {
            const id = (chain as { _pkgId?: string })._pkgId;
            return { data: id ? (packagesById[id] ?? null) : null, error: null };
          }
          if (table === "subscriptions") {
            return { data: currentSubscription, error: null };
          }
          return { data: null, error: null };
        },
      } as Record<string, unknown> & { _pkgId?: string };
      return chain;
    },
  }),
}));

const createCheckoutSessionMock = vi.fn(async (..._args: unknown[]) => ({
  url: "https://checkout.stripe.com/c/pay/cs_dynamic_1",
}));
const switchSubscriptionPackageMock = vi.fn(async (..._args: unknown[]) => ({
  switched: true,
  subscriptionId: "sub_existing_1",
}));
vi.mock("@/lib/billing", () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSessionMock(...args),
  switchSubscriptionPackage: (...args: unknown[]) => switchSubscriptionPackageMock(...args),
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
    switchSubscriptionPackageMock.mockClear();
    currentSubscription = null;
    packagesById = {
      [STARTER_PACKAGE_ID]: { id: STARTER_PACKAGE_ID, package_name: "Starter", active: true },
      [PROFESSIONAL_PACKAGE_ID]: { id: PROFESSIONAL_PACKAGE_ID, package_name: "Professional", active: true },
    };
  });

  it("starts a dynamic Checkout Session for a first-time subscriber, without a setup fee by default", async () => {
    const res = await POST(request({ packageId: STARTER_PACKAGE_ID }), { params: {} });
    const body = await res.json();

    expect(switchSubscriptionPackageMock).not.toHaveBeenCalled();
    expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1);
    expect(createCheckoutSessionMock.mock.calls[0]![0]).toMatchObject({ includeSetup: false });
    expect(body.url).toBe("https://checkout.stripe.com/c/pay/cs_dynamic_1");
  });

  it("passes includeSetup through when the customer opts into the setup fee", async () => {
    await POST(request({ packageId: STARTER_PACKAGE_ID, includeSetup: true }), { params: {} });
    expect(createCheckoutSessionMock.mock.calls[0]![0]).toMatchObject({ includeSetup: true });
  });

  it("switches an existing active subscription in place instead of starting a second one", async () => {
    currentSubscription = { id: "sub-row-1", package_id: STARTER_PACKAGE_ID, status: "active", stripe_subscription_id: "sub_existing_1" };

    const res = await POST(request({ packageId: PROFESSIONAL_PACKAGE_ID }), { params: {} });
    const body = await res.json();

    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    expect(switchSubscriptionPackageMock).toHaveBeenCalledTimes(1);
    expect(body).toEqual({ switched: true, subscriptionId: "sub_existing_1" });
  });

  it("rejects re-buying the package the customer is already subscribed to", async () => {
    currentSubscription = { id: "sub-row-1", package_id: STARTER_PACKAGE_ID, status: "active", stripe_subscription_id: "sub_existing_1" };

    const res = await POST(request({ packageId: STARTER_PACKAGE_ID }), { params: {} });

    expect(res.status).toBe(400);
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    expect(switchSubscriptionPackageMock).not.toHaveBeenCalled();
  });

  it("ignores a canceled subscription and starts a fresh Checkout Session", async () => {
    currentSubscription = { id: "sub-row-1", package_id: STARTER_PACKAGE_ID, status: "canceled", stripe_subscription_id: "sub_existing_1" };

    const res = await POST(request({ packageId: PROFESSIONAL_PACKAGE_ID }), { params: {} });
    const body = await res.json();

    expect(switchSubscriptionPackageMock).not.toHaveBeenCalled();
    expect(createCheckoutSessionMock).toHaveBeenCalledTimes(1);
    expect(body.url).toBe("https://checkout.stripe.com/c/pay/cs_dynamic_1");
  });
});
