import "server-only";
import { sendEmail, PLATFORM_NOTIFICATION_TO } from "./client";
import { buildInternalNotificationEmailHtml, type InternalNotificationRow } from "./templates/internal-notification";
import { getAdminClient } from "@/lib/database/admin";

// The confirmation every booking the AI makes sends to both sides: the
// caller who booked, and the business they booked with. Each mail carries a
// calendar invitation (.ics), so the meeting lands in either calendar with
// one click whatever calendar the business has connected.
//
// The calendar provider's own invitation is not enough on its own: Google
// and Outlook never mail the calendar's owner about a new event, and none
// of them mail the caller when the caller's address is the owner's own.
//
// Best-effort by design and never throws: the booking already exists when
// this runs, and the agent must still be able to confirm it if Resend is
// down. Failures are logged and swallowed.

// Cal.com bookings don't return the event length here; half an hour is the
// usual meeting length and only shapes the invitation's end time.
export const DEFAULT_BOOKING_MINUTES = 30;

export interface BookingEmailParams {
  customerId: string;
  widgetId: string;
  startTime: string; // ISO 8601 with offset
  durationMinutes?: number;
  timezone: string;
  customerName: string;
  customerEmail: string;
}

type Lang = "da" | "en";

const TEXT: Record<
  Lang,
  {
    subject: (business: string, when: string) => string;
    heading: string;
    intro: (name: string, business: string) => string;
    when: string;
    with: string;
    name: string;
    email: string;
    footer: string;
  }
> = {
  da: {
    subject: (business, when) => `Bekræftelse: møde med ${business} ${when}`,
    heading: "Din booking er bekræftet",
    intro: (name, business) =>
      `Hej ${name}. Tak for din booking hos ${business}. Mødeindkaldelsen er vedhæftet, så du kan lægge mødet i din kalender.`,
    when: "Tidspunkt",
    with: "Hos",
    name: "Navn",
    email: "E-mail",
    footer: "Skal tiden ændres eller aflyses, kan du svare på denne mail.",
  },
  en: {
    subject: (business, when) => `Confirmed: meeting with ${business}, ${when}`,
    heading: "Your booking is confirmed",
    intro: (name, business) =>
      `Hi ${name}. Thank you for booking with ${business}. The meeting invitation is attached so you can add it to your calendar.`,
    when: "Time",
    with: "With",
    name: "Name",
    email: "Email",
    footer: "To change or cancel the time, just reply to this email.",
  },
};

export function formatBookingTime(startTime: string, timezone: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "da" ? "da-DK" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(startTime));
}

function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// RFC 5545 text escaping, and lines folded at 75 octets.
function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function foldLine(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, "utf8") > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut), "utf8") > 75) cut -= 1;
    parts.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  parts.push(rest);
  return parts.join("\r\n");
}

export function buildBookingInvite(params: {
  uid: string;
  start: Date;
  durationMinutes: number;
  summary: string;
  description: string;
  organizerName: string;
  organizerEmail: string;
  attendeeName: string;
  attendeeEmail: string;
  now?: Date;
}): string {
  const end = new Date(params.start.getTime() + params.durationMinutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AIbooking.dk//Booking//DA",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${params.uid}`,
    `DTSTAMP:${icsDate(params.now ?? new Date())}`,
    `DTSTART:${icsDate(params.start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(params.summary)}`,
    `DESCRIPTION:${icsText(params.description)}`,
    `ORGANIZER;CN=${icsText(params.organizerName)}:mailto:${params.organizerEmail}`,
    `ATTENDEE;CN=${icsText(params.attendeeName)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${params.attendeeEmail}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(params.summary)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// AIbooking's own website widgets belong to a reserved internal account
// whose stored address is not a real inbox; their bookings go to the
// platform inbox instead.
export function businessRecipient(customer: { email: string; is_platform_owned?: boolean | null }): string {
  return customer.is_platform_owned ? PLATFORM_NOTIFICATION_TO : customer.email;
}

export async function sendBookingConfirmationEmails(params: BookingEmailParams): Promise<void> {
  try {
    const supabase = getAdminClient();
    const [{ data: customer }, { data: widget }] = await Promise.all([
      supabase.from("customers").select("name, email, is_platform_owned").eq("id", params.customerId).maybeSingle(),
      supabase.from("widgets").select("name, business_name, language").eq("id", params.widgetId).maybeSingle(),
    ]);
    if (!customer?.email) {
      console.error("Booking confirmation skipped: no business email for customer", params.customerId);
      return;
    }

    const businessEmail = businessRecipient(customer);
    const businessName = widget?.business_name || customer.name || "AIbooking.dk";
    const lang: Lang = !widget?.language || widget.language === "da" ? "da" : "en";
    const text = TEXT[lang];
    const start = new Date(params.startTime);
    const durationMinutes = params.durationMinutes ?? DEFAULT_BOOKING_MINUTES;
    const whenCustomer = formatBookingTime(params.startTime, params.timezone, lang);
    const whenBusiness = formatBookingTime(params.startTime, params.timezone, "da");

    const invite = buildBookingInvite({
      uid: `${params.widgetId}-${start.getTime()}@aibooking.dk`,
      start,
      durationMinutes,
      summary: `${businessName} – ${params.customerName}`,
      description: `${text.name}: ${params.customerName}\n${text.email}: ${params.customerEmail}`,
      organizerName: businessName,
      organizerEmail: businessEmail,
      attendeeName: params.customerName,
      attendeeEmail: params.customerEmail,
    });
    const attachments = [
      {
        filename: "invite.ics",
        content: Buffer.from(invite, "utf8").toString("base64"),
        contentType: "text/calendar; charset=utf-8; method=REQUEST",
      },
    ];

    const sends: Promise<void>[] = [
      sendEmail({
        to: businessEmail,
        subject: `Ny booking: ${params.customerName}, ${whenBusiness}`,
        html: buildInternalNotificationEmailHtml({
          heading: "Ny booking via din AI-agent",
          intro: `Din AI-agent${widget?.name ? ` "${widget.name}"` : ""} har booket et møde. Mødeindkaldelsen er vedhæftet.`,
          rows: [
            { label: "Tidspunkt", value: whenBusiness },
            { label: "Varighed", value: `${durationMinutes} min.` },
            { label: "Kunde", value: params.customerName },
            { label: "E-mail", value: params.customerEmail, href: `mailto:${params.customerEmail}` },
          ],
          footerNote: "Svar på denne mail for at skrive direkte til kunden.",
        }),
        replyTo: params.customerEmail,
        attachments,
      }),
    ];

    // One mail is enough when the caller booked with the business's own
    // address (a test booking, typically).
    if (params.customerEmail.toLowerCase() !== businessEmail.toLowerCase()) {
      const rows: InternalNotificationRow[] = [
        { label: text.when, value: whenCustomer },
        { label: text.with, value: businessName },
        { label: text.name, value: params.customerName },
      ];
      sends.push(
        sendEmail({
          to: params.customerEmail,
          subject: text.subject(businessName, whenCustomer),
          html: buildInternalNotificationEmailHtml({
            heading: text.heading,
            intro: text.intro(params.customerName, businessName),
            rows,
            footerNote: text.footer,
          }),
          replyTo: businessEmail,
          attachments,
        })
      );
    }

    const results = await Promise.allSettled(sends);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error(
          "Failed to send booking confirmation email:",
          result.reason instanceof Error ? result.reason.message : result.reason
        );
      }
    }
  } catch (err) {
    console.error("Failed to send booking confirmation emails:", err instanceof Error ? err.message : err);
  }
}
