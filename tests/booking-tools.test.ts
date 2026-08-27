import { describe, it, expect, vi, beforeEach } from "vitest";

// The Cal.com layer is mocked so these tests assert our own guard logic —
// who a tool call is allowed to act for, and what the agent is told when it
// isn't allowed — without reaching the network.
const fetchCalcomAvailability = vi.fn();
const createCalcomBooking = vi.fn();

vi.mock("@/lib/calendar", () => ({
  fetchCalcomAvailability: (...args: unknown[]) => fetchCalcomAvailability(...args),
  createCalcomBooking: (...args: unknown[]) => createCalcomBooking(...args),
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

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table === "appointments") {
        return {
          insert: async (row: Record<string, unknown>) => {
            insertedAppointments.push(row);
            return { error: null };
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

import { checkAvailability, createBooking } from "@/lib/vapi/booking-tools";

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
  fetchCalcomAvailability.mockReset();
  createCalcomBooking.mockReset();
});

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
