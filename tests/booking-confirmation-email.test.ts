import { describe, it, expect, vi, beforeEach } from "vitest";

const sendEmail = vi.fn();
vi.mock("@/lib/email/client", () => ({
  PLATFORM_NOTIFICATION_TO: "mail@aibooking.dk",
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

let customerRow: Record<string, unknown> | null;
let widgetRow: Record<string, unknown> | null;
vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: table === "customers" ? customerRow : widgetRow }),
        }),
      }),
    }),
  }),
}));

import {
  buildBookingInvite,
  businessRecipient,
  sendBookingConfirmationEmails,
} from "@/lib/email/booking-confirmation";

const booking = {
  customerId: "cust-1",
  widgetId: "widget-1",
  startTime: "2026-11-10T10:45:00+01:00",
  timezone: "Europe/Copenhagen",
  customerName: "Mette Kjær",
  customerEmail: "mette@example.com",
};

function decodedInvite(call: unknown[]): string {
  const params = call[0] as { attachments: { content: string }[] };
  // Unfold RFC 5545 continuation lines before matching.
  return Buffer.from(params.attachments[0]!.content, "base64").toString("utf8").replace(/\r\n /g, "");
}

describe("booking confirmation emails", () => {
  beforeEach(() => {
    sendEmail.mockReset().mockResolvedValue(undefined);
    customerRow = { name: "Frisørstuen ApS", email: "ejer@frisorstuen.dk", is_platform_owned: false };
    widgetRow = { name: "Hjemmeside-widget", business_name: "Frisørstuen", language: "da" };
  });

  it("mails both the business and the caller, each with a calendar invitation", async () => {
    await sendBookingConfirmationEmails(booking);

    expect(sendEmail).toHaveBeenCalledTimes(2);
    const business = sendEmail.mock.calls[0]!;
    const caller = sendEmail.mock.calls[1]!;
    expect((business[0] as { to: string }).to).toBe("ejer@frisorstuen.dk");
    expect((business[0] as { replyTo: string }).replyTo).toBe("mette@example.com");
    expect((caller[0] as { to: string }).to).toBe("mette@example.com");
    expect((caller[0] as { replyTo: string }).replyTo).toBe("ejer@frisorstuen.dk");
    expect((caller[0] as { subject: string }).subject).toContain("Frisørstuen");

    const invite = decodedInvite(caller);
    expect(invite).toContain("METHOD:REQUEST");
    expect(invite).toContain("DTSTART:20261110T094500Z");
    expect(invite).toContain("DTEND:20261110T101500Z");
    expect(invite).toContain("mailto:ejer@frisorstuen.dk");
    expect(invite).toContain("mailto:mette@example.com");
  });

  it("sends AIbooking's own website bookings to the platform inbox", async () => {
    customerRow = { name: "AIbooking.dk (egen widget)", email: "internal-aibooking-website@aibooking.dk", is_platform_owned: true };
    await sendBookingConfirmationEmails(booking);
    expect((sendEmail.mock.calls[0]![0] as { to: string }).to).toBe("mail@aibooking.dk");
    expect(businessRecipient({ email: "x@y.dk", is_platform_owned: true })).toBe("mail@aibooking.dk");
  });

  it("sends a single mail when the caller booked with the business's own address", async () => {
    await sendBookingConfirmationEmails({ ...booking, customerEmail: "EJER@frisorstuen.dk" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("never throws when sending fails", async () => {
    sendEmail.mockRejectedValue(new Error("Resend down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendBookingConfirmationEmails(booking)).resolves.toBeUndefined();
    errors.mockRestore();
  });

  it("uses the agent's duration and English for non-Danish agents", async () => {
    widgetRow = { name: "Widget", business_name: null, language: "en" };
    await sendBookingConfirmationEmails({ ...booking, durationMinutes: 60 });
    const caller = sendEmail.mock.calls[1]![0] as { subject: string };
    expect(caller.subject).toMatch(/^Confirmed: meeting with Frisørstuen ApS/);
    expect(decodedInvite(sendEmail.mock.calls[1] as unknown[])).toContain("DTEND:20261110T104500Z");
  });

  it("folds long invitation lines at 75 octets", () => {
    const invite = buildBookingInvite({
      uid: "u@aibooking.dk",
      start: new Date("2026-11-10T09:45:00Z"),
      durationMinutes: 30,
      summary: "Æ".repeat(80),
      description: "d",
      organizerName: "O",
      organizerEmail: "o@x.dk",
      attendeeName: "A",
      attendeeEmail: "a@x.dk",
    });
    for (const line of invite.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
  });
});
