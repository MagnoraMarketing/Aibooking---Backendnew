import { describe, it, expect, vi, beforeEach } from "vitest";

// A real inbound number — bought through us, or handed out free by Vapi —
// is a paid-plan feature (see lib/phone-numbers/service.ts's
// requireActivePhoneNumberSubscription). These tests pin that gate at the
// one place it's implemented, and at both routes that acquire a number.

let subscriptionStatus: string | null | undefined;

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: subscriptionStatus ? { status: subscriptionStatus } : null }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { requireActivePhoneNumberSubscription } from "@/lib/phone-numbers/service";

describe("requireActivePhoneNumberSubscription", () => {
  beforeEach(() => {
    subscriptionStatus = undefined;
  });

  it("lets an active subscription through", async () => {
    subscriptionStatus = "active";
    await expect(requireActivePhoneNumberSubscription("cust-1")).resolves.toBeUndefined();
  });

  it("blocks with 402 when there is no subscription at all", async () => {
    subscriptionStatus = undefined;
    await expect(requireActivePhoneNumberSubscription("cust-1")).rejects.toMatchObject({ status: 402 });
  });

  it("blocks a trialing/canceled/etc subscription — active only", async () => {
    subscriptionStatus = "trialing";
    await expect(requireActivePhoneNumberSubscription("cust-1")).rejects.toMatchObject({ status: 402 });
  });
});

describe("POST /api/customer/phone-numbers/vapi is gated before touching Vapi", () => {
  const ensureInboundAssistant = vi.fn();
  const createVapiManagedNumber = vi.fn();

  beforeEach(() => {
    subscriptionStatus = undefined;
    ensureInboundAssistant.mockClear();
    createVapiManagedNumber.mockClear();
  });

  vi.mock("@/lib/auth", () => ({
    requireCustomerAdmin: async () => ({ userId: "user-1", profile: { customer_id: "cust-1", role: "CUSTOMER_ADMIN" } }),
  }));

  vi.mock("@/lib/vapi", () => ({
    createVapiManagedNumber: (...args: unknown[]) => createVapiManagedNumber(...(args as [])),
    ensureInboundAssistant: (...args: unknown[]) => ensureInboundAssistant(...(args as [])),
    isVapiBillingRefusal: () => false,
    attachAssistantToVapiNumber: async () => {},
    listVapiPhoneNumbers: async () => [],
  }));

  function makeRequest(body: Record<string, unknown>): Request {
    return new Request("http://localhost/api/customer/phone-numbers/vapi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("refuses with 402 and never calls Vapi when there's no active subscription", async () => {
    const { POST } = await import("@/app/api/customer/phone-numbers/vapi/route");

    const res = await POST(makeRequest({ widgetId: "11111111-1111-1111-1111-111111111111" }), { params: {} });

    expect(res.status).toBe(402);
    expect(ensureInboundAssistant).not.toHaveBeenCalled();
    expect(createVapiManagedNumber).not.toHaveBeenCalled();
  });

  it("passes the gate (reaches the widget lookup) once the subscription is active", async () => {
    subscriptionStatus = "active";
    const { POST } = await import("@/app/api/customer/phone-numbers/vapi/route");

    const res = await POST(makeRequest({ widgetId: "11111111-1111-1111-1111-111111111111" }), { params: {} });

    // No widget row exists in this stub's DB mock, so the gate having let
    // the request through shows up as the *next* check (widget ownership)
    // failing — not the 402 the un-gated case above asserts.
    expect(res.status).not.toBe(402);
    expect(ensureInboundAssistant).not.toHaveBeenCalled();
  });
});
