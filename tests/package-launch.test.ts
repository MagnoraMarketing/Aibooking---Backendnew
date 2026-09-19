import { describe, it, expect, afterEach } from "vitest";
import {
  getPackageLaunchKind,
  getPackageLaunchPaymentLink,
  buildPackageLaunchReference,
  parsePackageLaunchReference,
  buildPackageLaunchUrl,
} from "@/lib/billing/package-launch-offer";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const PACKAGE_ID = "22222222-2222-4222-8222-222222222222";

describe("package launch kind", () => {
  it("matches the three paid tiers by name, case-insensitively", () => {
    expect(getPackageLaunchKind("Starter")).toBe("starter");
    expect(getPackageLaunchKind("professional")).toBe("professional");
    expect(getPackageLaunchKind("ENTERPRISE")).toBe("enterprise");
  });

  it("does not match a package outside the three fixed tiers", () => {
    expect(getPackageLaunchKind("Demo")).toBeNull();
    expect(getPackageLaunchKind("AIbooking 999")).toBeNull();
    expect(getPackageLaunchKind("")).toBeNull();
  });
});

describe("package launch reference", () => {
  it("round-trips a customer + package pair", () => {
    const reference = buildPackageLaunchReference({ customerId: CUSTOMER_ID, packageId: PACKAGE_ID });
    expect(parsePackageLaunchReference(reference)).toEqual({ customerId: CUSTOMER_ID, packageId: PACKAGE_ID });
  });

  it("stays inside Stripe's client_reference_id character set and length limit", () => {
    const reference = buildPackageLaunchReference({ customerId: CUSTOMER_ID, packageId: PACKAGE_ID });
    expect(reference).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(reference.length).toBeLessThanOrEqual(200);
  });

  it("rejects a reference that is not ours", () => {
    expect(parsePackageLaunchReference(null)).toBeNull();
    expect(parsePackageLaunchReference("")).toBeNull();
    expect(parsePackageLaunchReference("some-other-checkout")).toBeNull();
  });

  it("rejects a reference missing the package half, unlike the widget reference", () => {
    expect(parsePackageLaunchReference(CUSTOMER_ID)).toBeNull();
    expect(parsePackageLaunchReference(`${CUSTOMER_ID}__not-a-package`)).toBeNull();
  });
});

describe("package launch payment links", () => {
  const ENV_KEYS = [
    "NEXT_PUBLIC_STRIPE_STARTER_PAYMENT_LINK",
    "NEXT_PUBLIC_STRIPE_PROFESSIONAL_PAYMENT_LINK",
    "NEXT_PUBLIC_STRIPE_ENTERPRISE_PAYMENT_LINK",
  ] as const;
  const originalValues = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalValues[key] === undefined) delete process.env[key];
      else process.env[key] = originalValues[key];
    }
  });

  it("falls back to the production Payment Link for each tier when unset", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    expect(getPackageLaunchPaymentLink("starter")).toBe("https://buy.stripe.com/14A00iepJ1xp9AU2AP4AU06");
    expect(getPackageLaunchPaymentLink("professional")).toBe("https://buy.stripe.com/eVq28qdlF5NFcN62AP4AU08");
    expect(getPackageLaunchPaymentLink("enterprise")).toBe("https://buy.stripe.com/eVq28q81lfoffZidft4AU07");
  });

  it("uses a configured (e.g. test-mode) link instead", () => {
    process.env.NEXT_PUBLIC_STRIPE_STARTER_PAYMENT_LINK = "https://buy.stripe.com/test_abc123";
    expect(
      buildPackageLaunchUrl({ kind: "starter", customerId: CUSTOMER_ID, packageId: PACKAGE_ID })
    ).toContain("https://buy.stripe.com/test_abc123");
  });

  it("carries the account, the package and the email onto the Stripe link", () => {
    const url = new URL(
      buildPackageLaunchUrl({ kind: "starter", customerId: CUSTOMER_ID, packageId: PACKAGE_ID, email: "a@b.dk" })
    );
    expect(url.searchParams.get("client_reference_id")).toBe(`${CUSTOMER_ID}__${PACKAGE_ID}`);
    expect(url.searchParams.get("prefilled_email")).toBe("a@b.dk");
  });

  it("omits prefilled_email when there is none", () => {
    const url = new URL(buildPackageLaunchUrl({ kind: "starter", customerId: CUSTOMER_ID, packageId: PACKAGE_ID }));
    expect(url.searchParams.has("prefilled_email")).toBe(false);
  });
});
