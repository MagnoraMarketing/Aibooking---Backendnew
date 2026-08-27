import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

const appointmentRows: Array<Record<string, unknown>> = [];
const updates: Array<{ id: unknown; patch: Record<string, unknown> }> = [];
let existingAppointment: { id: string } | null = null;
let connection: { customer_id: string; widget_id: string } | null = null;

vi.mock("@/lib/database/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table === "appointments") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: existingAppointment, error: null }) }),
          }),
          insert: async (row: Record<string, unknown>) => {
            appointmentRows.push(row);
            return { error: null };
          },
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: unknown) => {
              updates.push({ id, patch });
              return { error: null };
            },
          }),
        };
      }
      // calendar_connections
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: connection, error: null }),
      };
      return chain;
    },
  }),
}));

import { POST } from "@/app/api/webhooks/calcom/route";

const SECRET = "whsec_test";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
}

function post(body: unknown, signature?: string): Promise<Response> {
  const raw = JSON.stringify(body);
  return POST(
    new Request("https://example.com/api/webhooks/calcom", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signature === undefined ? { "x-cal-signature-256": sign(raw) } : signature ? { "x-cal-signature-256": signature } : {}),
      },
      body: raw,
    })
  ) as unknown as Promise<Response>;
}

beforeEach(() => {
  process.env.CALCOM_WEBHOOK_SECRET = SECRET;
  appointmentRows.length = 0;
  updates.length = 0;
  existingAppointment = null;
  connection = null;
});

describe("Cal.com webhook signature", () => {
  it("rejects a delivery with no signature", async () => {
    const res = await post({ triggerEvent: "BOOKING_CANCELLED", payload: { uid: "a" } }, "");
    expect(res.status).toBe(401);
  });

  it("rejects a delivery signed with the wrong secret", async () => {
    const raw = JSON.stringify({ triggerEvent: "BOOKING_CANCELLED", payload: { uid: "a" } });
    const wrong = createHmac("sha256", "not-the-secret").update(raw, "utf8").digest("hex");
    const res = await post({ triggerEvent: "BOOKING_CANCELLED", payload: { uid: "a" } }, wrong);
    expect(res.status).toBe(401);
  });

  it("rejects a tampered body that keeps a valid-looking signature", async () => {
    const original = JSON.stringify({ triggerEvent: "BOOKING_CANCELLED", payload: { uid: "a" } });
    const res = await post({ triggerEvent: "BOOKING_CANCELLED", payload: { uid: "TAMPERED" } }, sign(original));
    expect(res.status).toBe(401);
  });

  it("writes nothing when no secret is configured", async () => {
    delete process.env.CALCOM_WEBHOOK_SECRET;
    existingAppointment = { id: "appt-1" };

    const res = await post({ triggerEvent: "BOOKING_CANCELLED", payload: { uid: "a" } });

    expect(res.status).toBe(202);
    expect(updates).toHaveLength(0);
    expect(appointmentRows).toHaveLength(0);
  });
});

describe("Cal.com webhook effects", () => {
  it("marks a known booking cancelled", async () => {
    existingAppointment = { id: "appt-1" };

    const res = await post({ triggerEvent: "BOOKING_CANCELLED", payload: { uid: "bk_1" } });

    expect(res.status).toBe(200);
    expect(updates.at(-1)?.patch).toMatchObject({ status: "cancelled" });
  });

  it("moves a known booking on reschedule", async () => {
    existingAppointment = { id: "appt-1" };

    await post({
      triggerEvent: "BOOKING_RESCHEDULED",
      payload: { uid: "bk_1", startTime: "2026-09-02T11:00:00+02:00" },
    });

    expect(updates.at(-1)?.patch).toMatchObject({
      status: "booked",
      appointment_time: "2026-09-02T11:00:00+02:00",
    });
  });

  it("adopts a booking made outside the agent via its event type", async () => {
    connection = { customer_id: "cust-a", widget_id: "widget-a" };

    await post({
      triggerEvent: "BOOKING_CREATED",
      payload: {
        uid: "bk_2",
        bookingId: 12,
        eventTypeId: 42,
        startTime: "2026-09-03T09:00:00+02:00",
        attendees: [{ name: "Ida" }],
      },
    });

    expect(appointmentRows.at(-1)).toMatchObject({
      customer_id: "cust-a",
      widget_id: "widget-a",
      customer_name: "Ida",
      status: "booked",
      calcom_booking_uid: "bk_2",
    });
  });

  it("ignores a booking whose event type belongs to no customer", async () => {
    connection = null;

    const res = await post({
      triggerEvent: "BOOKING_CREATED",
      payload: { uid: "bk_3", eventTypeId: 999, startTime: "2026-09-03T09:00:00+02:00" },
    });

    expect(res.status).toBe(200);
    expect(appointmentRows).toHaveLength(0);
  });

  it("acknowledges trigger types it does not handle", async () => {
    const res = await post({ triggerEvent: "FORM_SUBMITTED", payload: { uid: "x" } });

    expect(res.status).toBe(200);
    expect(appointmentRows).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
