import { describe, it, expect } from "vitest";
import { getZonedParts, zonedTimeToUtc } from "@/lib/calendar/timezone";
import { generateBusinessHourSlots } from "@/lib/calendar/slots";

describe("zonedTimeToUtc / getZonedParts", () => {
  it("round-trips a wall-clock time through a timezone with no DST offset ambiguity", () => {
    // 2026-01-15 09:00 in Copenhagen is CET (UTC+1) in winter.
    const utc = zonedTimeToUtc(2026, 1, 15, 9, 0, "Europe/Copenhagen");
    expect(utc.toISOString()).toBe("2026-01-15T08:00:00.000Z");
  });

  it("accounts for daylight saving time (CEST, UTC+2) in summer", () => {
    // 2026-07-15 09:00 in Copenhagen is CEST (UTC+2) in summer.
    const utc = zonedTimeToUtc(2026, 7, 15, 9, 0, "Europe/Copenhagen");
    expect(utc.toISOString()).toBe("2026-07-15T07:00:00.000Z");
  });

  it("reads back the same local wall-clock time it was built from", () => {
    const utc = zonedTimeToUtc(2026, 3, 3, 14, 30, "Europe/Copenhagen");
    const parts = getZonedParts(utc, "Europe/Copenhagen");
    expect(parts).toMatchObject({ year: 2026, month: 3, day: 3, hour: 14, minute: 30 });
  });

  it("computes the correct weekday", () => {
    // 2026-01-15 is a Thursday.
    const parts = getZonedParts(new Date("2026-01-15T12:00:00Z"), "Europe/Copenhagen");
    expect(parts.weekday).toBe(4);
  });
});

describe("generateBusinessHourSlots", () => {
  const timezone = "Europe/Copenhagen";
  // 2026-01-12 is a Monday.
  const windowStart = new Date("2026-01-12T00:00:00Z");
  const windowEnd = new Date("2026-01-19T00:00:00Z");
  const now = new Date("2026-01-01T00:00:00Z");

  it("only offers business-hours slots, excluding weekends", () => {
    const slots = generateBusinessHourSlots({
      windowStart,
      windowEnd,
      timezone,
      durationMinutes: 60,
      busy: [],
      now,
      maxSlots: 100,
    });

    for (const slot of slots) {
      const parts = getZonedParts(new Date(slot), timezone);
      expect(parts.weekday).not.toBe(0);
      expect(parts.weekday).not.toBe(6);
      expect(parts.hour).toBeGreaterThanOrEqual(9);
      expect(parts.hour).toBeLessThan(17);
    }
  });

  it("excludes slots that overlap a busy interval", () => {
    // 2026-01-12 (Monday) 10:00-11:00 Copenhagen time is 09:00-10:00Z (CET).
    const busy = [{ start: "2026-01-12T09:00:00Z", end: "2026-01-12T10:00:00Z" }];

    const slots = generateBusinessHourSlots({
      windowStart,
      windowEnd: new Date("2026-01-13T00:00:00Z"),
      timezone,
      durationMinutes: 60,
      busy,
      now,
      maxSlots: 100,
    });

    expect(slots).not.toContain("2026-01-12T09:00:00.000Z");
    // The next hour (10:00 local / 09:00Z-10:00Z busy block ends at 10:00Z)
    // should still be offered.
    expect(slots).toContain("2026-01-12T10:00:00.000Z");
  });

  it("never offers a slot in the past", () => {
    const almostNow = new Date("2026-01-12T07:00:00Z"); // 08:00 Copenhagen time
    const slots = generateBusinessHourSlots({
      windowStart,
      windowEnd: new Date("2026-01-13T00:00:00Z"),
      timezone,
      durationMinutes: 60,
      busy: [],
      now: almostNow,
      maxSlots: 100,
    });

    for (const slot of slots) {
      expect(new Date(slot).getTime()).toBeGreaterThan(almostNow.getTime());
    }
  });

  it("respects maxSlots", () => {
    const slots = generateBusinessHourSlots({
      windowStart,
      windowEnd,
      timezone,
      durationMinutes: 30,
      busy: [],
      now,
      maxSlots: 3,
    });
    expect(slots).toHaveLength(3);
  });
});
