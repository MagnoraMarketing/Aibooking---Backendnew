import { describe, it, expect } from "vitest";
import { hasEmbedCodeAccess, TRIAL_DAYS, TRIAL_SECONDS } from "@/lib/billing/trial";

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("hasEmbedCodeAccess (5-minute / 7-day trial)", () => {
  it("grants access within the trial window while trial minutes remain", () => {
    expect(
      hasEmbedCodeAccess({
        customerCreatedAt: daysAgo(1),
        subscriptionStatus: null,
        balanceSeconds: TRIAL_SECONDS,
      })
    ).toBe(true);
  });

  it("denies access once trial minutes are used up, even within the 7 days", () => {
    expect(
      hasEmbedCodeAccess({
        customerCreatedAt: daysAgo(1),
        subscriptionStatus: null,
        balanceSeconds: 0,
      })
    ).toBe(false);
  });

  it("denies access once the 7 days pass, even with trial minutes left", () => {
    expect(
      hasEmbedCodeAccess({
        customerCreatedAt: daysAgo(TRIAL_DAYS + 1),
        subscriptionStatus: "incomplete",
        balanceSeconds: TRIAL_SECONDS,
      })
    ).toBe(false);
  });

  it("grants access with an active subscription regardless of trial state or balance", () => {
    expect(
      hasEmbedCodeAccess({
        customerCreatedAt: daysAgo(TRIAL_DAYS + 30),
        subscriptionStatus: "active",
        balanceSeconds: 0,
      })
    ).toBe(true);
  });

  it("grants access with a Stripe-side trialing subscription", () => {
    expect(
      hasEmbedCodeAccess({
        customerCreatedAt: daysAgo(TRIAL_DAYS + 30),
        subscriptionStatus: "trialing",
        balanceSeconds: 0,
      })
    ).toBe(true);
  });

  it("does not grant access from a leftover balance alone once outside the trial and without an active subscription", () => {
    expect(
      hasEmbedCodeAccess({
        customerCreatedAt: daysAgo(TRIAL_DAYS + 1),
        subscriptionStatus: "past_due",
        balanceSeconds: 500,
      })
    ).toBe(false);
  });
});
