import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import {
  bookingFailureAdvice,
  checkBookingDetails,
  type BookingDetailsInput,
  fetchCalcomAvailability,
  createCalcomBooking,
  fetchGoogleFreeBusy,
  createGoogleBooking,
  fetchOutlookFreeBusy,
  createOutlookBooking,
  generateBusinessHourSlots,
} from "@/lib/calendar";
import { getAdminClient } from "@/lib/database/admin";

// The two calendar functions the AI may call during a live conversation —
// check_availability and book_meeting — so it can complete a booking end to end
// (AI -> backend -> Cal.com -> availability -> lead picks a time -> Cal.com
// -> booking created -> booking id -> Supabase appointments row -> AI
// confirms), rather than just describing how to book. Anthropic-only: it's
// the only LLMProvider implementation, and the generic interface
// (lib/llm/types.ts) is text-in/text-out on purpose — tool-use is a
// capability of this one provider, not something every future provider
// would need, so it's kept out of that abstraction and called directly here.
//
// The tool-use loop that runs these lives in ./tool-loop.ts, which it shares
// with the Shopify tools: an agent that can both book a time and check an
// order needs one conversation, not two.
export const CALENDAR_TOOLS: Anthropic.Tool[] = [
  {
    name: "check_availability",
    description:
      "Tjek ledige mødetider i kalenderen. Brug altid denne, før du foreslår eller bekræfter en tid til kunden.",
    input_schema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Dato i format YYYY-MM-DD kunden er interesseret i. Udelad for at se de næste ledige tider fra i dag.",
        },
      },
    },
  },
  {
    name: "book_meeting",
    description:
      "Book et møde på en specifik tid. Brug kun en starttid der lige er blevet bekræftet ledig via check_availability, og kun efter kunden har sagt god for tidspunktet.",
    input_schema: {
      type: "object",
      properties: {
        start_time: {
          type: "string",
          description: "Starttidspunkt i ISO 8601 med tidszone, fx 2026-03-15T14:00:00+01:00 — skal være en af de tider check_availability lige returnerede.",
        },
        customer_name: { type: "string", description: "Kundens fulde navn, som kunden selv har oplyst det." },
        customer_email: {
          type: "string",
          description:
            "Kundens e-mailadresse, som bekræftelsen sendes til. Gentag adressen for kunden og få den bekræftet, før du booker.",
        },
        email_confirmed: {
          type: "boolean",
          description:
            "true, når du har gentaget e-mailadressen for kunden og kunden har sagt, at den er korrekt. Bookingen afvises ellers.",
        },
      },
      required: ["start_time", "customer_name", "customer_email", "email_confirmed"],
    },
  },
];

interface CalcomToolContext {
  provider: "calcom";
  apiKey: string;
  eventTypeId: number;
  timezone: string;
  customerId: string;
  widgetId: string;
  conversationId: string;
}

interface OAuthToolContext {
  provider: "google" | "outlook";
  accessToken: string;
  calendarId: string;
  scheduleEmail: string | null;
  durationMinutes: number;
  timezone: string;
  customerId: string;
  widgetId: string;
  conversationId: string;
}

// Cal.com (event types, its own timezone) or Google/Outlook (a fixed
// duration, fixed to Europe/Copenhagen — see lib/vapi/booking-tools.ts's
// module comment for why). Built by resolveCalendarToolContext in
// handle-turn.ts, which tries calcom first, then google, then outlook.
export type CalendarToolContext = CalcomToolContext | OAuthToolContext;

const AVAILABILITY_WINDOW_DAYS = 7;

export async function executeCalendarTool(name: string, rawInput: unknown, ctx: CalendarToolContext): Promise<string> {
  if (name === "check_availability") {
    return executeCheckAvailability(rawInput as { date?: string }, ctx);
  }
  if (name === "book_meeting") {
    return executeBookMeeting(rawInput as BookingDetailsInput, ctx);
  }
  return "Ukendt funktion.";
}

async function executeCheckAvailability(input: { date?: string }, ctx: CalendarToolContext): Promise<string> {
  const startTime = input.date ? `${input.date}T00:00:00.000Z` : new Date().toISOString();
  const start = new Date(startTime);
  const end = new Date(start.getTime() + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  try {
    let times: string[];

    if (ctx.provider === "calcom") {
      const slots = await fetchCalcomAvailability({
        apiKey: ctx.apiKey,
        eventTypeId: ctx.eventTypeId,
        startTime,
        endTime: end.toISOString(),
        timezone: ctx.timezone,
      });
      times = slots.slice(0, 8).map((slot) => slot.time);
    } else {
      // Google/Outlook have no event types: free/busy for the window, cut
      // into slots of the connection's meeting length within business hours.
      const busy =
        ctx.provider === "google"
          ? await fetchGoogleFreeBusy({
              accessToken: ctx.accessToken,
              calendarId: ctx.calendarId,
              startTime,
              endTime: end.toISOString(),
            })
          : await fetchOutlookFreeBusy({
              accessToken: ctx.accessToken,
              scheduleEmail: ctx.scheduleEmail!,
              startTime,
              endTime: end.toISOString(),
            });

      times = generateBusinessHourSlots({
        windowStart: start,
        windowEnd: end,
        timezone: ctx.timezone,
        durationMinutes: ctx.durationMinutes,
        busy,
        maxSlots: 8,
      });
    }

    if (times.length === 0) return "Ingen ledige tider fundet i den periode. Prøv en anden dato.";
    return `Ledige tider (${ctx.timezone}): ${times.join(", ")}`;
  } catch (err) {
    return `Kunne ikke hente ledige tider lige nu: ${err instanceof Error ? err.message : "ukendt fejl"}`;
  }
}

async function executeBookMeeting(input: BookingDetailsInput, ctx: CalendarToolContext): Promise<string> {
  const details = checkBookingDetails(input);
  if (!details.ok) return details.advice;
  const { startTime, customerName, customerEmail } = details;

  const supabase = getAdminClient();

  try {
    if (ctx.provider === "calcom") {
      const booking = await createCalcomBooking({
        apiKey: ctx.apiKey,
        eventTypeId: ctx.eventTypeId,
        start: startTime,
        timezone: ctx.timezone,
        name: customerName,
        email: customerEmail,
      });

      await supabase.from("appointments").insert({
        customer_id: ctx.customerId,
        widget_id: ctx.widgetId,
        conversation_id: ctx.conversationId,
        customer_name: customerName,
        appointment_time: startTime,
        status: "booked",
      });

      return `Møde booket. Bekræftelses-id: ${booking.uid}. Tidspunkt: ${startTime} (${ctx.timezone}).`;
    }

    const booking =
      ctx.provider === "google"
        ? await createGoogleBooking({
            accessToken: ctx.accessToken,
            calendarId: ctx.calendarId,
            widgetId: ctx.widgetId,
            start: startTime,
            durationMinutes: ctx.durationMinutes,
            timezone: ctx.timezone,
            name: customerName,
            email: customerEmail,
          })
        : await createOutlookBooking({
            accessToken: ctx.accessToken,
            widgetId: ctx.widgetId,
            start: startTime,
            durationMinutes: ctx.durationMinutes,
            timezone: ctx.timezone,
            name: customerName,
            email: customerEmail,
          });

    await supabase.from("appointments").insert({
      customer_id: ctx.customerId,
      widget_id: ctx.widgetId,
      conversation_id: ctx.conversationId,
      customer_name: customerName,
      appointment_time: startTime,
      status: "booked",
      calendar_provider: ctx.provider,
      external_event_id: booking.id,
    });

    return `Møde booket. Tidspunkt: ${startTime} (${ctx.timezone}).`;
  } catch (err) {
    await supabase.from("appointments").insert({
      customer_id: ctx.customerId,
      widget_id: ctx.widgetId,
      conversation_id: ctx.conversationId,
      customer_name: customerName,
      appointment_time: startTime,
      status: "failed",
    });

    // The provider's own words used to go straight back into the model's
    // context — a whole JSON body, in English, which the agent then
    // paraphrased at the customer. What it needs is what to do next.
    console.error("book_meeting failed:", err);
    return bookingFailureAdvice(err);
  }
}
