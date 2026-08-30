import { describe, it, expect, vi, beforeEach } from "vitest";

// The Cal.com layer is mocked so these tests assert our own guard logic —
// who a tool call is allowed to act for, and what the agent is told when it
// isn't allowed — without reaching the network.
const fetchCalcomAvailability = vi.fn();
const createCalcomBooking = vi.fn();
const fetchCalcomEventTypes = vi.fn();
const findUpcomingCalcomBooking = vi.fn();
const rescheduleCalcomBooking = vi.fn();
const cancelCalcomBooking = vi.fn();

// No Google/Outlook connection in these tests — getCalendarDetails should
// never get past the calcom branch when one is connected, and these mocks
// let it fall through safely (returning null) for the "nothing connected"
// cases without hitting the network.
const getOAuthCalendarSession = vi.fn().mockResolvedValue(null);
const refreshGoogleToken = vi.fn();
const refreshOutlookToken = vi.fn();
const fetchGoogleFreeBusy = vi.fn();
const createGoogleBooking = vi.fn();
const findUpcomingGoogleBooking = vi.fn();
const rescheduleGoogleBooking = vi.fn();
const cancelGoogleBooking = vi.fn();
const fetchOutlookFreeBusy = vi.fn();
const createOutlookBooking = vi.fn();
const findUpcomingOutlookBooking = vi.fn();
const rescheduleOutlookBooking = vi.fn();
const cancelOutlookBooking = vi.fn();
const generateBusinessHourSlots = vi.fn();

vi.mock("@/lib/calendar", () => ({
  fetchCalcomAvailability: (...args: unknown[]) => fetchCalcomAvailability(...args),
  createCalcomBooking: (...args: unknown[]) => createCalcomBooking(...args),
  fetchCalcomEventTypes: (...args: unknown[]) => fetchCalcomEventTypes(...args),
  findUpcomingCalcomBooking: (...args: unknown[]) => findUpcomingCalcomBooking(...args),
  rescheduleCalcomBooking: (...args: unknown[]) => rescheduleCalcomBooking(...args),
  cancelCalcomBooking: (...args: unknown[]) => cancelCalcomBooking(...args),
  getOAuthCalendarSession: (...args: unknown[]) => getOAuthCalendarSession(...args),
  refreshGoogleToken: (...args: unknown[]) => refreshGoogleToken(...args),
  refreshOutlookToken: (...args: unknown[]) => refreshOutlookToken(...args),
  fetchGoogleFreeBusy: (...args: unknown[]) => fetchGoogleFreeBusy(...args),
  createGoogleBooking: (...args: unknown[]) => createGoogleBooking(...args),
  findUpcomingGoogleBooking: (...args: unknown[]) => findUpcomingGoogleBooking(...args),
  rescheduleGoogleBooking: (...args: unknown[]) => rescheduleGoogleBooking(...args),
  cancelGoogleBooking: (...args: unknown[]) => cancelGoogleBooking(...args),
  fetchOutlookFreeBusy: (...args: unknown[]) => fetchOutlookFreeBusy(...args),
  createOutlookBooking: (...args: unknown[]) => createOutlookBooking(...args),
  findUpcomingOutlookBooking: (...args: unknown[]) => findUpcomingOutlookBooking(...args),
  rescheduleOutlookBooking: (...args: unknown[]) => rescheduleOutlookBooking(...args),
  cancelOutlookBooking: (...args: unknown[]) => cancelOutlookBooking(...args),
  generateBusinessHourSlots: (...args: unknown[]) => generateBusinessHourSlots(...args),
}));

vi.mock("@/lib/security", () => ({
  decryptSecret: (value: string) => `decrypted:${value}`,
}));

interface CalendarRow {
  calcom_api_key: string | null;
  calcom_event_type_id: string | null;
  calcom_timezone: string | null;
}

let calendarRow: CalendarRow | null = null;
const insertedAppointments: Array<Record<string, unknown>> = [];
const updatedAppointments: Array<{
  patch: Record<string, unknown>;
  filters: Record<string, unknown>;
}> = [];

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table === "appointments") {
        return {
          insert: async (row: Record<string, unknown>) => {
            insertedAppointments.push(row);
            return { error: null };
          },
          // Mirrors postgrest-js: update() returns a builder whose eq() calls
          // chain, and the builder is awaited at the end.
          update: (patch: Record<string, unknown>) => {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq(column: string, value: unknown) {
                filters[column] = value;
                return builder;
              },
              then(resolve: (result: { error: null }) => void) {
                updatedAppointments.push({ patch, filters });
                resolve({ error: null });
              },
            };
            return builder;
          },
        };
      }
      // calendar_connections — chainable eq() ending in maybeSingle().
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: calendarRow, error: null }),
      };
      return chain;
    },
  }),
}));

import {
  checkAvailability,
  createBooking,
  getEventTypes,
  getBooking,
  rescheduleBooking,
  cancelBooking,
  executeBookingTool,
} from "@/lib/vapi/booking-tools";

const CONNECTED: CalendarRow = {
  calcom_api_key: "cipher",
  calcom_event_type_id: "42",
  calcom_timezone: "Europe/Copenhagen",
};

const ENABLED = { customerId: "cust-a", widgetId: "widget-a", bookingEnabled: true };
const DISABLED = { customerId: "cust-a", widgetId: "widget-a", bookingEnabled: false };

beforeEach(() => {
  calendarRow = CONNECTED;
  insertedAppointments.length = 0;
  updatedAppointments.length = 0;
  fetchCalcomAvailability.mockReset();
  createCalcomBooking.mockReset();
  fetchCalcomEventTypes.mockReset();
  findUpcomingCalcomBooking.mockReset();
  rescheduleCalcomBooking.mockReset();
  cancelCalcomBooking.mockReset();
  getOAuthCalendarSession.mockReset().mockResolvedValue(null);
});

const EXISTING_BOOKING = {
  id: 7,
  uid: "bk_7",
  title: "Klipning",
  startTime: "2026-09-01T10:00:00+02:00",
  endTime: "2026-09-01T10:30:00+02:00",
  status: "accepted",
  attendeeEmails: ["a@b.dk"],
};

describe("booking tools: the agent must never invent a booking", () => {
  it("does not call Cal.com at all when booking is not enabled", async () => {
    const reply = await checkAvailability({}, DISABLED);

    expect(fetchCalcomAvailability).not.toHaveBeenCalled();
    expect(reply).toContain("ikke sat op");
  });

  it("does not book when booking is not enabled", async () => {
    const reply = await createBooking(
      { start_time: "2026-09-01T10:00:00+02:00", customer_name: "A", customer_email: "a@b.dk" },
      DISABLED
    );

    expect(createCalcomBooking).not.toHaveBeenCalled();
    expect(reply).toContain("ikke sat op");
  });

  it("does not call Cal.com when no calendar is connected", async () => {
    calendarRow = null;

    expect(await checkAvailability({}, ENABLED)).toContain("ikke sat op");
    expect(fetchCalcomAvailability).not.toHaveBeenCalled();
  });

  it("tells the agent a failed booking was NOT made", async () => {
    createCalcomBooking.mockRejectedValue(new Error("slot taken"));

    const reply = await createBooking(
      { start_time: "2026-09-01T10:00:00+02:00", customer_name: "A", customer_email: "a@b.dk" },
      ENABLED
    );

    expect(reply).toContain("IKKE");
    // A failed attempt is still recorded, so the dashboard shows the miss.
    expect(insertedAppointments.at(-1)).toMatchObject({ status: "failed", customer_id: "cust-a" });
  });

  it("reports an outage as no available times rather than a confirmation", async () => {
    fetchCalcomAvailability.mockRejectedValue(new Error("cal.com down"));

    const reply = await checkAvailability({}, ENABLED);

    expect(reply).not.toMatch(/ledige tider \(/i);
    expect(reply.toLowerCase()).toContain("ingen tider");
  });

  it("only offers times Cal.com actually returned", async () => {
    fetchCalcomAvailability.mockResolvedValue([
      { time: "2026-09-01T10:00:00+02:00" },
      { time: "2026-09-01T11:00:00+02:00" },
    ]);

    const reply = await checkAvailability({ date: "2026-09-01" }, ENABLED);

    expect(reply).toContain("2026-09-01T10:00:00+02:00");
    expect(reply).toContain("2026-09-01T11:00:00+02:00");
  });

  it("rejects an unparseable date instead of querying a garbage window", async () => {
    const reply = await checkAvailability({ date: "i morgen" }, ENABLED);

    expect(fetchCalcomAvailability).not.toHaveBeenCalled();
    expect(reply).toContain("ikke forstået");
  });

  it("records the booking against the resolved customer, not any caller input", async () => {
    createCalcomBooking.mockResolvedValue({ id: 1, uid: "bk_1", status: "accepted" });

    await createBooking(
      { start_time: "2026-09-01T10:00:00+02:00", customer_name: "A", customer_email: "a@b.dk" },
      ENABLED
    );

    expect(insertedAppointments.at(-1)).toMatchObject({
      customer_id: "cust-a",
      widget_id: "widget-a",
      status: "booked",
    });
  });

  it("passes the decrypted key to Cal.com and never the stored ciphertext", async () => {
    fetchCalcomAvailability.mockResolvedValue([{ time: "2026-09-01T10:00:00+02:00" }]);

    await checkAvailability({}, ENABLED);

    expect(fetchCalcomAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "decrypted:cipher", eventTypeId: 42 })
    );
  });
});

describe("reschedule and cancel act only on a booking that was found", () => {
  it("does not reschedule when no booking matches the email", async () => {
    findUpcomingCalcomBooking.mockResolvedValue(null);

    const reply = await rescheduleBooking(
      { customer_email: "nobody@b.dk", new_start_time: "2026-09-02T10:00:00+02:00" },
      ENABLED
    );

    expect(rescheduleCalcomBooking).not.toHaveBeenCalled();
    expect(reply).toContain("ikke flyttet");
  });

  it("does not cancel when no booking matches the email", async () => {
    findUpcomingCalcomBooking.mockResolvedValue(null);

    const reply = await cancelBooking({ customer_email: "nobody@b.dk" }, ENABLED);

    expect(cancelCalcomBooking).not.toHaveBeenCalled();
    expect(reply).toContain("ikke aflyst");
  });

  it("moves the existing booking rather than creating a second one", async () => {
    findUpcomingCalcomBooking.mockResolvedValue(EXISTING_BOOKING);
    rescheduleCalcomBooking.mockResolvedValue({
      ...EXISTING_BOOKING,
      startTime: "2026-09-02T11:00:00+02:00",
    });

    const reply = await rescheduleBooking(
      { customer_email: "a@b.dk", new_start_time: "2026-09-02T11:00:00+02:00" },
      ENABLED
    );

    expect(rescheduleCalcomBooking).toHaveBeenCalledWith(
      expect.objectContaining({ booking: EXISTING_BOOKING, newStart: "2026-09-02T11:00:00+02:00" })
    );
    // Never a fresh booking alongside the old one, in Cal.com or in our own
    // records — one appointment stays one row, moved to the new time.
    expect(createCalcomBooking).not.toHaveBeenCalled();
    expect(insertedAppointments).toHaveLength(0);
    expect(updatedAppointments.at(-1)).toMatchObject({
      patch: { appointment_time: "2026-09-02T11:00:00+02:00", status: "booked" },
      filters: { customer_id: "cust-a", calcom_booking_uid: "bk_7" },
    });
    expect(reply).toContain("2026-09-02T11:00:00+02:00");
  });

  it("says the original time still stands when a reschedule fails", async () => {
    findUpcomingCalcomBooking.mockResolvedValue(EXISTING_BOOKING);
    rescheduleCalcomBooking.mockRejectedValue(new Error("cal.com rejected"));

    const reply = await rescheduleBooking(
      { customer_email: "a@b.dk", new_start_time: "2026-09-02T11:00:00+02:00" },
      ENABLED
    );

    expect(reply).toContain("IKKE");
    expect(reply).toContain("oprindelige");
  });

  it("says the booking still stands when a cancel fails", async () => {
    findUpcomingCalcomBooking.mockResolvedValue(EXISTING_BOOKING);
    cancelCalcomBooking.mockRejectedValue(new Error("cal.com rejected"));

    const reply = await cancelBooking({ customer_email: "a@b.dk" }, ENABLED);

    expect(reply).toContain("IKKE");
    expect(reply.toLowerCase()).toContain("står stadig");
    // A failed cancel must not mark our own row cancelled — the appointment
    // is still in the calendar and must still show as upcoming.
    expect(updatedAppointments).toHaveLength(0);
  });

  it("marks our own row cancelled once Cal.com confirms", async () => {
    findUpcomingCalcomBooking.mockResolvedValue(EXISTING_BOOKING);
    cancelCalcomBooking.mockResolvedValue(undefined);

    await cancelBooking({ customer_email: "a@b.dk" }, ENABLED);

    expect(updatedAppointments.at(-1)).toMatchObject({
      patch: { status: "cancelled" },
      filters: { customer_id: "cust-a", calcom_booking_uid: "bk_7" },
    });
  });

  it("rejects an unparseable new time before touching Cal.com", async () => {
    const reply = await rescheduleBooking(
      { customer_email: "a@b.dk", new_start_time: "på fredag" },
      ENABLED
    );

    expect(findUpcomingCalcomBooking).not.toHaveBeenCalled();
    expect(reply).toContain("ikke forstået");
  });

  it("refuses reschedule and cancel outright when booking is disabled", async () => {
    expect(await rescheduleBooking({ customer_email: "a@b.dk", new_start_time: "2026-09-02T11:00:00+02:00" }, DISABLED)).toContain("ikke sat op");
    expect(await cancelBooking({ customer_email: "a@b.dk" }, DISABLED)).toContain("ikke sat op");
    expect(await getBooking({ customer_email: "a@b.dk" }, DISABLED)).toContain("ikke sat op");
    expect(await getEventTypes(DISABLED)).toContain("ikke sat op");
    expect(findUpcomingCalcomBooking).not.toHaveBeenCalled();
  });
});

describe("service list and lookup", () => {
  it("reports the real services with their durations", async () => {
    fetchCalcomEventTypes.mockResolvedValue([
      { id: 1, title: "Klipning", lengthMinutes: 30 },
      { id: 2, title: "Farvning", lengthMinutes: 90 },
    ]);

    const reply = await getEventTypes(ENABLED);

    expect(reply).toContain("Klipning (30 min.)");
    expect(reply).toContain("Farvning (90 min.)");
  });

  it("says there is nothing bookable when no services exist", async () => {
    fetchCalcomEventTypes.mockResolvedValue([]);

    expect(await getEventTypes(ENABLED)).toContain("ingen ydelser");
  });

  it("asks for the email instead of guessing a booking", async () => {
    const reply = await getBooking({}, ENABLED);

    expect(findUpcomingCalcomBooking).not.toHaveBeenCalled();
    expect(reply.toLowerCase()).toContain("email");
  });
});

describe("tool dispatch", () => {
  it("routes every registered tool name", async () => {
    fetchCalcomEventTypes.mockResolvedValue([{ id: 1, title: "Klipning", lengthMinutes: 30 }]);
    fetchCalcomAvailability.mockResolvedValue([{ time: "2026-09-01T10:00:00+02:00" }]);
    findUpcomingCalcomBooking.mockResolvedValue(EXISTING_BOOKING);
    rescheduleCalcomBooking.mockResolvedValue(EXISTING_BOOKING);
    cancelCalcomBooking.mockResolvedValue(undefined);
    createCalcomBooking.mockResolvedValue({ id: 1, uid: "bk_1", status: "accepted" });

    const names = [
      "get_event_types",
      "check_availability",
      "get_booking",
      "reschedule_booking",
      "cancel_booking",
      "create_booking",
    ];

    for (const name of names) {
      const result = await executeBookingTool(
        name,
        {
          customer_email: "a@b.dk",
          new_start_time: "2026-09-02T11:00:00+02:00",
          start_time: "2026-09-02T11:00:00+02:00",
          customer_name: "A",
        },
        ENABLED
      );
      expect(result, `tool ${name}`).not.toBe("Den funktion findes ikke.");
    }
  });

  it("returns a spoken-safe string for an unknown tool", async () => {
    expect(await executeBookingTool("drop_database", {}, ENABLED)).toBe("Den funktion findes ikke.");
  });
});

describe("Google/Outlook calendars (no Cal.com connection)", () => {
  const GOOGLE_SESSION = {
    connectionId: "conn-1",
    accessToken: "google-token",
    calendarId: "primary",
    accountEmail: "biz@example.com",
    durationMinutes: 30,
  };

  const OUTLOOK_SESSION = {
    connectionId: "conn-2",
    accessToken: "outlook-token",
    calendarId: "primary",
    accountEmail: "biz@outlook.com",
    durationMinutes: 45,
  };

  beforeEach(() => {
    // No calcom connection — getCalendarDetails falls through to the OAuth
    // providers.
    calendarRow = null;
  });

  it("checks availability against Google when only Google is connected", async () => {
    getOAuthCalendarSession.mockImplementation(async (_widgetId: string, provider: string) =>
      provider === "google" ? GOOGLE_SESSION : null
    );
    fetchGoogleFreeBusy.mockResolvedValue([]);
    generateBusinessHourSlots.mockReturnValue(["2026-09-01T09:00:00.000Z"]);

    const reply = await checkAvailability({ date: "2026-09-01" }, ENABLED);

    expect(fetchGoogleFreeBusy).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "google-token" }));
    expect(reply).toContain("2026-09-01T09:00:00.000Z");
  });

  it("checks availability against Outlook when only Outlook is connected", async () => {
    getOAuthCalendarSession.mockImplementation(async (_widgetId: string, provider: string) =>
      provider === "outlook" ? OUTLOOK_SESSION : null
    );
    fetchOutlookFreeBusy.mockResolvedValue([]);
    generateBusinessHourSlots.mockReturnValue(["2026-09-01T09:00:00.000Z"]);

    const reply = await checkAvailability({ date: "2026-09-01" }, ENABLED);

    expect(fetchOutlookFreeBusy).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "outlook-token", scheduleEmail: "biz@outlook.com" })
    );
    expect(reply).toContain("2026-09-01T09:00:00.000Z");
  });

  it("books into Google Calendar and records the generic appointment columns", async () => {
    getOAuthCalendarSession.mockImplementation(async (_widgetId: string, provider: string) =>
      provider === "google" ? GOOGLE_SESSION : null
    );
    createGoogleBooking.mockResolvedValue({
      id: "evt_1",
      startTime: "2026-09-01T10:00:00+02:00",
      endTime: "2026-09-01T10:30:00+02:00",
      attendeeEmails: ["a@b.dk"],
    });

    await createBooking(
      { start_time: "2026-09-01T10:00:00+02:00", customer_name: "A", customer_email: "a@b.dk" },
      ENABLED
    );

    expect(createGoogleBooking).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "google-token", durationMinutes: 30 })
    );
    expect(insertedAppointments.at(-1)).toMatchObject({
      status: "booked",
      calendar_provider: "google",
      external_event_id: "evt_1",
    });
    // Never the calcom-specific columns for a Google booking.
    expect(insertedAppointments.at(-1)).not.toHaveProperty("calcom_booking_uid");
  });

  it("never invents a Google booking that failed", async () => {
    getOAuthCalendarSession.mockImplementation(async (_widgetId: string, provider: string) =>
      provider === "google" ? GOOGLE_SESSION : null
    );
    createGoogleBooking.mockRejectedValue(new Error("Google rejected"));

    const reply = await createBooking(
      { start_time: "2026-09-01T10:00:00+02:00", customer_name: "A", customer_email: "a@b.dk" },
      ENABLED
    );

    expect(reply).toContain("IKKE");
    expect(insertedAppointments.at(-1)).toMatchObject({ status: "failed" });
  });

  it("reschedules an existing Outlook booking by its external event id", async () => {
    getOAuthCalendarSession.mockImplementation(async (_widgetId: string, provider: string) =>
      provider === "outlook" ? OUTLOOK_SESSION : null
    );
    const existing = {
      id: "evt_9",
      startTime: "2026-09-01T10:00:00Z",
      endTime: "2026-09-01T10:45:00Z",
      attendeeEmails: ["a@b.dk"],
    };
    findUpcomingOutlookBooking.mockResolvedValue(existing);
    rescheduleOutlookBooking.mockResolvedValue({ ...existing, startTime: "2026-09-02T11:00:00Z" });

    const reply = await rescheduleBooking(
      { customer_email: "a@b.dk", new_start_time: "2026-09-02T11:00:00Z" },
      ENABLED
    );

    expect(rescheduleOutlookBooking).toHaveBeenCalledWith(expect.objectContaining({ booking: existing }));
    expect(updatedAppointments.at(-1)).toMatchObject({
      patch: { appointment_time: "2026-09-02T11:00:00Z", status: "booked" },
      filters: { customer_id: "cust-a", calendar_provider: "outlook", external_event_id: "evt_9" },
    });
    expect(reply).toContain("2026-09-02T11:00:00Z");
  });

  it("does not touch Google/Outlook at all when a Cal.com calendar is connected", async () => {
    calendarRow = CONNECTED;
    fetchCalcomAvailability.mockResolvedValue([{ time: "2026-09-01T10:00:00+02:00" }]);
    getOAuthCalendarSession.mockClear();

    await checkAvailability({}, ENABLED);

    expect(getOAuthCalendarSession).not.toHaveBeenCalled();
  });

  it("reports no calendar set up when neither Cal.com nor an OAuth calendar is connected", async () => {
    getOAuthCalendarSession.mockResolvedValue(null);

    expect(await checkAvailability({}, ENABLED)).toContain("ikke sat op");
  });
});
