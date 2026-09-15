import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { fetchCalcomAvailability, createCalcomBooking } from "@/lib/calendar";
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
        customer_name: { type: "string", description: "Kundens navn." },
        customer_email: { type: "string", description: "Kundens email, til bekræftelse af mødet." },
      },
      required: ["start_time", "customer_name", "customer_email"],
    },
  },
];

export interface CalendarToolContext {
  apiKey: string;
  eventTypeId: number;
  timezone: string;
  customerId: string;
  widgetId: string;
  conversationId: string;
}

const AVAILABILITY_WINDOW_DAYS = 7;

export async function executeCalendarTool(name: string, rawInput: unknown, ctx: CalendarToolContext): Promise<string> {
  if (name === "check_availability") {
    return executeCheckAvailability(rawInput as { date?: string }, ctx);
  }
  if (name === "book_meeting") {
    return executeBookMeeting(rawInput as { start_time?: string; customer_name?: string; customer_email?: string }, ctx);
  }
  return "Ukendt funktion.";
}

async function executeCheckAvailability(input: { date?: string }, ctx: CalendarToolContext): Promise<string> {
  const startTime = input.date ? `${input.date}T00:00:00.000Z` : new Date().toISOString();
  const endTime = new Date(new Date(startTime).getTime() + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const slots = await fetchCalcomAvailability({
      apiKey: ctx.apiKey,
      eventTypeId: ctx.eventTypeId,
      startTime,
      endTime,
      timezone: ctx.timezone,
    });
    if (slots.length === 0) return "Ingen ledige tider fundet i den periode. Prøv en anden dato.";
    const times = slots.slice(0, 8).map((slot) => slot.time);
    return `Ledige tider (${ctx.timezone}): ${times.join(", ")}`;
  } catch (err) {
    return `Kunne ikke hente ledige tider lige nu: ${err instanceof Error ? err.message : "ukendt fejl"}`;
  }
}

async function executeBookMeeting(
  input: { start_time?: string; customer_name?: string; customer_email?: string },
  ctx: CalendarToolContext
): Promise<string> {
  const { start_time: startTime, customer_name: customerName, customer_email: customerEmail } = input;
  if (!startTime || !customerName || !customerEmail) {
    return "Mangler oplysninger til at booke mødet (tidspunkt, navn og email er alle påkrævet).";
  }

  const supabase = getAdminClient();

  try {
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
  } catch (err) {
    await supabase.from("appointments").insert({
      customer_id: ctx.customerId,
      widget_id: ctx.widgetId,
      conversation_id: ctx.conversationId,
      customer_name: customerName,
      appointment_time: startTime,
      status: "failed",
    });

    return `Kunne ikke booke mødet: ${err instanceof Error ? err.message : "ukendt fejl"}. Bed kunden vælge en anden ledig tid.`;
  }
}
