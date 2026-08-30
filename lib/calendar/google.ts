import "server-only";
import { ApiError } from "@/types/errors";
import type { OAuthTokenResult } from "./types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar"].join(" ");

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw ApiError.badRequest("Google Kalender er ikke konfigureret endnu. Kontakt support.");
  }
  return { clientId, clientSecret };
}

function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/api/customer/calendar/google/callback`;
}

export function buildGoogleAuthUrl(state: string): string {
  const { clientId } = getCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCode(code: string): Promise<OAuthTokenResult> {
  const { clientId, clientSecret } = getCredentials();

  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text().catch(() => "");
    throw new Error(`Google token exchange failed: ${tokenResponse.status} ${body}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  let accountEmail: string | null = null;
  try {
    const userResponse = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (userResponse.ok) {
      const userData = (await userResponse.json()) as { email?: string };
      accountEmail = userData.email ?? null;
    }
  } catch {
    // Non-fatal — the connection still works without a display email.
  }

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    expiresAt: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
    accountEmail,
    calendarId: "primary",
  };
}

export async function refreshGoogleToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: string }> {
  const { clientId, clientSecret } = getCredentials();

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`Google token refresh failed: ${response.status} ${body}`);
    throw new Error("Google token refresh failed");
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  return { accessToken: data.access_token, expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString() };
}

// ---------------------------------------------------------------------------
// Booking — Google Calendar API v3. Unlike Cal.com, a Google calendar has no
// "event type"/duration concept, so callers supply the duration the widget's
// connection was configured with (calendar_connections.default_duration_minutes).
// Every event this creates is tagged with extendedProperties.private so
// findUpcomingGoogleBooking only ever matches bookings the agent itself made
// — never an unrelated meeting that happens to include the same attendee.
// ---------------------------------------------------------------------------

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const BOOKING_TAG_KEY = "aibookingWidgetId";

async function googleFetch(path: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${CALENDAR_API_BASE}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
  if (response.status === 401) throw new Error("Google Calendar authentication failed");
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw ApiError.internal(`Google Calendar afviste anmodningen (${response.status}): ${body || "ingen detaljer"}`);
  }
  return response;
}

export interface GoogleFreeBusyInterval {
  start: string;
  end: string;
}

export async function fetchGoogleFreeBusy(params: {
  accessToken: string;
  calendarId: string;
  startTime: string;
  endTime: string;
}): Promise<GoogleFreeBusyInterval[]> {
  const response = await googleFetch("/freeBusy", params.accessToken, {
    method: "POST",
    body: JSON.stringify({
      timeMin: params.startTime,
      timeMax: params.endTime,
      items: [{ id: params.calendarId }],
    }),
  });
  const data = (await response.json()) as {
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
  };
  return data.calendars?.[params.calendarId]?.busy ?? [];
}

export interface GoogleBooking {
  id: string;
  startTime: string;
  endTime: string;
  attendeeEmails: string[];
}

function parseGoogleEvent(raw: Record<string, unknown>): GoogleBooking | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  const start = (raw.start as { dateTime?: string } | undefined)?.dateTime;
  const end = (raw.end as { dateTime?: string } | undefined)?.dateTime;
  if (!id || !start) return null;

  const attendees = Array.isArray(raw.attendees) ? raw.attendees : [];
  const attendeeEmails = attendees
    .map((a) => (a as { email?: unknown } | null)?.email)
    .filter((e): e is string => typeof e === "string");

  return { id, startTime: start, endTime: end ?? start, attendeeEmails };
}

export async function createGoogleBooking(params: {
  accessToken: string;
  calendarId: string;
  widgetId: string;
  start: string;
  durationMinutes: number;
  timezone: string;
  name: string;
  email: string;
  notes?: string;
}): Promise<GoogleBooking> {
  const end = new Date(new Date(params.start).getTime() + params.durationMinutes * 60 * 1000).toISOString();

  const response = await googleFetch(
    `/calendars/${encodeURIComponent(params.calendarId)}/events?sendUpdates=all`,
    params.accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        summary: `${params.name} — booket via AIbooking`,
        description: params.notes ?? "",
        start: { dateTime: params.start, timeZone: params.timezone },
        end: { dateTime: end, timeZone: params.timezone },
        attendees: [{ email: params.email, displayName: params.name }],
        extendedProperties: { private: { [BOOKING_TAG_KEY]: params.widgetId } },
      }),
    }
  );

  const data = (await response.json()) as Record<string, unknown>;
  const parsed = parseGoogleEvent(data);
  if (!parsed) throw new Error("Invalid booking response from Google Calendar");
  return parsed;
}

// Only ever matches events this agent created (tagged with the widget id) —
// never a pre-existing meeting that happens to include the same attendee.
export async function findUpcomingGoogleBooking(params: {
  accessToken: string;
  calendarId: string;
  widgetId: string;
  attendeeEmail: string;
}): Promise<GoogleBooking | null> {
  const query = new URLSearchParams({
    timeMin: new Date().toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });
  query.append("privateExtendedProperty", `${BOOKING_TAG_KEY}=${params.widgetId}`);

  const response = await googleFetch(
    `/calendars/${encodeURIComponent(params.calendarId)}/events?${query.toString()}`,
    params.accessToken
  );
  const data = (await response.json()) as { items?: Record<string, unknown>[] };
  const wanted = params.attendeeEmail.trim().toLowerCase();

  const upcoming = (data.items ?? [])
    .map(parseGoogleEvent)
    .filter((e): e is GoogleBooking => e !== null && e.attendeeEmails.some((email) => email.toLowerCase() === wanted))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  return upcoming[0] ?? null;
}

export async function rescheduleGoogleBooking(params: {
  accessToken: string;
  calendarId: string;
  booking: GoogleBooking;
  newStart: string;
  timezone: string;
}): Promise<GoogleBooking> {
  const originalMs = new Date(params.booking.endTime).getTime() - new Date(params.booking.startTime).getTime();
  const durationMs = originalMs > 0 ? originalMs : 30 * 60 * 1000;
  const newEnd = new Date(new Date(params.newStart).getTime() + durationMs).toISOString();

  const response = await googleFetch(
    `/calendars/${encodeURIComponent(params.calendarId)}/events/${encodeURIComponent(params.booking.id)}?sendUpdates=all`,
    params.accessToken,
    {
      method: "PATCH",
      body: JSON.stringify({
        start: { dateTime: params.newStart, timeZone: params.timezone },
        end: { dateTime: newEnd, timeZone: params.timezone },
      }),
    }
  );

  const data = (await response.json()) as Record<string, unknown>;
  return parseGoogleEvent(data) ?? { ...params.booking, startTime: params.newStart, endTime: newEnd };
}

export async function cancelGoogleBooking(params: {
  accessToken: string;
  calendarId: string;
  eventId: string;
}): Promise<void> {
  await googleFetch(
    `/calendars/${encodeURIComponent(params.calendarId)}/events/${encodeURIComponent(params.eventId)}?sendUpdates=all`,
    params.accessToken,
    { method: "DELETE" }
  );
}
