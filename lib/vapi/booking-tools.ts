import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { fetchCalcomAvailability, createCalcomBooking } from "@/lib/calendar";
import { ApiError } from "@/types/errors";

const AVAILABILITY_WINDOW_DAYS = 7;

export interface BookingToolContext {
  customerId: string;
  widgetId: string;
  conversationId: string;
}

interface CalendarDetails {
  apiKey: string;
  eventTypeId: number;
  timezone: string;
}

async function getCalendarDetails(widgetId: string): Promise<CalendarDetails | null> {
  const supabase = getAdminClient();

  const { data: connection, error } = await supabase
    .from("calendar_connections")
    .select("calcom_api_key, calcom_event_type_id, calcom_timezone")
    .eq("widget_id", widgetId)
    .eq("provider", "calcom")
    .eq("status", "connected")
    .maybeSingle();

  if (error) throw error;
  if (!connection) return null;

  // Decrypt the API key
  const { decryptSecret } = await import("@/lib/security/crypto");
  const apiKey = decryptSecret(connection.calcom_api_key);

  return {
    apiKey,
    eventTypeId: Number(connection.calcom_event_type_id),
    timezone: connection.calcom_timezone || "Europe/Copenhagen",
  };
}

export async function checkAvailability(
  input: { date?: string },
  ctx: BookingToolContext
): Promise<string> {
  const calendar = await getCalendarDetails(ctx.widgetId);
  if (!calendar) {
    return "Kalender er ikke konfigureret. Booking er ikke tilgængelig via denne agent.";
  }

  const startTime = input.date ? `${input.date}T00:00:00.000Z` : new Date().toISOString();
  const endTime = new Date(new Date(startTime).getTime() + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const slots = await fetchCalcomAvailability({
      apiKey: calendar.apiKey,
      eventTypeId: calendar.eventTypeId,
      startTime,
      endTime,
      timezone: calendar.timezone,
    });

    if (slots.length === 0) {
      return "Ingen ledige tider fundet i den periode. Prøv en anden dato.";
    }

    const times = slots.slice(0, 8).map((slot) => slot.time);
    return `Ledige tider (${calendar.timezone}): ${times.join(", ")}`;
  } catch (err) {
    return `Kunne ikke hente ledige tider: ${err instanceof Error ? err.message : "ukendt fejl"}`;
  }
}

export async function createBooking(
  input: { start_time?: string; customer_name?: string; customer_email?: string },
  ctx: BookingToolContext
): Promise<string> {
  const calendar = await getCalendarDetails(ctx.widgetId);
  if (!calendar) {
    return "Kalender er ikke konfigureret. Booking er ikke tilgængelig.";
  }

  const { start_time: startTime, customer_name: customerName, customer_email: customerEmail } = input;
  if (!startTime || !customerName || !customerEmail) {
    return "Mangler oplysninger til at booke mødet (tidspunkt, navn og email er alle påkrævet).";
  }

  const supabase = getAdminClient();

  try {
    const booking = await createCalcomBooking({
      apiKey: calendar.apiKey,
      eventTypeId: calendar.eventTypeId,
      start: startTime,
      timezone: calendar.timezone,
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

    return `Møde booket succesfuldt. Bekræftelses-id: ${booking.uid}. Tidspunkt: ${startTime} (${calendar.timezone}).`;
  } catch (err) {
    await supabase.from("appointments").insert({
      customer_id: ctx.customerId,
      widget_id: ctx.widgetId,
      conversation_id: ctx.conversationId,
      customer_name: customerName,
      appointment_time: startTime,
      status: "failed",
    });

    return `Kunne ikke booke mødet: ${err instanceof Error ? err.message : "ukendt fejl"}. Prøv en anden tid.`;
  }
}
