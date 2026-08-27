import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { decryptSecret } from "@/lib/security";
import {
  fetchCalcomAvailability,
  createCalcomBooking,
  fetchCalcomEventTypes,
  findUpcomingCalcomBooking,
  rescheduleCalcomBooking,
  cancelCalcomBooking,
} from "@/lib/calendar";

// The booking tools the Vapi assistant may call mid-call. They run here,
// server-side, for one reason: Cal.com credentials must never reach Vapi or
// the browser. Vapi only ever sends us a tool name plus arguments — which
// customer, which calendar, and which event type it may touch are resolved
// from the assistant id on our side (see resolveToolContext), never from
// anything the caller supplies.

const AVAILABILITY_WINDOW_DAYS = 7;
const MAX_SLOTS_OFFERED = 8;

// What the tool handler needs to answer a call, all derived server-side.
export interface BookingToolContext {
  customerId: string;
  widgetId: string;
  bookingEnabled: boolean;
}

// Maps a Vapi assistant back to the widget (and therefore the customer) it
// belongs to. This is the isolation boundary for tool calls: assistant ids
// are minted by us and stored on widget_settings.extra.vapiAssistantId, so
// an assistant can only ever resolve to its own customer's widget. The same
// lookup already backs phone-call billing in app/api/webhooks/vapi.
export async function resolveToolContext(assistantId: string): Promise<BookingToolContext | null> {
  const supabase = getAdminClient();

  const { data: settingsRow } = await supabase
    .from("widget_settings")
    .select("widget_id")
    .eq("extra->>vapiAssistantId", assistantId)
    .maybeSingle();
  if (!settingsRow) return null;

  const { data: widget } = await supabase
    .from("widgets")
    .select("id, customer_id, booking_enabled")
    .eq("id", settingsRow.widget_id)
    .maybeSingle();
  if (!widget) return null;

  return {
    customerId: widget.customer_id,
    widgetId: widget.id,
    bookingEnabled: widget.booking_enabled ?? false,
  };
}

interface CalendarDetails {
  apiKey: string;
  eventTypeId: number;
  timezone: string;
}

// Null whenever this widget can't book — booking not switched on, no
// connected Cal.com account, or a connection in an error state. Callers turn
// that into an honest "I can't book" answer rather than attempting a call.
async function getCalendarDetails(ctx: BookingToolContext): Promise<CalendarDetails | null> {
  if (!ctx.bookingEnabled) return null;

  const supabase = getAdminClient();
  const { data: connection } = await supabase
    .from("calendar_connections")
    .select("calcom_api_key, calcom_event_type_id, calcom_timezone")
    .eq("widget_id", ctx.widgetId)
    .eq("provider", "calcom")
    .eq("status", "connected")
    .maybeSingle();

  if (!connection?.calcom_api_key || !connection.calcom_event_type_id) return null;

  const eventTypeId = Number(connection.calcom_event_type_id);
  if (!Number.isFinite(eventTypeId)) return null;

  return {
    apiKey: decryptSecret(connection.calcom_api_key),
    eventTypeId,
    timezone: connection.calcom_timezone ?? "Europe/Copenhagen",
  };
}

// Every tool returns a plain string: it goes straight back to Vapi as the
// tool result and becomes something the model says out loud. So these read
// as answers, never as stack traces — and critically, a failure says the
// booking did NOT happen, so the agent can't narrate a confirmation that
// never existed.
const NO_BOOKING = "Booking er ikke sat op for denne virksomhed, så du kan ikke booke en tid. Tilbyd i stedet at tage imod kundens kontaktoplysninger.";

export async function checkAvailability(
  input: { date?: string },
  ctx: BookingToolContext
): Promise<string> {
  const calendar = await getCalendarDetails(ctx);
  if (!calendar) return NO_BOOKING;

  const start = input.date ? new Date(`${input.date}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(start.getTime())) {
    return "Datoen blev ikke forstået. Spørg kunden om en dato i formatet år-måned-dag.";
  }
  const end = new Date(start.getTime() + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  try {
    const slots = await fetchCalcomAvailability({
      apiKey: calendar.apiKey,
      eventTypeId: calendar.eventTypeId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      timezone: calendar.timezone,
    });

    if (slots.length === 0) {
      return "Der er ingen ledige tider i den periode. Spørg kunden om en anden dato.";
    }
    const times = slots.slice(0, MAX_SLOTS_OFFERED).map((slot) => slot.time);
    return `Ledige tider (tidszone ${calendar.timezone}): ${times.join(", ")}. Tilbyd kun disse tider.`;
  } catch (err) {
    console.error("check_availability failed:", err);
    return "Kalenderen kunne ikke kontaktes lige nu, så der er ingen tider at tilbyde. Sig undskyld og tilbyd at vende tilbage.";
  }
}

export async function createBooking(
  input: { start_time?: string; customer_name?: string; customer_email?: string },
  ctx: BookingToolContext
): Promise<string> {
  const calendar = await getCalendarDetails(ctx);
  if (!calendar) return NO_BOOKING;

  const startTime = input.start_time;
  const customerName = input.customer_name;
  const customerEmail = input.customer_email;
  if (!startTime || !customerName || !customerEmail) {
    return "Der mangler oplysninger til bookingen. Spørg om tidspunkt, navn og email, og prøv igen.";
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

    // The uid is what lets Cal.com's webhooks find this row again when the
    // booking is later moved or cancelled — including from outside our agent.
    await supabase.from("appointments").insert({
      customer_id: ctx.customerId,
      widget_id: ctx.widgetId,
      customer_name: customerName,
      appointment_time: startTime,
      status: "booked",
      calcom_booking_uid: booking.uid || null,
      calcom_booking_id: booking.id ?? null,
    });

    return `Tiden er booket. Bekræft ${startTime} (${calendar.timezone}) over for kunden og nævn at der er sendt en bekræftelse på email.`;
  } catch (err) {
    console.error("create_booking failed:", err);

    await supabase.from("appointments").insert({
      customer_id: ctx.customerId,
      widget_id: ctx.widgetId,
      customer_name: customerName,
      appointment_time: startTime,
      status: "failed",
    });

    // Deliberately explicit: the model must not turn a failure into a
    // confirmation. Cal.com most often rejects a slot because it was taken
    // between the availability check and now.
    return "Bookingen kunne IKKE gennemføres — tiden er ikke reserveret. Sig det ærligt til kunden og tilbyd at finde en anden tid.";
  }
}

// Lists what the business actually offers, so the agent picks a real service
// and its real duration instead of improvising one.
export async function getEventTypes(ctx: BookingToolContext): Promise<string> {
  const calendar = await getCalendarDetails(ctx);
  if (!calendar) return NO_BOOKING;

  try {
    const eventTypes = await fetchCalcomEventTypes(calendar.apiKey);
    if (eventTypes.length === 0) {
      return "Der er ingen ydelser opsat i kalenderen endnu, så du kan ikke booke.";
    }
    const described = eventTypes
      .map((eventType) =>
        eventType.lengthMinutes
          ? `${eventType.title} (${eventType.lengthMinutes} min.)`
          : eventType.title
      )
      .join(", ");
    return `Virksomhedens ydelser: ${described}.`;
  } catch (err) {
    console.error("get_event_types failed:", err);
    return "Ydelserne kunne ikke hentes lige nu.";
  }
}

// The caller's own next appointment, matched on the email they booked with.
// Every reschedule/cancel goes through this first: the agent must never act
// on a booking it hasn't actually found.
export async function getBooking(
  input: { customer_email?: string },
  ctx: BookingToolContext
): Promise<string> {
  const calendar = await getCalendarDetails(ctx);
  if (!calendar) return NO_BOOKING;

  const email = input.customer_email?.trim();
  if (!email) return "Spørg kunden om den email de booked med, for at finde tiden.";

  try {
    const booking = await findUpcomingCalcomBooking({ apiKey: calendar.apiKey, attendeeEmail: email });
    if (!booking) {
      return `Der blev ikke fundet nogen kommende tid på ${email}. Bekræft emailen med kunden.`;
    }
    return `Fundet: "${booking.title}" den ${booking.startTime} (${calendar.timezone}). Bekræft med kunden at det er den rigtige tid.`;
  } catch (err) {
    console.error("get_booking failed:", err);
    return "Tiden kunne ikke slås op lige nu. Sig det ærligt til kunden.";
  }
}

export async function rescheduleBooking(
  input: { customer_email?: string; new_start_time?: string },
  ctx: BookingToolContext
): Promise<string> {
  const calendar = await getCalendarDetails(ctx);
  if (!calendar) return NO_BOOKING;

  const email = input.customer_email?.trim();
  const newStart = input.new_start_time?.trim();
  if (!email || !newStart) {
    return "Der mangler oplysninger. Spørg om kundens email og det nye ønskede tidspunkt.";
  }
  if (Number.isNaN(new Date(newStart).getTime())) {
    return "Det nye tidspunkt blev ikke forstået. Bekræft tidspunktet med kunden og prøv igen.";
  }

  const supabase = getAdminClient();

  try {
    const booking = await findUpcomingCalcomBooking({ apiKey: calendar.apiKey, attendeeEmail: email });
    if (!booking) {
      return `Der blev ikke fundet nogen kommende tid på ${email}, så der er ikke flyttet noget.`;
    }

    // The old booking is moved, never left behind and duplicated by a fresh
    // create — the calendar keeps one appointment, with one id.
    const updated = await rescheduleCalcomBooking({
      apiKey: calendar.apiKey,
      booking,
      newStart,
    });

    // Same Cal.com booking, new time — update the row we already have rather
    // than logging a second appointment for one appointment.
    await supabase
      .from("appointments")
      .update({ appointment_time: updated.startTime, status: "booked" })
      .eq("customer_id", ctx.customerId)
      .eq("calcom_booking_uid", booking.uid);

    // Cal.com's PATCH doesn't reliably email the attendee (cal.diy#14485), so
    // the new time has to be said on the call — that's the caller's receipt.
    return `Tiden er flyttet til ${updated.startTime} (${calendar.timezone}). Sig det nye tidspunkt højt til kunden, så de har det.`;
  } catch (err) {
    console.error("reschedule_booking failed:", err);
    return "Tiden kunne IKKE flyttes, og den oprindelige tid står stadig. Sig det ærligt til kunden.";
  }
}

export async function cancelBooking(
  input: { customer_email?: string; reason?: string },
  ctx: BookingToolContext
): Promise<string> {
  const calendar = await getCalendarDetails(ctx);
  if (!calendar) return NO_BOOKING;

  const email = input.customer_email?.trim();
  if (!email) return "Spørg kunden om den email de booked med, for at finde tiden der skal aflyses.";

  const supabase = getAdminClient();

  try {
    const booking = await findUpcomingCalcomBooking({ apiKey: calendar.apiKey, attendeeEmail: email });
    if (!booking) {
      return `Der blev ikke fundet nogen kommende tid på ${email}, så der er ikke aflyst noget.`;
    }

    await cancelCalcomBooking({
      apiKey: calendar.apiKey,
      bookingId: booking.id,
      reason: input.reason?.trim() || "Aflyst af kunden via telefon",
    });

    await supabase
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("customer_id", ctx.customerId)
      .eq("calcom_booking_uid", booking.uid);

    return `Tiden den ${booking.startTime} (${calendar.timezone}) er aflyst. Bekræft aflysningen over for kunden.`;
  } catch (err) {
    console.error("cancel_booking failed:", err);
    return "Tiden kunne IKKE aflyses, og den står stadig i kalenderen. Sig det ærligt til kunden.";
  }
}

// Dispatches one Vapi tool call. Unknown names return a spoken-safe string
// rather than throwing, so one bad tool name can't kill the whole call.
export async function executeBookingTool(
  name: string,
  args: Record<string, unknown>,
  ctx: BookingToolContext
): Promise<string> {
  switch (name) {
    case "get_event_types":
      return getEventTypes(ctx);
    case "check_availability":
      return checkAvailability(args as { date?: string }, ctx);
    case "create_booking":
      return createBooking(
        args as { start_time?: string; customer_name?: string; customer_email?: string },
        ctx
      );
    case "get_booking":
      return getBooking(args as { customer_email?: string }, ctx);
    case "reschedule_booking":
      return rescheduleBooking(args as { customer_email?: string; new_start_time?: string }, ctx);
    case "cancel_booking":
      return cancelBooking(args as { customer_email?: string; reason?: string }, ctx);
    default:
      return "Den funktion findes ikke.";
  }
}
