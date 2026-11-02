import { describe, it, expect, afterEach } from "vitest";
import { buildTrialFollowupEmailHtml, trialFollowupSubject } from "@/lib/email/templates/trial-followup";
import { followupWindow, getOnboardingMeetingUrl } from "@/lib/email/trial-followups";
import { requireCronSecret } from "@/lib/security/internal-auth";
import { ApiError } from "@/types/errors";

const BASE = {
  language: "da",
  companyName: "Bagerens <ApS>",
  guideUrl: "https://app.aibooking.dk/dashboard/getting-started",
  meetingUrl: "https://cal.com/aibooking/onboarding",
  billingUrl: "https://app.aibooking.dk/dashboard/billing",
};

describe("trial follow-up email templates", () => {
  it("day1 thanks the customer, points at the step-by-step guide and offers a meeting", () => {
    const html = buildTrialFollowupEmailHtml({ ...BASE, kind: "day1" });
    expect(trialFollowupSubject("day1", "da")).toContain("interesse");
    expect(html).toContain("step-by-step guide");
    expect(html).toContain('href="https://app.aibooking.dk/dashboard/getting-started"');
    expect(html).toContain('href="https://cal.com/aibooking/onboarding"');
    expect(html).toContain("Bagerens &lt;ApS&gt;");
    expect(html).not.toContain("Bagerens <ApS>");
  });

  it("day6 asks how it went and leads with an onboarding meeting", () => {
    const html = buildTrialFollowupEmailHtml({ ...BASE, kind: "day6" });
    expect(trialFollowupSubject("day6", "da")).toContain("oplevelse");
    expect(html).toContain("onboarding-møde");
    expect(html.indexOf("https://cal.com/aibooking/onboarding")).toBeLessThan(
      html.indexOf("https://app.aibooking.dk/dashboard/billing")
    );
  });

  it("is written in the signup language, falling back to Danish", () => {
    expect(trialFollowupSubject("day1", "en")).toContain("Thanks");
    expect(trialFollowupSubject("day6", "de")).toContain("Erfahrung");
    expect(trialFollowupSubject("day1", "xx")).toBe(trialFollowupSubject("day1", "da"));
  });

  it("accepts a mailto: meeting link but drops anything else", () => {
    const mail = buildTrialFollowupEmailHtml({ ...BASE, kind: "day1", meetingUrl: "mailto:mail@aibooking.dk" });
    expect(mail).toContain('href="mailto:mail@aibooking.dk"');
    const bad = buildTrialFollowupEmailHtml({ ...BASE, kind: "day1", meetingUrl: "javascript:alert(1)" });
    expect(bad).not.toContain("javascript:");
  });
});

describe("follow-up timing", () => {
  const now = new Date("2026-11-10T08:00:00Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
  const inWindow = (kind: "day1" | "day6", createdAt: Date) => {
    const { from, to } = followupWindow(kind, now);
    return createdAt > from && createdAt <= to;
  };

  it("day1 goes out from one day after signup, with a short catch-up", () => {
    expect(inWindow("day1", daysAgo(0.5))).toBe(false);
    expect(inWindow("day1", daysAgo(1))).toBe(true);
    expect(inWindow("day1", daysAgo(2.5))).toBe(true);
    expect(inWindow("day1", daysAgo(4))).toBe(false);
  });

  it("day6 goes out on day six — the day before the 7-day trial ends", () => {
    expect(inWindow("day6", daysAgo(5.5))).toBe(false);
    expect(inWindow("day6", daysAgo(6))).toBe(true);
    expect(inWindow("day6", daysAgo(6.9))).toBe(true);
    expect(inWindow("day6", daysAgo(7))).toBe(false);
  });
});

describe("onboarding meeting link", () => {
  const original = process.env.ONBOARDING_MEETING_URL;
  afterEach(() => {
    process.env.ONBOARDING_MEETING_URL = original;
  });

  it("uses the configured booking page", () => {
    process.env.ONBOARDING_MEETING_URL = " https://cal.com/aibooking/onboarding ";
    expect(getOnboardingMeetingUrl()).toBe("https://cal.com/aibooking/onboarding");
  });

  it("falls back to a mail to the platform inbox", () => {
    delete process.env.ONBOARDING_MEETING_URL;
    expect(getOnboardingMeetingUrl()).toMatch(/^mailto:mail@aibooking\.dk\?subject=/);
  });
});

describe("requireCronSecret", () => {
  const original = process.env.CRON_SECRET;
  afterEach(() => {
    process.env.CRON_SECRET = original;
  });
  const req = (headers: Record<string, string>) => new Request("http://localhost/api/internal/trial-followups", { headers });

  it("accepts Vercel Cron's bearer token and the internal header", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(() => requireCronSecret(req({ authorization: "Bearer s3cret" }))).not.toThrow();
    expect(() => requireCronSecret(req({ "x-internal-secret": "s3cret" }))).not.toThrow();
  });

  it("rejects a missing or wrong secret", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(() => requireCronSecret(req({}))).toThrow(ApiError);
    expect(() => requireCronSecret(req({ authorization: "Bearer nope" }))).toThrow(ApiError);
  });
});
