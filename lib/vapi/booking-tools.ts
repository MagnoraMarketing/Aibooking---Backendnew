import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { findWidgetIdForAssistant } from "./assistant-owner";
import { decryptSecret } from "@/lib/security";
import {
  bookingFailureAdvice,
  checkBookingDetails,
  type BookingDetailsInput,
  fetchCalcomAvailability,
  createCalcomBooking,
  fetchCalcomEventTypes,
  findUpcomingCalcomBooking,
  rescheduleCalcomBooking,
  cancelCalcomBooking,
  getOAuthCalendarSession,
  refreshGoogleToken,
  refreshOutlookToken,
  fetchGoogleFreeBusy,
  createGoogleBooking,
  findUpcomingGoogleBooking,
  rescheduleGoogleBooking,
  cancelGoogleBooking,
  fetchOutlookFreeBusy,
  createOutlookBooking,
  findUpcomingOutlookBooking,
  rescheduleOutlookBooking,
  cancelOutlookBooking,
  generateBusinessHourSlots,
} from "@/lib/calendar";

// The booking tools the Vapi assistant may call mid-call. They run here,
// server-side, for one reason: calendar credentials must never reach Vapi or
// the browser. Vapi only ever sends us a tool name plus arguments — which
// customer, which calendar, and which event type/duration it may touch are
// resolved from the assistant id on our side (see resolveToolContext), never
// from anything the caller supplies.
//
// Three calendar providers are supported (getCalendarDetails below): Cal.com
// (event types, its own timezone), and Google/Outlook (no event-type
// concept — a configurable fixed duration, fixed to Europe/Copenhagen since
// that's the one timezone this platform's OAuth connections don't otherwise
// have a reliable source for). A widget uses whichever one it has connected
// — calcom takes priority if somehow more than one is, since it's the
// longer-supported, admin-vetted path.

const AVAILABILITY_WINDOW_DAYS = 7;
const MAX_SLOTS_OFFERED = 8;
const OAUTH_CALENDAR_TIMEZONE = "Europe/Copenhagen";

// What the tool handler needs to answer a call, all derived server-side.
export interface BookingToolContext {
  customerId: string;
  widgetId: string;
  bookingEnabled: boolean;
}

// Maps a Vapi assistant back to the widget (and therefore the customer) it
// belongs to. This is the isolation boundary for tool calls — see
// findWidgetIdForAssistant, which also matches an agent's separate outbound
// assistant, so a campaign call can book too. The same lookup backs
// phone-call billing in app/api/webhooks/vapi.
export async function resolveToolContext(assistantId: string): Promise<BookingToolContext | null> {
  const supabase = getAdminClient();

  const widgetId = await findWidgetIdForAssistant(assistantId, supabase);
  if (!widgetId) return null;

  const { data: widget } = await supabase
    .from("widgets")
    .select("id, customer_id, booking_enabled")
    .eq("id", widgetId)
    .maybeSingle();
  if (!widget) return null;

  return {
    customerId: widget.customer_id,
    widgetId: widget.id,
    bookingEnabled: widget.booking_enabled ?? false,
  };
}

interface CalcomSession {
  provider: "calcom";
  apiKey: string;
  eventTypeId: number;
  timezone: string;
}

interface OAuthSession {
  provider: "google" | "outlook";
  accessToken: string;
  calendarId: string;
  scheduleEmail: string | null;
  widgetId: string;
  durationMinutes: number;
  timezone: string;
}

type CalendarSession = CalcomSession | OAuthSession;

// Null whenever this widget can't book — booking not switched on, or no
// working calendar connection (any provider). Callers turn that into an
// honest "I can't book" answer rather than attempting a call.
async function getCalendarDetails(ctx: BookingToolContext): Promise<CalendarSession | null> {
  if (!ctx.bookingEnabled) return null;

  const supabase = getAdminClient();
  const { data: connection } = await supabase
    .from("calendar_connections")
    .select("calcom_api_key, calcom_event_type_id, calcom_timezone")
    .eq("widget_id", ctx.widgetId)
    .eq("provider", "calcom")
    .eq("status", "connected")
    .maybeSingle();

  if (connection?.calcom_api_key && connection.calcom_event_type_id) {
    const eventTypeId = Number(connection.calcom_event_type_id);
    if (Number.isFinite(eventTypeId)) {
      return {
        provider: "calcom",
        apiKey: decryptSecret(connection.calcom_api_key),
        eventTypeId,
        timezone: connection.calcom_timezone ?? "Europe/Copenhagen",
      };
    }
  }

  const google = await getOAuthCalendarSession(ctx.widgetId, "google", refreshGoogleToken);
  if (google) {
    return {
      provider: "google",
      accessToken: google.accessToken,
      calendarId: google.calendarId,
      scheduleEmail: google.accountEmail,
      widgetId: ctx.widgetId,
      durationMinutes: google.durationMinutes,
      timezone: OAUTH_CALENDAR_TIMEZONE,
    };
  }

  const outlook = await getOAuthCalendarSession(ctx.widgetId, "outlook", refreshOutlookToken);
  // getSchedule (the free/busy lookup) needs the mailbox's own address —
  // without it we can only book blind, so treat a missing one as unusable.
  if (outlook && outlook.accountEmail) {
    return {
      provider: "outlook",
      accessToken: outlook.accessToken,
      calendarId: outlook.calendarId,
      scheduleEmail: outlook.accountEmail,
      widgetId: ctx.widgetId,
      durationMinutes: outlook.durationMinutes,
      timezone: OAUTH_CALENDAR_TIMEZONE,
    };
  }

  return null;
}

// Every tool returns a plain string: it goes straight back to Vapi as the
// tool result and becomes something the model says out loud. So these read
// as answers, never as stack traces — and critically, a failure says the
// booking did NOT happen, so the agent can't narrate a confirmation that
// never existed.
const NO_BOOKING = "Booking er ikke sat op for denne virksomhed, så du kan ikke booke en tid. Tilbyd i stedet at tage imod kundens kontaktoplysninger.";

// Today, where the business is. A Vapi assistant's prompt is written once
// and synced, so it carries no date — and an agent asked for "på mandag"
// then guesses. One did, in a test call: it worked out a Monday in January,
// checked that week, and told the caller the time was taken. Nothing was
// taken; nothing was even looked at. So every availability answer says what
// day it is, which is the one moment the agent needs to know.
function isoDateInZone(now: Date, timeZone: string): string {
  // en-CA renders as YYYY-MM-DD, which is what Cal.com and this tool speak.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function spokenDateInZone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("da-DK", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
}

export async function checkAvailability(
  input: { date?: string },
  ctx: BookingToolContext
): Promise<string> {
  const calendar = await getCalendarDetails(ctx);
  if (!calendar) return NO_BOOKING;

  const now = new Date();
  const today = isoDateInZone(now, calendar.timezone);
  const dateHeader = `I dag er ${spokenDateInZone(now, calendar.timezone)}.`;

  // A date already gone is not a date the caller meant, and searching it
  // returns nothing — which the agent then reports as "no free times".
  // Answer from today instead, and say why.
  const past = Boolean(input.date && input.date < today);
  const requestedDate = past ? undefined : input.date;
  const correction = past
    ? `Datoen ${input.date} er allerede passeret, så her er tiderne fra i dag i stedet. `
    : "";

  const start = requestedDate ? new Date(`${requestedDate}T00:00:00.000Z`) : now;
  if (Number.isNaN(start.getTime())) {
    return `${dateHeader} Datoen blev ikke forstået. Spørg kunden om en dato i formatet år-måned-dag.`;
  }
  const end = new Date(start.getTime() + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  try {
    let times: string[];

    if (calendar.provider === "calcom") {
      const slots = await fetchCalcomAvailability({
        apiKey: calendar.apiKey,
        eventTypeId: calendar.eventTypeId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        timezone: calendar.timezone,
      });
      times = slots.slice(0, MAX_SLOTS_OFFERED).map((slot) => slot.time);
    } else {
      const busy =
        calendar.provider === "google"
          ? await fetchGoogleFreeBusy({
              accessToken: calendar.accessToken,
              calendarId: calendar.calendarId,
              startTime: start.toISOString(),
              endTime: end.toISOString(),
            })
          : await fetchOutlookFreeBusy({
              accessToken: calendar.accessToken,
              scheduleEmail: calendar.scheduleEmail!,
              startTime: start.toISOString(),
              endTime: end.toISOString(),
            });

      times = generateBusinessHourSlots({
        windowStart: start,
        windowEnd: end,
        timezone: calendar.timezone,
        durationMinutes: calendar.durationMinutes,
        busy,
        maxSlots: MAX_SLOTS_OFFERED,
      });
    }

    if (times.length === 0) {
      return `${dateHeader} ${correction}Der er ingen ledige tider i den periode. Spørg kunden om en anden dato.`;
    }
    return `${dateHeader} ${correction}Ledige tider (tidszone ${calendar.timezone}): ${times.join(", ")}. Tilbyd kun disse tider.`;
  } catch (err) {
    console.error("check_availability failed:", err);
    return "Kalenderen kunne ikke kontaktes lige nu, så der er ingen tider at tilbyde. Sig undskyld og tilbyd at vende tilbage.";
  }
}

export async function createBooking(input: BookingDetailsInput, ctx: BookingToolContext): Promise<string> {
  const calendar = await getCalendarDetails(ctx);
  if (!calendar) return NO_BOOKING;

  // Name, a read-back email and a time — or no booking at all, and the
  // agent is told which one to ask for (see checkBookingDetails).
  const details = checkBookingDetails(input);
  if (!details.ok) return details.advice;
  const { startTime, customerName, customerEmail } = details;

  const supabase = getAdminClient();

  try {
    if (calendar.provider === "calcom") {
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
    } else {
      const booking =
        calendar.provider === "google"
          ? await createGoogleBooking({
              accessToken: calendar.accessToken,
              calendarId: calendar.calendarId,
              widgetId: calendar.widgetId,
              start: startTime,
              durationMinutes: calendar.durationMinutes,
              timezone: calendar.timezone,
              name: customerName,
              email: customerEmail,
            })
          : await createOutlookBooking({
              accessToken: calendar.accessToken,
              widgetId: calendar.widgetId,
              start: startTime,
              durationMinutes: calendar.durationMinutes,
              timezone: calendar.timezone,
              name: customerName,
              email: customerEmail,
            });

      await supabase.from("appointments").insert({
        customer_id: ctx.customerId,
        widget_id: ctx.widgetId,
        customer_name: customerName,
        appointment_time: startTime,
        status: "booked",
        calendar_provider: calendar.provider,
        external_event_id: booking.id,
      });
    }

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
    // confirmation. Which refusal it was decides the next move — a
    // mis-heard email is fixed by asking the caller to repeat it, and
    // offering another time instead (as this used to, for every failure
    // alike) sends the conversation somewhere that was never the problem.
    return bookingFailureAdvice(err);
  }
}

// Lists what the business actually offers, so the agent picks a real service
// and its real duration instead of improvising one. Google/Outlook have no
// event-type catalog — they report the single configured meeting length
// instead of a menu, which is the truthful equivalent for those providers.
export async function getEventTypes(ctx: BookingToolContext): Promise<string> {
  const calendar = await getCalendarDetails(ctx);
  if (!calendar) return NO_BOOKING;

  if (calendar.provider !== "calcom") {
    return `Virksomheden tager imod møder på ${calendar.durationMinutes} minutter.`;
  }

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
    const booking = await findExistingBooking(calendar, email);
    if (!booking) {
      return `Der blev ikke fundet nogen kommende tid på ${email}. Bekræft emailen med kunden.`;
    }
    return `Fundet: "${"title" in booking ? booking.title : "Møde"}" den ${booking.startTime} (${calendar.timezone}). Bekræft med kunden at det er den rigtige tid.`;
  } catch (err) {
    console.error("get_booking failed:", err);
    return "Tiden kunne ikke slås op lige nu. Sig det ærligt til kunden.";
  }
}

// Shared lookup used by getBooking/rescheduleBooking/cancelBooking — one
// place that knows how to find "the caller's upcoming booking" for whichever
// provider this widget is connected to.
type FoundBooking = { id: number | string; uid?: string; startTime: string; endTime: string };

async function findExistingBooking(calendar: CalendarSession, email: string): Promise<FoundBooking | null> {
  if (calendar.provider === "calcom") {
    return findUpcomingCalcomBooking({ apiKey: calendar.apiKey, attendeeEmail: email });
  }
  if (calendar.provider === "google") {
    return findUpcomingGoogleBooking({
      accessToken: calendar.accessToken,
      calendarId: calendar.calendarId,
      widgetId: calendar.widgetId,
      attendeeEmail: email,
    });
  }
  return findUpcomingOutlookBooking({
    accessToken: calendar.accessToken,
    widgetId: calendar.widgetId,
    attendeeEmail: email,
  });
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
    const booking = await findExistingBooking(calendar, email);
    if (!booking) {
      return `Der blev ikke fundet nogen kommende tid på ${email}, så der er ikke flyttet noget.`;
    }

    // The old booking is moved, never left behind and duplicated by a fresh
    // create — the calendar keeps one appointment, with one id.
    let updatedStart: string;
    if (calendar.provider === "calcom") {
      const updated = await rescheduleCalcomBooking({
        apiKey: calendar.apiKey,
        booking: booking as Awaited<ReturnType<typeof findUpcomingCalcomBooking>> & object,
        newStart,
      });
      updatedStart = updated.startTime;
      // One appointment stays one row — but a Cal.com reschedule cancels the old
      // booking and answers with a new uid, so the row has to follow that uid.
      // Keeping the old one would leave us pointing at a cancelled booking, and
      // the next "flyt min tid" would find nothing to update.
      await supabase
        .from("appointments")
        .update({
          appointment_time: updatedStart,
          status: "booked",
          calcom_booking_uid: updated.uid || booking.uid,
          calcom_booking_id: updated.id ?? booking.id,
        })
        .eq("customer_id", ctx.customerId)
        .eq("calcom_booking_uid", booking.uid);
    } else if (calendar.provider === "google") {
      const updated = await rescheduleGoogleBooking({
        accessToken: calendar.accessToken,
        calendarId: calendar.calendarId,
        booking: booking as Awaited<ReturnType<typeof findUpcomingGoogleBooking>> & object,
        newStart,
        timezone: calendar.timezone,
      });
      updatedStart = updated.startTime;
      await supabase
        .from("appointments")
        .update({ appointment_time: updatedStart, status: "booked" })
        .eq("customer_id", ctx.customerId)
        .eq("calendar_provider", "google")
        .eq("external_event_id", booking.id);
    } else {
      const updated = await rescheduleOutlookBooking({
        accessToken: calendar.accessToken,
        booking: booking as Awaited<ReturnType<typeof findUpcomingOutlookBooking>> & object,
        newStart,
        timezone: calendar.timezone,
      });
      updatedStart = updated.startTime;
      await supabase
        .from("appointments")
        .update({ appointment_time: updatedStart, status: "booked" })
        .eq("customer_id", ctx.customerId)
        .eq("calendar_provider", "outlook")
        .eq("external_event_id", booking.id);
    }

    // Neither Cal.com's PATCH nor a rebuilt Google/Outlook event reliably
    // emails the attendee, so the new time has to be said on the call —
    // that's the caller's receipt.
    return `Tiden er flyttet til ${updatedStart} (${calendar.timezone}). Sig det nye tidspunkt højt til kunden, så de har det.`;
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
    const booking = await findExistingBooking(calendar, email);
    if (!booking) {
      return `Der blev ikke fundet nogen kommende tid på ${email}, så der er ikke aflyst noget.`;
    }

    const reason = input.reason?.trim() || "Aflyst af kunden via telefon";

    if (calendar.provider === "calcom") {
      await cancelCalcomBooking({ apiKey: calendar.apiKey, bookingUid: booking.uid as string, reason });
      await supabase
        .from("appointments")
        .update({ status: "cancelled" })
        .eq("customer_id", ctx.customerId)
        .eq("calcom_booking_uid", booking.uid);
    } else if (calendar.provider === "google") {
      await cancelGoogleBooking({
        accessToken: calendar.accessToken,
        calendarId: calendar.calendarId,
        eventId: booking.id as string,
      });
      await supabase
        .from("appointments")
        .update({ status: "cancelled" })
        .eq("customer_id", ctx.customerId)
        .eq("calendar_provider", "google")
        .eq("external_event_id", booking.id);
    } else {
      await cancelOutlookBooking({ accessToken: calendar.accessToken, eventId: booking.id as string, reason });
      await supabase
        .from("appointments")
        .update({ status: "cancelled" })
        .eq("customer_id", ctx.customerId)
        .eq("calendar_provider", "outlook")
        .eq("external_event_id", booking.id);
    }

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
        args as BookingDetailsInput,
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
