import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.NEXT_PUBLIC_APP_URL = "https://app.aibooking.dk";

const sendEmailMock = vi.fn(async (..._args: unknown[]) => {});

vi.mock("@/lib/email/client", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  PLATFORM_NOTIFICATION_TO: "mail@aibooking.dk",
}));

import { sendCustomerWelcomeEmail } from "@/lib/email/welcome";

const PARAMS = {
  email: "kontakt@bageren.dk",
  companyName: "Bagerens ApS",
  language: "da",
  widget: { id: "widget-uuid", public_id: "pub_abc123" },
  trialMinutes: 10,
};

function lastEmail(): { to: string; subject: string; html: string; replyTo?: string } {
  return sendEmailMock.mock.calls.at(-1)![0] as { to: string; subject: string; html: string; replyTo?: string };
}

describe("customer welcome email", () => {
  beforeEach(() => sendEmailMock.mockClear());

  it("goes to the customer, with replies landing in the platform inbox", async () => {
    await sendCustomerWelcomeEmail(PARAMS);

    const email = lastEmail();
    expect(email.to).toBe("kontakt@bageren.dk");
    expect(email.subject).toContain("Velkommen");
    expect(email.replyTo).toBe("mail@aibooking.dk");
  });

  it("includes the embed code for the customer's first agent, escaped", async () => {
    await sendCustomerWelcomeEmail(PARAMS);

    const { html } = lastEmail();
    expect(html).toContain(
      "&lt;script src=&quot;https://app.aibooking.dk/widget.js&quot; data-widget-id=&quot;pub_abc123&quot;&gt;&lt;/script&gt;"
    );
    expect(html).toContain('href="https://app.aibooking.dk/dashboard/agent/widget-uuid"');
    expect(html).toContain("10 gratis minutter");
  });

  it("leaves the embed code out when there is no free trial to unlock it", async () => {
    await sendCustomerWelcomeEmail({ ...PARAMS, trialMinutes: 0 });

    const { html } = lastEmail();
    expect(html).not.toContain("pub_abc123");
    expect(html).toContain("Indlejringskode");
  });

  it("is written in the language picked on signup", async () => {
    await sendCustomerWelcomeEmail({ ...PARAMS, language: "de" });

    const email = lastEmail();
    expect(email.subject).toContain("Willkommen");
    expect(email.html).toContain('<html lang="de">');
    expect(email.html).toContain("Zu Ihrem Agenten");
    expect(email.html).toContain("10 kostenlose Minuten");
    expect(email.html).not.toContain("Gå til din agent");
  });

  it.each(["da", "en", "es", "fr", "pt", "de"])("renders the embed code and agent link in %s", async (language) => {
    await sendCustomerWelcomeEmail({ ...PARAMS, language });

    const { html } = lastEmail();
    expect(html).toContain(`<html lang="${language}">`);
    expect(html).toContain("data-widget-id=&quot;pub_abc123&quot;");
    expect(html).toContain('href="https://app.aibooking.dk/dashboard/agent/widget-uuid"');
    expect(html).toContain('<a href="mailto:mail@aibooking.dk"');
    expect(html).toContain("&lt;/body&gt;</code>");
  });

  it("falls back to Danish for an unknown language", async () => {
    await sendCustomerWelcomeEmail({ ...PARAMS, language: "xx" });

    const email = lastEmail();
    expect(email.subject).toContain("Velkommen");
    expect(email.html).toContain('<html lang="da">');
  });

  it("escapes a company name that would otherwise break the markup", async () => {
    await sendCustomerWelcomeEmail({ ...PARAMS, companyName: "<b>x</b>" });

    expect(lastEmail().html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("never lets a mail failure escape into the signup request", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("Resend afviste anmodningen (500)"));

    await expect(sendCustomerWelcomeEmail(PARAMS)).resolves.toBeUndefined();
  });
});
