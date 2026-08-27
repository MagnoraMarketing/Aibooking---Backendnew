import "server-only";
import { ApiError } from "@/types/errors";

const CALCOM_API_BASE_V1 = "https://api.cal.com/v1";
const CALCOM_API_BASE_V2 = "https://api.cal.com/v2";

export interface CalcomEventType {
  id: number;
  title: string;
}

async function calcomFetch(path: string, apiKey: string, init: RequestInit = {}): Promise<Response> {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${CALCOM_API_BASE_V1}${path}${separator}apiKey=${encodeURIComponent(apiKey)}`, init);

  if (response.status === 401 || response.status === 403) {
    throw ApiError.badRequest("Ugyldig Cal.com API-nøgle.");
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw ApiError.internal(`Cal.com afviste anmodningen (${response.status}): ${body || "ingen detaljer"}`);
  }
  return response;
}

// OAuth-based fetch using Bearer token
async function calcomOAuthFetch(path: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  const url = `${CALCOM_API_BASE_V2}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("Cal.com authentication failed");
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw ApiError.internal(`Cal.com API error (${response.status}): ${body || "no details"}`);
  }
  return response;
}

// Cal.com is API-key based (no OAuth) — the customer pastes a key from
// their Cal.com "Settings → Developer → API keys" page. We verify it works
// and return their event types so the dashboard can let them pick which one
// the agent books against.
export async function fetchCalcomEventTypes(apiKey: string): Promise<CalcomEventType[]> {
  const response = await calcomFetch("/event-types", apiKey);
  const data = (await response.json()) as { event_types: Array<{ id: number; title: string }> };
  return data.event_types.map((eventType) => ({ id: eventType.id, title: eventType.title }));
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

// OAuth-based event types retrieval (v2 API)
export async function fetchCalcomEventTypesOAuth(accessToken: string): Promise<CalcomEventType[]> {
  const response = await calcomOAuthFetch("/event-types", accessToken);
  const data = (await response.json()) as { data?: Array<{ id: number; title: string }> };

  if (!data.data) {
    return [];
  }

  return data.data.map((eventType) => ({
    id: eventType.id,
    title: eventType.title,
  }));
}

// OAuth-based availability retrieval (v2 API)
export async function fetchCalcomAvailabilityOAuth(params: {
  accessToken: string;
  eventTypeId: number;
  startTime: string;
  endTime: string;
  timezone: string;
}): Promise<CalcomSlot[]> {
  const query = new URLSearchParams({
    eventTypeId: String(params.eventTypeId),
    startTime: params.startTime,
    endTime: params.endTime,
    timeZone: params.timezone,
  });

  const response = await calcomOAuthFetch(`/availability?${query.toString()}`, params.accessToken);
  const data = (await response.json()) as { data?: { slots?: Record<string, CalcomSlot[]> } };

  if (!data.data?.slots) {
    return [];
  }

  return Object.values(data.data.slots).flat();
}

// OAuth-based booking creation (v2 API)
export async function createCalcomBookingOAuth(params: {
  accessToken: string;
  eventTypeId: number;
  start: string;
  timezone: string;
  name: string;
  email: string;
  notes?: string;
}): Promise<CalcomBookingResult> {
  const response = await calcomOAuthFetch("/bookings", params.accessToken, {
    method: "POST",
    body: JSON.stringify({
      eventTypeId: params.eventTypeId,
      start: params.start,
      timeZone: params.timezone,
      language: "da",
      responses: {
        name: params.name,
        email: params.email,
        notes: params.notes ?? "",
      },
    }),
  });

  const data = (await response.json()) as { data?: { id: number; uid: string; status: string } };

  if (!data.data) {
    throw new Error("Invalid booking response from Cal.com");
  }

  return {
    id: data.data.id,
    uid: data.data.uid,
    status: data.data.status,
  };
}
