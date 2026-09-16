import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Cal.com decommissioned API v1 on 28 February 2026: every v1 call answers
// 410, which took down connecting a calendar and every booking tool the agent
// has. These tests pin the v2 wire format — the URL, the Bearer header, the
// cal-api-version per endpoint group and the renamed fields — because
// api.cal.com is not reachable from CI, so nothing else here would notice a
// v1 call sneaking back in.

import {
  fetchCalcomMe,
  fetchCalcomEventTypes,
  fetchCalcomAvailability,
  createCalcomBooking,
  findUpcomingCalcomBooking,
  rescheduleCalcomBooking,
  cancelCalcomBooking,
} from "@/lib/calendar/calcom";

const API_KEY = "cal_live_abc123";

const fetchMock = vi.fn();
const originalFetch = global.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function callAt(index: number): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[index]!;
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

function headerAt(index: number, name: string): string | undefined {
  return (callAt(index).init.headers as Record<string, string> | undefined)?.[name];
}

function bodyAt(index: number): Record<string, unknown> {
  return JSON.parse(String(callAt(index).init.body)) as Record<string, unknown>;
}

const ME = { data: { id: 1, username: "klinikken", email: "kontakt@klinikken.dk", timeZone: "Europe/Copenhagen" } };

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  global.fetch = originalFetch;
});

describe("every Cal.com call", () => {
  it("goes to v2 with the key as a Bearer token, never v1's ?apiKey=", async () => {
    fetchMock.mockResolvedValue(jsonResponse(ME));

    await fetchCalcomMe(API_KEY);

    const { url } = callAt(0);
    expect(url).toBe("https://api.cal.com/v2/me");
    expect(url).not.toContain("apiKey=");
    expect(headerAt(0, "Authorization")).toBe(`Bearer ${API_KEY}`);
  });

  // A revoked or mistyped key is the customer's problem to fix, and the
  // dashboard says so; anything else is ours.
  it("turns a 401 into the 'invalid key' message, not a 500", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));

    await expect(fetchCalcomMe(API_KEY)).rejects.toThrow("Ugyldig Cal.com API-nøgle.");
  });

  it("surfaces Cal.com's own message on any other failure", async () => {
    fetchMock.mockResolvedValue(new Response("event type not found", { status: 404 }));

    await expect(fetchCalcomMe(API_KEY)).rejects.toThrow(/404.*event type not found/);
  });
});

describe("event types", () => {
  it("asks for the key owner's own types and reads v2's lengthInMinutes", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(ME))
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 7095882, title: "Konsultation", lengthInMinutes: 30 }] })
      );

    const types = await fetchCalcomEventTypes(API_KEY);

    expect(callAt(1).url).toBe("https://api.cal.com/v2/event-types?username=klinikken");
    expect(headerAt(1, "cal-api-version")).toBe("2024-06-14");
    expect(types).toEqual([{ id: 7095882, title: "Konsultation", lengthMinutes: 30 }]);
  });

  // An account with no types is a real answer — the customer then types the
  // event-type id by hand, which the Booking tab allows.
  it("returns an empty list rather than throwing when Cal.com reports none", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(ME)).mockResolvedValueOnce(jsonResponse({ data: null }));

    await expect(fetchCalcomEventTypes(API_KEY)).resolves.toEqual([]);
  });
});

describe("availability", () => {
  it("uses /slots with start/end and flattens v2's per-day grouping", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          "2026-03-15": [{ start: "2026-03-15T09:00:00.000Z" }, { start: "2026-03-15T10:00:00.000Z" }],
          "2026-03-16": [{ start: "2026-03-16T09:00:00.000Z" }],
        },
      })
    );

    const slots = await fetchCalcomAvailability({
      apiKey: API_KEY,
      eventTypeId: 7095882,
      startTime: "2026-03-15T00:00:00.000Z",
      endTime: "2026-03-22T00:00:00.000Z",
      timezone: "Europe/Copenhagen",
    });

    const { url } = callAt(0);
    expect(url).toContain("https://api.cal.com/v2/slots?");
    expect(url).toContain("eventTypeId=7095882");
    expect(url).toContain("start=2026-03-15T00%3A00%3A00.000Z");
    expect(url).toContain("end=2026-03-22T00%3A00%3A00.000Z");
    expect(url).toContain("timeZone=Europe%2FCopenhagen");
    expect(headerAt(0, "cal-api-version")).toBe("2024-09-04");
    expect(slots.map((slot) => slot.time)).toEqual([
      "2026-03-15T09:00:00.000Z",
      "2026-03-15T10:00:00.000Z",
      "2026-03-16T09:00:00.000Z",
    ]);
  });
});

describe("creating a booking", () => {
  it("sends v2's attendee object and a UTC start", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { id: 42, uid: "bk_42", status: "accepted" } }));

    const booking = await createCalcomBooking({
      apiKey: API_KEY,
      eventTypeId: 7095882,
      // The agent speaks local time — Cal.com v2 wants UTC.
      start: "2026-03-15T14:00:00+01:00",
      timezone: "Europe/Copenhagen",
      name: "Mette Hansen",
      email: "mette@example.dk",
    });

    expect(callAt(0).url).toBe("https://api.cal.com/v2/bookings");
    expect(callAt(0).init.method).toBe("POST");
    expect(headerAt(0, "cal-api-version")).toBe("2024-08-13");
    expect(bodyAt(0)).toEqual({
      start: "2026-03-15T13:00:00.000Z",
      eventTypeId: 7095882,
      attendee: {
        name: "Mette Hansen",
        email: "mette@example.dk",
        timeZone: "Europe/Copenhagen",
        language: "da",
      },
    });
    expect(booking).toEqual({ id: 42, uid: "bk_42", status: "accepted" });
  });

  // Confirming a booking the agent never got is the worst failure here: the
  // caller hangs up believing they have a time.
  it("throws when Cal.com answers without a booking", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: null }));

    await expect(
      createCalcomBooking({
        apiKey: API_KEY,
        eventTypeId: 7095882,
        start: "2026-03-15T14:00:00+01:00",
        timezone: "Europe/Copenhagen",
        name: "Mette Hansen",
        email: "mette@example.dk",
      })
    ).rejects.toThrow("Cal.com returnerede ingen booking.");
  });
});

describe("finding the caller's booking", () => {
  it("filters on attendee email and upcoming, and reads v2's start/end", async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 42,
            uid: "bk_42",
            title: "Konsultation",
            start: future,
            end: future,
            status: "accepted",
            attendees: [{ email: "mette@example.dk", name: "Mette Hansen" }],
          },
        ],
      })
    );

    const booking = await findUpcomingCalcomBooking({ apiKey: API_KEY, attendeeEmail: "Mette@example.dk" });

    const { url } = callAt(0);
    expect(url).toContain("attendeeEmail=mette%40example.dk");
    expect(url).toContain("status=upcoming");
    expect(booking?.uid).toBe("bk_42");
    expect(booking?.startTime).toBe(future);
  });

  // Cal.com's filters are trusted to narrow, never to be the only guard: a
  // past or cancelled booking reaching "flyt min tid" moves the wrong thing.
  it("still drops a past or cancelled booking Cal.com returned anyway", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          { id: 1, uid: "old", start: past, end: past, status: "accepted", attendees: [{ email: "m@e.dk" }] },
          { id: 2, uid: "gone", start: future, end: future, status: "cancelled", attendees: [{ email: "m@e.dk" }] },
        ],
      })
    );

    await expect(findUpcomingCalcomBooking({ apiKey: API_KEY, attendeeEmail: "m@e.dk" })).resolves.toBeNull();
  });
});

describe("rescheduling", () => {
  const EXISTING = {
    id: 42,
    uid: "bk_42",
    title: "Konsultation",
    startTime: "2026-03-15T13:00:00.000Z",
    endTime: "2026-03-15T13:30:00.000Z",
    status: "accepted",
    attendeeEmails: ["mette@example.dk"],
  };

  // v2 cancels the old booking and answers with a new uid — the caller has to
  // store that one, or the next reschedule points at a cancelled booking.
  it("POSTs to the booking's reschedule route and returns the new uid", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          id: 43,
          uid: "bk_43",
          title: "Konsultation",
          start: "2026-03-16T13:00:00.000Z",
          end: "2026-03-16T13:30:00.000Z",
          status: "accepted",
          attendees: [{ email: "mette@example.dk" }],
        },
      })
    );

    const updated = await rescheduleCalcomBooking({
      apiKey: API_KEY,
      booking: EXISTING,
      newStart: "2026-03-16T14:00:00+01:00",
    });

    expect(callAt(0).url).toBe("https://api.cal.com/v2/bookings/bk_42/reschedule");
    expect(callAt(0).init.method).toBe("POST");
    expect(bodyAt(0)).toEqual({ start: "2026-03-16T13:00:00.000Z" });
    expect(updated.uid).toBe("bk_43");
    expect(updated.startTime).toBe("2026-03-16T13:00:00.000Z");
  });

  it("keeps the requested time when Cal.com answers with an unreadable body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    const updated = await rescheduleCalcomBooking({
      apiKey: API_KEY,
      booking: EXISTING,
      newStart: "2026-03-16T14:00:00+01:00",
    });

    expect(updated.startTime).toBe("2026-03-16T13:00:00.000Z");
  });
});

describe("cancelling", () => {
  it("POSTs to the booking's cancel route by uid, not by numeric id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { id: 42, uid: "bk_42", status: "cancelled" } }));

    await cancelCalcomBooking({ apiKey: API_KEY, bookingUid: "bk_42", reason: "Aflyst af kunden via telefon" });

    expect(callAt(0).url).toBe("https://api.cal.com/v2/bookings/bk_42/cancel");
    expect(callAt(0).init.method).toBe("POST");
    expect(headerAt(0, "cal-api-version")).toBe("2024-08-13");
    expect(bodyAt(0)).toEqual({ cancellationReason: "Aflyst af kunden via telefon" });
  });
});
