import { describe, it, expect, vi, beforeEach } from "vitest";

// Stripe Managed Payments rejects a Checkout line item whose Product has no
// tax_code ("Invalid line_items[0]: the product tax code is missing"). These
// cover every way a line item's product reaches Checkout: a Price we create,
// a Price that already exists (env var / packages.stripe_price_id), and the
// one-off setup fee.

const pricesCreate = vi.fn(async (..._args: unknown[]) => ({ id: "price_new" }));
const pricesRetrieve = vi.fn();
const productsUpdate = vi.fn(async (..._args: unknown[]) => ({}));
const sessionsCreate = vi.fn(async (..._args: unknown[]) => ({ url: "https://checkout.stripe.com/c/pay/cs_1" }));

vi.mock("@/lib/billing/stripe-client", () => ({
  getStripeClient: () => ({
    prices: { create: pricesCreate, retrieve: pricesRetrieve },
    products: { update: productsUpdate },
    customers: { create: vi.fn(async () => ({ id: "cus_1" })) },
    checkout: { sessions: { create: sessionsCreate } },
  }),
}));

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
  }),
}));

import { createCheckoutSession, resolveStripePriceId } from "@/lib/billing/checkout";
import type { Customer, Package } from "@/types/database";

const customer = { id: "cust-1", email: "a@b.dk", name: "Kunde", stripe_customer_id: "cus_1" } as Customer;

function pkg(overrides: Partial<Package> = {}): Package {
  return {
    id: `pkg-${Math.random()}`,
    package_name: "Custom",
    monthly_price: 999,
    currency: "DKK",
    included_minutes: 200,
    setup_fee: 999,
    stripe_price_id: null,
    ...overrides,
  } as Package;
}

describe("Stripe product tax codes (Managed Payments)", () => {
  beforeEach(() => {
    delete process.env.STRIPE_PRODUCT_TAX_CODE;
    pricesCreate.mockClear();
    pricesRetrieve.mockReset();
    productsUpdate.mockClear();
    sessionsCreate.mockClear();
  });

  it("creates new Prices on a Product carrying the SaaS tax code", async () => {
    await resolveStripePriceId(pkg());
    expect(pricesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ product_data: { name: "Custom", tax_code: "txcd_10103001" } })
    );
  });

  it("stamps the tax code onto an existing Price's Product that has none", async () => {
    pricesRetrieve.mockResolvedValue({ id: "price_old_1", product: { id: "prod_old", tax_code: null } });
    const id = await resolveStripePriceId(pkg({ stripe_price_id: "price_old_1" }));

    expect(id).toBe("price_old_1");
    expect(productsUpdate).toHaveBeenCalledWith("prod_old", { tax_code: "txcd_10103001" });
  });

  it("leaves a Product alone when it already has a tax code", async () => {
    pricesRetrieve.mockResolvedValue({ id: "price_old_2", product: { id: "prod_ok", tax_code: "txcd_10000000" } });
    await resolveStripePriceId(pkg({ stripe_price_id: "price_old_2" }));
    expect(productsUpdate).not.toHaveBeenCalled();
  });

  it("gives the one-off setup fee line item a tax code too", async () => {
    await createCheckoutSession({ customer, pkg: pkg(), includeSetup: true });
    const params = sessionsCreate.mock.calls[0]![0] as {
      line_items: Array<{ price_data?: { product_data: { tax_code?: string } } }>;
    };
    expect(params.line_items[1]!.price_data!.product_data.tax_code).toBe("txcd_10103001");
  });

  it("uses STRIPE_PRODUCT_TAX_CODE when set", async () => {
    process.env.STRIPE_PRODUCT_TAX_CODE = "txcd_99999999";
    await resolveStripePriceId(pkg());
    expect(pricesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ product_data: expect.objectContaining({ tax_code: "txcd_99999999" }) })
    );
  });
});
