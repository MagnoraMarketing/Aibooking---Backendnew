import "server-only";
import { sendEmail, PLATFORM_NOTIFICATION_TO } from "./client";
import { buildInternalNotificationEmailHtml, type InternalNotificationRow } from "./templates/internal-notification";
import type { Customer } from "@/types/database";

// Notifications to the platform's own inbox, not to customers: someone
// signed up, someone paid. They exist so a human can pick up the phone and
// welcome a new customer while it still feels immediate, which is why the
// customer's phone number and email are the first two rows of every one of
// them, rendered as tel:/mailto: links.
//
// Every function here is best-effort by design and never throws: a signup
// must not fail because Resend is down, and a Stripe webhook that 500s
// because of an email would be retried — re-running the credit grant behind
// it — for no reason. Failures are logged and swallowed.

function formatDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("da-DK", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Copenhagen",
  }).format(date);
}

function contactRows(customer: Pick<Customer, "name" | "email" | "phone">): InternalNotificationRow[] {
  return [
    { label: "Virksomhed", value: customer.name },
    { label: "Email", value: customer.email, href: `mailto:${customer.email}` },
    customer.phone
      ? { label: "Telefon", value: customer.phone, href: `tel:${customer.phone.replace(/[^\d+]/g, "")}` }
      : { label: "Telefon", value: "Ikke oplyst" },
  ];
}

async function sendNotification(params: {
  subject: string;
  heading: string;
  intro: string;
  rows: InternalNotificationRow[];
  accentColor?: string;
  footerNote?: string;
  replyTo?: string;
}): Promise<void> {
  try {
    await sendEmail({
      to: PLATFORM_NOTIFICATION_TO,
      subject: params.subject,
      html: buildInternalNotificationEmailHtml({
        heading: params.heading,
        intro: params.intro,
        rows: params.rows,
        accentColor: params.accentColor,
        footerNote: params.footerNote,
      }),
      // Replying to the notification writes to the customer, which is the
      // obvious next action when there's no phone number to ring.
      replyTo: params.replyTo,
    });
  } catch (err) {
    console.error("Failed to send internal notification email:", err instanceof Error ? err.message : err);
  }
}

export async function notifyNewCustomerSignup(params: {
  customer: Pick<Customer, "name" | "email" | "phone" | "created_at">;
  language: string;
}): Promise<void> {
  await sendNotification({
    subject: `Ny kunde oprettet: ${params.customer.name}`,
    heading: "Ny kunde oprettet 🎉",
    intro: `${params.customer.name} har lige oprettet sig på AIbooking.dk. Ring og byd velkommen.`,
    rows: [
      ...contactRows(params.customer),
      { label: "Sprog", value: params.language },
      { label: "Oprettet", value: formatDateTime(params.customer.created_at) },
      { label: "Kilde", value: "Selvbetjening (/signup)" },
    ],
    replyTo: params.customer.email,
  });
}

export async function notifyCustomerPayment(params: {
  customer: Pick<Customer, "name" | "email" | "phone">;
  // What was bought, in plain Danish — e.g. "Voice Widget start: 200 minutter"
  // or a package name. Goes in the subject as well as the body.
  productLabel: string;
  // Preformatted, because the amount comes from Stripe in whatever currency
  // and precision the price was set in — never re-derived here.
  amountLabel?: string;
  // "Første betaling" reads very differently from a monthly renewal when the
  // point is deciding whether to ring, so it's in the subject.
  isFirstPayment: boolean;
  minutesGranted?: number;
}): Promise<void> {
  const kind = params.isFirstPayment ? "Første betaling" : "Betaling";
  const rows: InternalNotificationRow[] = [
    ...contactRows(params.customer),
    { label: "Betaling for", value: params.productLabel },
  ];
  if (params.amountLabel) rows.push({ label: "Beløb", value: params.amountLabel });
  if (params.minutesGranted) rows.push({ label: "Minutter tilføjet", value: `${params.minutesGranted}` });
  rows.push({ label: "Tidspunkt", value: formatDateTime(new Date()) });

  await sendNotification({
    subject: `${kind}: ${params.customer.name} — ${params.productLabel}`,
    heading: params.isFirstPayment ? "Ny betalende kunde 💰" : "Betaling modtaget",
    intro: params.isFirstPayment
      ? `${params.customer.name} har netop betalt for første gang. Ring og byd velkommen om bord.`
      : `${params.customer.name} har netop betalt.`,
    rows,
    accentColor: "#059669",
    replyTo: params.customer.email,
  });
}
