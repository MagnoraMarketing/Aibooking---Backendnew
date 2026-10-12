import { describe, it, expect, vi, beforeEach } from "vitest";

const sendEmailMock = vi.fn(async (..._args: unknown[]) => {});

vi.mock("@/lib/email/client", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  PLATFORM_NOTIFICATION_TO: "mail@aibooking.dk",
}));

import { notifyNewCustomerSignup, notifyCustomerPayment } from "@/lib/email/internal-notifications";

const CUSTOMER = {
  name: "Bagerens ApS",
  email: "kontakt@bageren.dk",
  phone: "+45 12 34 56 78",
  created_at: "2026-09-10T09:30:00.000Z",
};

function lastEmail(): { to: string; subject: string; html: string; replyTo?: string } {
  return sendEmailMock.mock.calls.at(-1)![0] as { to: string; subject: string; html: string; replyTo?: string };
}

describe("new signup notification", () => {
  beforeEach(() => sendEmailMock.mockClear());

  it("goes to the platform inbox with the company in the subject", async () => {
    await notifyNewCustomerSignup({ customer: CUSTOMER, language: "da" });

    const email = lastEmail();
    expect(email.to).toBe("mail@aibooking.dk");
    expect(email.subject).toContain("Bagerens ApS");
    expect(email.replyTo).toBe("kontakt@bageren.dk");
  });

  it("makes the phone number dialable and the email answerable", async () => {
    await notifyNewCustomerSignup({ customer: CUSTOMER, language: "da" });

    const { html } = lastEmail();
    expect(html).toContain('href="tel:+4512345678"');
    expect(html).toContain('href="mailto:kontakt@bageren.dk"');
  });

  it("says so plainly when no phone number was given", async () => {
    await notifyNewCustomerSignup({ customer: { ...CUSTOMER, phone: null }, language: "da" });

    const { html } = lastEmail();
    expect(html).toContain("Ikke oplyst");
    expect(html).not.toContain('href="tel:');
  });

  it("never lets a mail failure escape into the signup request", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("Resend afviste anmodningen (500)"));

    await expect(notifyNewCustomerSignup({ customer: CUSTOMER, language: "da" })).resolves.toBeUndefined();
  });

  it("escapes a company name that would otherwise break the markup", async () => {
    await notifyNewCustomerSignup({
      customer: { ...CUSTOMER, name: '<script>alert("x")</script>' },
      language: "da",
    });

    const { html } = lastEmail();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("payment notification", () => {
  beforeEach(() => sendEmailMock.mockClear());

  it("marks a first payment as the one worth ringing about", async () => {
    await notifyCustomerPayment({
      customer: CUSTOMER,
      productLabel: "Voice Widget start: 200 minutter",
      isFirstPayment: true,
      minutesGranted: 200,
    });

    const email = lastEmail();
    expect(email.subject).toContain("Første betaling");
    expect(email.subject).toContain("Voice Widget start: 200 minutter");
    expect(email.html).toContain("Ny betalende kunde");
  });

  it("labels a renewal differently so the inbox stays skimmable", async () => {
    await notifyCustomerPayment({
      customer: CUSTOMER,
      productLabel: "Standard",
      amountLabel: "999,00 kr.",
      isFirstPayment: false,
    });

    const email = lastEmail();
    expect(email.subject).toContain("Betaling:");
    expect(email.subject).not.toContain("Første betaling");
    expect(email.html).toContain("999,00 kr.");
  });

  it("never lets a mail failure escape into the Stripe webhook", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("Resend afviste anmodningen (500)"));

    await expect(
      notifyCustomerPayment({ customer: CUSTOMER, productLabel: "Standard", isFirstPayment: false })
    ).resolves.toBeUndefined();
  });
});
