import "server-only";
import { ApiError } from "@/types/errors";

const CALCOM_API_BASE = "https://api.cal.com/v1";

export interface CalcomEventType {
  id: number;
  title: string;
  /** Duration in minutes. Null when Cal.com doesn't report one for the type. */
  lengthMinutes: number | null;
}

async function calcomFetch(path: string, apiKey: string, init: RequestInit = {}): Promise<Response> {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${CALCOM_API_BASE}${path}${separator}apiKey=${encodeURIComponent(apiKey)}`, init);

  if (response.status === 401 || response.status === 403) {
    throw ApiError.badRequest("Ugyldig Cal.com API-nøgle.");
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw ApiError.internal(`Cal.com afviste anmodningen (${response.status}): ${body || "ingen detaljer"}`);
  }
  return response;
}

// Cal.com is API-key based (no OAuth) — the customer pastes a key from
// their Cal.com "Settings → Developer → API keys" page. We verify it works
// and return their event types so the dashboard can let them pick which one
// the agent books against.
export async function fetchCalcomEventTypes(apiKey: string): Promise<CalcomEventType[]> {
  const response = await calcomFetch("/event-types", apiKey);
  const data = (await response.json()) as {
    event_types: Array<{ id: number; title: string; length?: number | null }>;
  };
  return data.event_types.map((eventType) => ({
    id: eventType.id,
    title: eventType.title,
    lengthMinutes: typeof eventType.length === "number" ? eventType.length : null,
  }));
}

export interface CalcomAccount {
  username: string | null;
  email: string | null;
  timezone: string;
}

// Doubles as the "test authentication" step (see the dashboard's "Test
// forbindelse" button, app/api/customer/calendar/[id]/test) — a 401/403
// here is exactly what an invalid/revoked key looks like, same failure
// calcomFetch already turns into a clear in-app error.
export async function fetchCalcomMe(apiKey: string): Promise<CalcomAccount> {
  const response = await calcomFetch("/me", apiKey);
  const data = (await response.json()) as {
    user: { username: string | null; email: string | null; timeZone: string | null };
  };
  return {
    username: data.user.username,
    email: data.user.email,
    timezone: data.user.timeZone ?? "Europe/Copenhagen",
  };
}

export interface CalcomSlot {
  time: string; // ISO 8601
}

// Free/busy for one event type over a window — used by the AI's
// check_availability tool (lib/conversation/calendar-tools.ts) before it
// offers a time to the caller/chatter.
export async function fetchCalcomAvailability(params: {
  apiKey: string;
  eventTypeId: number;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  timezone: string;
}): Promise<CalcomSlot[]> {
  const query = new URLSearchParams({
    eventTypeId: String(params.eventTypeId),
    startTime: params.startTime,
    endTime: params.endTime,
    timeZone: params.timezone,
  });
  const response = await calcomFetch(`/slots?${query.toString()}`, params.apiKey);
  const data = (await response.json()) as { slots: Record<string, CalcomSlot[]> };
  return Object.values(data.slots).flat();
}

export interface CalcomBookingResult {
  id: number;
  uid: string;
  status: string;
}

// Creates the actual booking — called by the AI's book_meeting tool only
// after check_availability confirmed the slot, and only once the caller has
// explicitly agreed to a time (see the tool description in
// lib/conversation/calendar-tools.ts). Cal.com owns the calendar from here;
// we just keep our own record in `appointments` for the dashboard.
export async function createCalcomBooking(params: {
  apiKey: string;
  eventTypeId: number;
  start: string; // ISO 8601
  timezone: string;
  name: string;
  email: string;
  notes?: string;
}): Promise<CalcomBookingResult> {
  const response = await calcomFetch("/bookings", params.apiKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventTypeId: params.eventTypeId,
      start: params.start,
      timeZone: params.timezone,
      language: "da",
      responses: { name: params.name, email: params.email, notes: params.notes ?? "" },
      metadata: {},
    }),
  });

  const data = (await response.json()) as { id: number; uid: string; status: string };
  return { id: data.id, uid: data.uid, status: data.status };
}

export interface CalcomBooking {
  id: number;
  uid: string;
  title: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  status: string | null;
  attendeeEmails: string[];
}

// Cal.com's v1 list response has drifted between shapes over time (see
// calcom/cal.com#18422), and individual bookings don't always carry
// `attendees` or `status`. Everything optional is parsed defensively so a
// missing field degrades the result instead of throwing mid-call.
function parseBooking(raw: Record<string, unknown>): CalcomBooking | null {
  const id = typeof raw.id === "number" ? raw.id : null;
  const startTime = typeof raw.startTime === "string" ? raw.startTime : null;
  if (id === null || !startTime) return null;

  const attendees = Array.isArray(raw.attendees) ? raw.attendees : [];
  const attendeeEmails = attendees
    .map((attendee) => (attendee as { email?: unknown } | null)?.email)
    .filter((email): email is string => typeof email === "string");

  return {
    id,
    uid: typeof raw.uid === "string" ? raw.uid : "",
    title: typeof raw.title === "string" ? raw.title : "",
    startTime,
    endTime: typeof raw.endTime === "string" ? raw.endTime : startTime,
    status: typeof raw.status === "string" ? raw.status : null,
    attendeeEmails,
  };
}

function isCancelled(booking: CalcomBooking): boolean {
  return (booking.status ?? "").toLowerCase() === "cancelled";
}

export async function fetchCalcomBookings(apiKey: string): Promise<CalcomBooking[]> {
  const response = await calcomFetch("/bookings", apiKey);
  const data = (await response.json()) as { bookings?: unknown };
  const rows = Array.isArray(data.bookings) ? data.bookings : [];
  return rows
    .map((row) => parseBooking(row as Record<string, unknown>))
    .filter((booking): booking is CalcomBooking => booking !== null);
}

// Finds the caller's own next appointment. Filtering happens here rather
// than via query params because v1's supported filters are inconsistent, and
// because the match has to be on attendee email — that's the only thing a
// voice caller can actually tell us. Cancelled and past bookings are never
// returned, so "move my appointment" can't land on last month's.
export async function findUpcomingCalcomBooking(params: {
  apiKey: string;
  attendeeEmail: string;
}): Promise<CalcomBooking | null> {
  const bookings = await fetchCalcomBookings(params.apiKey);
  const wanted = params.attendeeEmail.trim().toLowerCase();
  const now = Date.now();

  const upcoming = bookings
    .filter((booking) => !isCancelled(booking))
    .filter((booking) => new Date(booking.startTime).getTime() > now)
    .filter((booking) => booking.attendeeEmails.some((email) => email.toLowerCase() === wanted))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  return upcoming[0] ?? null;
}

// Moves an existing booking. Two Cal.com v1 quirks shape this:
//
//  - endTime must be sent explicitly or the appointment's duration is lost
//    (calcom/cal.com#21368), so we carry the original duration across rather
//    than trusting the server to preserve it.
//  - PATCH does not reliably send the "rescheduled" email or fire
//    BOOKING_RESCHEDULED (calcom/cal.diy#14485). The agent therefore states
//    the new time out loud on the call instead of relying on that email.
export async function rescheduleCalcomBooking(params: {
  apiKey: string;
  booking: CalcomBooking;
  newStart: string; // ISO 8601
}): Promise<CalcomBooking> {
  const originalMs =
    new Date(params.booking.endTime).getTime() - new Date(params.booking.startTime).getTime();
  const durationMs = originalMs > 0 ? originalMs : 30 * 60 * 1000;
  const newEnd = new Date(new Date(params.newStart).getTime() + durationMs).toISOString();

  const response = await calcomFetch(`/bookings/${params.booking.id}`, params.apiKey, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startTime: params.newStart, endTime: newEnd }),
  });

  const raw = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const updated = parseBooking((raw.booking as Record<string, unknown>) ?? raw);
  // Cal.com's PATCH response shape varies; fall back to the values we just
  // asked for rather than failing a reschedule that actually succeeded.
  return updated ?? { ...params.booking, startTime: params.newStart, endTime: newEnd };
}

export async function cancelCalcomBooking(params: {
  apiKey: string;
  bookingId: number;
  reason: string;
}): Promise<void> {
  const query = new URLSearchParams({ cancellationReason: params.reason });
  await calcomFetch(`/bookings/${params.bookingId}/cancel?${query.toString()}`, params.apiKey, {
    method: "DELETE",
  });
}
