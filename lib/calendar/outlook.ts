import "server-only";
import { ApiError } from "@/types/errors";
import type { OAuthTokenResult } from "./types";

// Microsoft 365 / Outlook — the other dominant business calendar in
// Denmark alongside Google Workspace. Uses the Microsoft identity platform
// v2.0 endpoint against the "common" tenant so both work and personal
// Microsoft accounts can connect.
const AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const ME_URL = "https://graph.microsoft.com/v1.0/me";
const SCOPES = ["offline_access", "User.Read", "Calendars.ReadWrite"].join(" ");

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw ApiError.badRequest("Outlook/Microsoft 365 Kalender er ikke konfigureret endnu. Kontakt support.");
  }
  return { clientId, clientSecret };
}

function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/api/customer/calendar/outlook/callback`;
}

export function buildOutlookAuthUrl(state: string): string {
  const { clientId } = getCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    response_mode: "query",
    scope: SCOPES,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeOutlookCode(code: string): Promise<OAuthTokenResult> {
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
      scope: SCOPES,
    }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text().catch(() => "");
    throw new Error(`Outlook token exchange failed: ${tokenResponse.status} ${body}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  let accountEmail: string | null = null;
  try {
    const meResponse = await fetch(ME_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (meResponse.ok) {
      const meData = (await meResponse.json()) as { mail?: string; userPrincipalName?: string };
      accountEmail = meData.mail ?? meData.userPrincipalName ?? null;
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

export async function refreshOutlookToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: string; newRefreshToken?: string }> {
  const { clientId, clientSecret } = getCredentials();

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      scope: SCOPES,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`Outlook token refresh failed: ${response.status} ${body}`);
    throw new Error("Outlook token refresh failed");
  }

  const data = (await response.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    // Microsoft rotates refresh tokens on every use — unlike Google, the new
    // one always has to be persisted or the next refresh will fail.
    newRefreshToken: data.refresh_token,
  };
}

// ---------------------------------------------------------------------------
// Booking — Microsoft Graph v1.0. Like Google, Outlook has no "event
// type"/duration concept, so callers supply the duration the widget's
// connection was configured with. Bookings are tagged with a
// singleValueExtendedProperty using Microsoft's own documented "Public
// Strings" property-set GUID (00020329-0000-0000-C000-000000000046) so
// findUpcomingOutlookBooking only ever matches bookings this agent made —
// never a pre-existing meeting that happens to include the same attendee.
// ---------------------------------------------------------------------------

const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";
const BOOKING_TAG_PROPERTY_ID = "String {00020329-0000-0000-C000-000000000046} Name aibookingWidgetId";

async function graphFetch(path: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${GRAPH_API_BASE}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
  if (response.status === 401) throw new Error("Microsoft Graph authentication failed");
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw ApiError.internal(`Outlook afviste anmodningen (${response.status}): ${body || "ingen detaljer"}`);
  }
  return response;
}

export interface OutlookFreeBusyInterval {
  start: string;
  end: string;
}

// getSchedule reports busy/tentative/oof blocks for a mailbox — the
// connected account's own email is the "schedule" being queried.
export async function fetchOutlookFreeBusy(params: {
  accessToken: string;
  scheduleEmail: string;
  startTime: string;
  endTime: string;
}): Promise<OutlookFreeBusyInterval[]> {
  const response = await graphFetch("/me/calendar/getSchedule", params.accessToken, {
    method: "POST",
    body: JSON.stringify({
      schedules: [params.scheduleEmail],
      startTime: { dateTime: params.startTime, timeZone: "UTC" },
      endTime: { dateTime: params.endTime, timeZone: "UTC" },
      availabilityViewInterval: 30,
    }),
  });

  const data = (await response.json()) as {
    value?: Array<{ scheduleItems?: Array<{ start: { dateTime: string }; end: { dateTime: string }; status?: string }> }>;
  };

  const items = data.value?.[0]?.scheduleItems ?? [];
  return items
    .filter((item) => item.status !== "free")
    // Graph returns dateTime without a trailing "Z" when timeZone is "UTC" —
    // append it explicitly so `new Date(...)` doesn't parse it as local time.
    .map((item) => ({
      start: item.start.dateTime.endsWith("Z") ? item.start.dateTime : `${item.start.dateTime}Z`,
      end: item.end.dateTime.endsWith("Z") ? item.end.dateTime : `${item.end.dateTime}Z`,
    }));
}

export interface OutlookBooking {
  id: string;
  startTime: string;
  endTime: string;
  attendeeEmails: string[];
}

function parseOutlookEvent(raw: Record<string, unknown>): OutlookBooking | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  const start = (raw.start as { dateTime?: string } | undefined)?.dateTime;
  const end = (raw.end as { dateTime?: string } | undefined)?.dateTime;
  if (!id || !start) return null;

  const attendees = Array.isArray(raw.attendees) ? raw.attendees : [];
  const attendeeEmails = attendees
    .map((a) => (a as { emailAddress?: { address?: unknown } } | null)?.emailAddress?.address)
    .filter((e): e is string => typeof e === "string");

  const normalize = (v: string) => (v.endsWith("Z") ? v : `${v}Z`);
  return { id, startTime: normalize(start), endTime: end ? normalize(end) : normalize(start), attendeeEmails };
}

export async function createOutlookBooking(params: {
  accessToken: string;
  widgetId: string;
  start: string;
  durationMinutes: number;
  timezone: string;
  name: string;
  email: string;
  notes?: string;
}): Promise<OutlookBooking> {
  const end = new Date(new Date(params.start).getTime() + params.durationMinutes * 60 * 1000).toISOString();

  const response = await graphFetch("/me/events", params.accessToken, {
    method: "POST",
    body: JSON.stringify({
      subject: `${params.name} — booket via AIbooking`,
      body: { contentType: "text", content: params.notes ?? "" },
      start: { dateTime: params.start, timeZone: params.timezone },
      end: { dateTime: end, timeZone: params.timezone },
      attendees: [{ emailAddress: { address: params.email, name: params.name }, type: "required" }],
      singleValueExtendedProperties: [{ id: BOOKING_TAG_PROPERTY_ID, value: params.widgetId }],
    }),
  });

  const data = (await response.json()) as Record<string, unknown>;
  const parsed = parseOutlookEvent(data);
  if (!parsed) throw new Error("Invalid booking response from Outlook");
  return parsed;
}

// Only ever matches events this agent created (tagged with the widget id) —
// never a pre-existing meeting that happens to include the same attendee.
export async function findUpcomingOutlookBooking(params: {
  accessToken: string;
  widgetId: string;
  attendeeEmail: string;
}): Promise<OutlookBooking | null> {
  const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${BOOKING_TAG_PROPERTY_ID}' and ep/value eq '${params.widgetId}')`;
  const query = new URLSearchParams({
    $filter: filter,
    $orderby: "start/dateTime",
    $top: "50",
  });

  const response = await graphFetch(`/me/events?${query.toString()}`, params.accessToken);
  const data = (await response.json()) as { value?: Record<string, unknown>[] };
  const wanted = params.attendeeEmail.trim().toLowerCase();
  const now = Date.now();

  const upcoming = (data.value ?? [])
    .map(parseOutlookEvent)
    .filter(
      (e): e is OutlookBooking =>
        e !== null &&
        new Date(e.startTime).getTime() > now &&
        e.attendeeEmails.some((email) => email.toLowerCase() === wanted)
    )
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  return upcoming[0] ?? null;
}

export async function rescheduleOutlookBooking(params: {
  accessToken: string;
  booking: OutlookBooking;
  newStart: string;
  timezone: string;
}): Promise<OutlookBooking> {
  const originalMs = new Date(params.booking.endTime).getTime() - new Date(params.booking.startTime).getTime();
  const durationMs = originalMs > 0 ? originalMs : 30 * 60 * 1000;
  const newEnd = new Date(new Date(params.newStart).getTime() + durationMs).toISOString();

  const response = await graphFetch(`/me/events/${encodeURIComponent(params.booking.id)}`, params.accessToken, {
    method: "PATCH",
    body: JSON.stringify({
      start: { dateTime: params.newStart, timeZone: params.timezone },
      end: { dateTime: newEnd, timeZone: params.timezone },
    }),
  });

  const data = (await response.json()) as Record<string, unknown>;
  return parseOutlookEvent(data) ?? { ...params.booking, startTime: params.newStart, endTime: newEnd };
}

export async function cancelOutlookBooking(params: {
  accessToken: string;
  eventId: string;
  reason: string;
}): Promise<void> {
  // /cancel (rather than DELETE) sends the cancellation notice to attendees,
  // matching Google's sendUpdates=all behavior above.
  await graphFetch(`/me/events/${encodeURIComponent(params.eventId)}/cancel`, params.accessToken, {
    method: "POST",
    body: JSON.stringify({ comment: params.reason }),
  });
}
