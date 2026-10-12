import { describe, it, expect, afterEach } from "vitest";
import {
  WIDGET_LAUNCH_MINUTES,
  WIDGET_LAUNCH_SECONDS,
  buildWidgetLaunchReference,
  buildWidgetLaunchUrl,
  getWidgetLaunchPaymentLink,
  parseWidgetLaunchReference,
} from "@/lib/billing/widget-launch-offer";
import { hasEmbedCodeAccess, TRIAL_DAYS } from "@/lib/billing/trial";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const WIDGET_ID = "22222222-2222-4222-8222-222222222222";

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("widget launch offer reference", () => {
  it("round-trips a customer + widget pair", () => {
    const reference = buildWidgetLaunchReference({ customerId: CUSTOMER_ID, widgetId: WIDGET_ID });
    expect(parseWidgetLaunchReference(reference)).toEqual({ customerId: CUSTOMER_ID, widgetId: WIDGET_ID });
  });

  it("round-trips a customer on its own", () => {
    const reference = buildWidgetLaunchReference({ customerId: CUSTOMER_ID, widgetId: null });
    expect(parseWidgetLaunchReference(reference)).toEqual({ customerId: CUSTOMER_ID, widgetId: null });
  });

  it("stays inside Stripe's client_reference_id character set and length limit", () => {
    const reference = buildWidgetLaunchReference({ customerId: CUSTOMER_ID, widgetId: WIDGET_ID });
    expect(reference).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(reference.length).toBeLessThanOrEqual(200);
  });

  it("rejects a reference that is not ours", () => {
    expect(parseWidgetLaunchReference(null)).toBeNull();
    expect(parseWidgetLaunchReference("")).toBeNull();
    expect(parseWidgetLaunchReference("some-other-checkout")).toBeNull();
  });

  it("keeps the customer when the widget half is unusable, rather than dropping the payment", () => {
    expect(parseWidgetLaunchReference(`${CUSTOMER_ID}__not-a-widget`)).toEqual({
      customerId: CUSTOMER_ID,
      widgetId: null,
    });
  });
});

describe("widget launch payment link", () => {
  const originalLink = process.env.NEXT_PUBLIC_STRIPE_WIDGET_PAYMENT_LINK;

  afterEach(() => {
    if (originalLink === undefined) delete process.env.NEXT_PUBLIC_STRIPE_WIDGET_PAYMENT_LINK;
    else process.env.NEXT_PUBLIC_STRIPE_WIDGET_PAYMENT_LINK = originalLink;
  });

  it("falls back to the production Payment Link when unset", () => {
    delete process.env.NEXT_PUBLIC_STRIPE_WIDGET_PAYMENT_LINK;
    expect(getWidgetLaunchPaymentLink()).toBe("https://buy.stripe.com/cNi6oGa9t6RJ8wQgrF4AU0a");
  });

  it("uses a configured (e.g. test-mode) link instead", () => {
    process.env.NEXT_PUBLIC_STRIPE_WIDGET_PAYMENT_LINK = "https://buy.stripe.com/test_abc123";
    expect(buildWidgetLaunchUrl({ customerId: CUSTOMER_ID, widgetId: null })).toContain(
      "https://buy.stripe.com/test_abc123"
    );
  });

  it("carries the account, the widget and the email onto the Stripe link", () => {
    const url = new URL(buildWidgetLaunchUrl({ customerId: CUSTOMER_ID, widgetId: WIDGET_ID, email: "a@b.dk" }));
    expect(url.searchParams.get("client_reference_id")).toBe(`${CUSTOMER_ID}__${WIDGET_ID}`);
    expect(url.searchParams.get("prefilled_email")).toBe("a@b.dk");
  });

  it("omits prefilled_email when there is none", () => {
    const url = new URL(buildWidgetLaunchUrl({ customerId: CUSTOMER_ID, widgetId: WIDGET_ID, email: null }));
    expect(url.searchParams.has("prefilled_email")).toBe(false);
  });

  it("buys 150 minutes, expressed in seconds for the ledger", () => {
    expect(WIDGET_LAUNCH_MINUTES).toBe(150);
    expect(WIDGET_LAUNCH_SECONDS).toBe(150 * 60);
  });
});

describe("hasEmbedCodeAccess with a paid launch offer", () => {
  it("keeps the embed code unlocked after the trial, with no subscription", () => {
    expect(
      hasEmbedCodeAccess({
        customerCreatedAt: daysAgo(TRIAL_DAYS + 30),
        subscriptionStatus: null,
        balanceSeconds: 0,
        widgetLaunchPaidAt: daysAgo(10),
      })
    ).toBe(true);
  });

  it("still locks the embed code for a customer who never paid", () => {
    expect(
      hasEmbedCodeAccess({
        customerCreatedAt: daysAgo(TRIAL_DAYS + 30),
        subscriptionStatus: null,
        balanceSeconds: 0,
        widgetLaunchPaidAt: null,
      })
    ).toBe(false);
  });
});
