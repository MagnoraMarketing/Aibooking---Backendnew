import "server-only";
import { ApiError } from "@/types/errors";

// Cal.com decommissioned API v1 on 28 February 2026 — every v1 call now
// answers 410 "API v1 has been decommissioned", which took down connecting a
// calendar AND every booking tool the agent uses. v2 takes the exact same
// API key the customer already pasted, as a Bearer token instead of an
// `?apiKey=` query parameter, so nothing changes for them.
const CALCOM_API_BASE = "https://api.cal.com/v2";

// v2 versions each endpoint group separately, and sending no version pins
// you to an older contract than the one this file is written against — the
// field names below (start/end, attendee, bookingFieldsResponses) only hold
// for these versions.
const BOOKINGS_API_VERSION = "2024-08-13";
const SLOTS_API_VERSION = "2024-09-04";
const EVENT_TYPES_API_VERSION = "2024-06-14";

export interface CalcomEventType {
  id: number;
  title: string;
  /** Duration in minutes. Null when Cal.com doesn't report one for the type. */
  lengthMinutes: number | null;
}

interface CalcomRequest extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
  apiVersion?: string;
}

// One request helper for both auth kinds: in v2 a personal API key and an
// OAuth access token are both just a Bearer token, which is why the *OAuth
// functions at the bottom of this file are now aliases rather than a second
// implementation.
//
// Returns the whole envelope ({ status, data }) rather than unwrapping it, so
// each caller can decide what a missing `data` means — an empty list is a
// real answer for event types, but a missing booking is not.
async function calcomRequest<T>(
  path: string,
  token: string,
  { apiVersion, headers, ...init }: CalcomRequest = {}
): Promise<{ data?: T }> {
  const response = await fetch(`${CALCOM_API_BASE}${path}`, {
    ...init,
    headers: {
      ...headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(apiVersion ? { "cal-api-version": apiVersion } : {}),
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw ApiError.badRequest("Ugyldig Cal.com API-nøgle.");
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw ApiError.internal(`Cal.com afviste anmodningen (${response.status}): ${body || "ingen detaljer"}`);
  }

  return (await response.json().catch(() => ({}))) as { data?: T };
}

// v2 wants the start of a booking in UTC ("2024-08-13T09:00:00Z"). The agent
// speaks in the business's local time and hands us an offset timestamp like
// 2026-03-15T14:00:00+01:00, so it is normalized here rather than trusting
// every caller to have done it.
function toUtcIso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw ApiError.badRequest(`Ugyldigt tidspunkt: ${value}`);
  }
  return parsed.toISOString();
}

export interface CalcomAccount {
  username: string | null;
  email: string | null;
  timezone: string;
}

// Doubles as the "test authentication" step (see the dashboard's "Test
// forbindelse" button, app/api/customer/calendar/[id]/test) — a 401/403
// here is exactly what an invalid/revoked key looks like, same failure
// calcomRequest already turns into a clear in-app error.
export async function fetchCalcomMe(apiKey: string): Promise<CalcomAccount> {
  const { data } = await calcomRequest<{ username?: string; email?: string; timeZone?: string }>("/me", apiKey);
  return {
    username: data?.username ?? null,
    email: data?.email ?? null,
    timezone: data?.timeZone ?? "Europe/Copenhagen",
  };
}

// The customer pastes a key from their Cal.com "Settings → Developer → API
// keys" page. We verify it works and return their event types so the
// dashboard can let them pick which one the agent books against.
//
// v2 reads the owner from the `username` query parameter ("if only username
// provided will get all event types"), so the account lookup comes first.
// One extra GET per call, and the alternative — an unfiltered /event-types —
// is not documented to return the key owner's own types.
export async function fetchCalcomEventTypes(apiKey: string): Promise<CalcomEventType[]> {
  const { username } = await fetchCalcomMe(apiKey);
  const query = username ? `?username=${encodeURIComponent(username)}` : "";

  const { data } = await calcomRequest<Array<{ id: number; title: string; lengthInMinutes?: number; length?: number }>>(
    `/event-types${query}`,
    apiKey,
    { apiVersion: EVENT_TYPES_API_VERSION }
  );

  // An empty list is a real answer, not an error: a key scoped to a team, or
  // an account whose types live somewhere this endpoint doesn't report, comes
  // back without a list at all. Reading `.map` off that threw a TypeError
  // that surfaced as a 500 on connect, which made a perfectly valid API key
  // look broken. Callers handle "no list" by letting the customer type the
  // event-type id themselves.
  if (!Array.isArray(data)) return [];

  return data.map((eventType) => ({
    id: eventType.id,
    title: eventType.title,
    // v2 reports the duration as lengthInMinutes; v1 called it length, and
    // some responses carry neither.
    lengthMinutes: eventType.lengthInMinutes ?? eventType.length ?? null,
  }));
}

export interface CalcomSlot {
  time: string; // ISO 8601
}

// Free/busy for one event type over a window — used by the AI's
// check_availability tool (lib/conversation/calendar-tools.ts,
// lib/vapi/booking-tools.ts) before it offers a time to the caller/chatter.
//
// v2 groups the slots by day ({ "2026-03-15": [{ start }, …] }) instead of
// v1's flat list, and names the window start/end rather than
// startTime/endTime.
export async function fetchCalcomAvailability(params: {
  apiKey: string;
  eventTypeId: number;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  timezone: string;
}): Promise<CalcomSlot[]> {
  const query = new URLSearchParams({
    eventTypeId: String(params.eventTypeId),
    start: params.startTime,
    end: params.endTime,
    timeZone: params.timezone,
  });

  const { data } = await calcomRequest<Record<string, Array<{ start?: string }>>>(
    `/slots?${query.toString()}`,
    params.apiKey,
    { apiVersion: SLOTS_API_VERSION }
  );

  if (!data || typeof data !== "object") return [];

  return Object.values(data)
    .flat()
    .map((slot) => slot?.start)
    .filter((start): start is string => typeof start === "string")
    .map((start) => ({ time: start }));
}

export interface CalcomBookingResult {
  id: number;
  uid: string;
  status: string;
}

// Creates the actual booking — called by the AI's create_booking tool only
// after check_availability confirmed the slot, and only once the caller has
// explicitly agreed to a time (see the tool description in
// lib/vapi/booking-tools.ts). Cal.com owns the calendar from here; we just
// keep our own record in `appointments` for the dashboard.
export async function createCalcomBooking(params: {
  apiKey: string;
  eventTypeId: number;
  start: string; // ISO 8601
  timezone: string;
  name: string;
  email: string;
  notes?: string;
}): Promise<CalcomBookingResult> {
  const { data } = await calcomRequest<{ id: number; uid: string; status: string }>("/bookings", params.apiKey, {
    apiVersion: BOOKINGS_API_VERSION,
    method: "POST",
    body: JSON.stringify({
      start: toUtcIso(params.start),
      eventTypeId: params.eventTypeId,
      // v1's flat `responses` object is gone: who is attending is now
      // `attendee`, and anything else the event type asks for travels in
      // bookingFieldsResponses.
      attendee: {
        name: params.name,
        email: params.email,
        timeZone: params.timezone,
        language: "da",
      },
      ...(params.notes ? { bookingFieldsResponses: { notes: params.notes } } : {}),
    }),
  });

  if (!data?.uid) {
    throw ApiError.internal("Cal.com returnerede ingen booking.");
  }
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

// Cal.com's booking shape has drifted between versions (v1 said
// startTime/endTime, v2 says start/end), and individual bookings don't always
// carry `attendees` or `status`. Everything optional is parsed defensively so
// a missing field degrades the result instead of throwing mid-call, and both
// spellings are read so a response from either contract still parses.
function parseBooking(raw: Record<string, unknown>): CalcomBooking | null {
  const id = typeof raw.id === "number" ? raw.id : null;
  const start = typeof raw.start === "string" ? raw.start : typeof raw.startTime === "string" ? raw.startTime : null;
  if (id === null || !start) return null;

  const end = typeof raw.end === "string" ? raw.end : typeof raw.endTime === "string" ? raw.endTime : start;
  const attendees = Array.isArray(raw.attendees) ? raw.attendees : [];
  const attendeeEmails = attendees
    .map((attendee) => (attendee as { email?: unknown } | null)?.email)
    .filter((email): email is string => typeof email === "string");

  return {
    id,
    uid: typeof raw.uid === "string" ? raw.uid : "",
    title: typeof raw.title === "string" ? raw.title : "",
    startTime: start,
    endTime: end,
    status: typeof raw.status === "string" ? raw.status : null,
    attendeeEmails,
  };
}

function isCancelled(booking: CalcomBooking): boolean {
  return (booking.status ?? "").toLowerCase() === "cancelled";
}

export async function fetchCalcomBookings(
  apiKey: string,
  filters: { attendeeEmail?: string; status?: string } = {}
): Promise<CalcomBooking[]> {
  const query = new URLSearchParams();
  if (filters.attendeeEmail) query.set("attendeeEmail", filters.attendeeEmail);
  if (filters.status) query.set("status", filters.status);
  const suffix = query.toString() ? `?${query.toString()}` : "";

  const { data } = await calcomRequest<unknown>(`/bookings${suffix}`, apiKey, { apiVersion: BOOKINGS_API_VERSION });
  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((row) => parseBooking(row as Record<string, unknown>))
    .filter((booking): booking is CalcomBooking => booking !== null);
}

// Finds the caller's own next appointment. The match has to be on attendee
// email — that's the only thing a voice caller can actually tell us. v2 can
// filter on both the email and "upcoming" server-side; the same checks are
// repeated here so a filter Cal.com ignores can't make "move my appointment"
// land on last month's, or on a cancelled one.
export async function findUpcomingCalcomBooking(params: {
  apiKey: string;
  attendeeEmail: string;
}): Promise<CalcomBooking | null> {
  const wanted = params.attendeeEmail.trim().toLowerCase();
  const bookings = await fetchCalcomBookings(params.apiKey, { attendeeEmail: wanted, status: "upcoming" });
  const now = Date.now();

  const upcoming = bookings
    .filter((booking) => !isCancelled(booking))
    .filter((booking) => new Date(booking.startTime).getTime() > now)
    .filter((booking) => booking.attendeeEmails.some((email) => email.toLowerCase() === wanted))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  return upcoming[0] ?? null;
}

// Moves an existing booking. In v2 this is a POST to the booking's own
// /reschedule route (v1 PATCHed the booking and needed endTime sent along or
// the duration was lost, calcom/cal.com#21368 — v2 keeps the event type's
// duration itself).
//
// Cal.com answers with a NEW booking: the old uid is cancelled and points at
// the new one via rescheduledToUid. Callers must therefore store the uid
// returned here, or they'll be holding a cancelled booking's id.
export async function rescheduleCalcomBooking(params: {
  apiKey: string;
  booking: CalcomBooking;
  newStart: string; // ISO 8601
  reason?: string;
}): Promise<CalcomBooking> {
  const newStart = toUtcIso(params.newStart);
  const { data } = await calcomRequest<Record<string, unknown>>(
    `/bookings/${encodeURIComponent(params.booking.uid)}/reschedule`,
    params.apiKey,
    {
      apiVersion: BOOKINGS_API_VERSION,
      method: "POST",
      body: JSON.stringify({
        start: newStart,
        ...(params.reason ? { reschedulingReason: params.reason } : {}),
      }),
    }
  );

  const updated = data ? parseBooking(data) : null;
  // Fall back to the values we just asked for rather than failing a
  // reschedule that actually succeeded — but keep the old uid only as a last
  // resort, since it no longer points at a live booking.
  return updated ?? { ...params.booking, startTime: newStart, endTime: newStart };
}

// v2 cancels by uid (v1 used the numeric id).
export async function cancelCalcomBooking(params: {
  apiKey: string;
  bookingUid: string;
  reason: string;
}): Promise<void> {
  await calcomRequest(`/bookings/${encodeURIComponent(params.bookingUid)}/cancel`, params.apiKey, {
    apiVersion: BOOKINGS_API_VERSION,
    method: "POST",
    body: JSON.stringify({ cancellationReason: params.reason }),
  });
}

// ---------------------------------------------------------------------------
// OAuth-connected calendars (app/api/customer/calendar/calcom/*)
//
// v1 authenticated with a key in the query string while v2 used a Bearer
// token, so these had to be a second implementation. In v2 both are the same
// Bearer header, so they are aliases: one wire format, one set of fixes.
// ---------------------------------------------------------------------------

export function fetchCalcomEventTypesOAuth(accessToken: string): Promise<CalcomEventType[]> {
  return fetchCalcomEventTypes(accessToken);
}

// The connected account's own timezone. Read on connect, and again for a
// connection stored before the callback started keeping it.
export async function fetchCalcomTimezoneOAuth(accessToken: string): Promise<string | null> {
  const { timezone } = await fetchCalcomMe(accessToken);
  return timezone;
}

export function fetchCalcomAvailabilityOAuth(params: {
  accessToken: string;
  eventTypeId: number;
  startTime: string;
  endTime: string;
  timezone: string;
}): Promise<CalcomSlot[]> {
  const { accessToken, ...rest } = params;
  return fetchCalcomAvailability({ apiKey: accessToken, ...rest });
}

export function createCalcomBookingOAuth(params: {
  accessToken: string;
  eventTypeId: number;
  start: string;
  timezone: string;
  name: string;
  email: string;
  notes?: string;
}): Promise<CalcomBookingResult> {
  const { accessToken, ...rest } = params;
  return createCalcomBooking({ apiKey: accessToken, ...rest });
}
