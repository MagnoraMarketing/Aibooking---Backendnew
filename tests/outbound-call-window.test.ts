import { describe, it, expect } from "vitest";
import {
  isWithinCallWindow,
  nextWindowOpening,
  parseWallClock,
  formatWallClock,
  type CallWindow,
} from "@/lib/outbound/call-window";

// A campaign launched at 21:00 used to ring a hundred people at 21:00. The
// window is wall-clock time in a place — "09:00 in Denmark" — so it has to
// survive the clocks changing, which is the whole reason it is not stored as
// an offset.

const WEEKDAYS: CallWindow = {
  startMinutes: 9 * 60,
  endMinutes: 17 * 60,
  days: [1, 2, 3, 4, 5],
  timeZone: "Europe/Copenhagen",
};

// Copenhagen is UTC+2 in summer, UTC+1 in winter.
const SUMMER_WEDNESDAY_10 = new Date("2026-07-15T08:00:00Z");
const WINTER_WEDNESDAY_10 = new Date("2026-01-14T09:00:00Z");

describe("whether a campaign may dial right now", () => {
  it("allows a weekday morning inside the window", () => {
    expect(isWithinCallWindow(WEEKDAYS, SUMMER_WEDNESDAY_10)).toBe(true);
  });

  // The same local hour, six months apart, with the country on a different
  // UTC offset. Getting this wrong starts every winter campaign an hour early.
  it("reads the same local hour correctly in winter and in summer", () => {
    expect(isWithinCallWindow(WEEKDAYS, WINTER_WEDNESDAY_10)).toBe(true);
  });

  it("refuses the evening", () => {
    expect(isWithinCallWindow(WEEKDAYS, new Date("2026-07-15T19:00:00Z"))).toBe(false); // 21:00 local
  });

  it("refuses a Saturday inside the hours", () => {
    expect(isWithinCallWindow(WEEKDAYS, new Date("2026-07-18T08:00:00Z"))).toBe(false);
  });

  // The end is exclusive: a window ending at 17:00 must not start a call at
  // 17:00 that runs past it.
  it("treats the closing time as closed", () => {
    expect(isWithinCallWindow(WEEKDAYS, new Date("2026-07-15T15:00:00Z"))).toBe(false); // 17:00 local
    expect(isWithinCallWindow(WEEKDAYS, new Date("2026-07-15T14:59:00Z"))).toBe(true);
  });

  // Not a configuration the UI offers, and reading it as "always" would turn
  // a mistake into phone calls.
  it("refuses a campaign with no days selected rather than calling every day", () => {
    expect(isWithinCallWindow({ ...WEEKDAYS, days: [] }, SUMMER_WEDNESDAY_10)).toBe(false);
  });
});

describe("when the campaign may dial next", () => {
  it("returns now when the window is already open", () => {
    expect(nextWindowOpening(WEEKDAYS, SUMMER_WEDNESDAY_10)).toEqual(SUMMER_WEDNESDAY_10);
  });

  // An evening launch should start in the morning, not throw the list away.
  it("parks an evening launch until the next morning", () => {
    const opening = nextWindowOpening(WEEKDAYS, new Date("2026-07-15T19:00:00Z"))!;

    expect(isWithinCallWindow(WEEKDAYS, opening)).toBe(true);
    expect(opening.toISOString()).toBe("2026-07-16T07:00:00.000Z"); // 09:00 local, Thursday
  });

  it("waits for the morning when launched before the window opens", () => {
    const opening = nextWindowOpening(WEEKDAYS, new Date("2026-07-15T04:00:00Z"))!; // 06:00 local

    expect(opening.toISOString()).toBe("2026-07-15T07:00:00.000Z"); // 09:00 local, same day
  });

  it("skips the weekend", () => {
    const opening = nextWindowOpening(WEEKDAYS, new Date("2026-07-18T08:00:00Z"))!; // Saturday

    expect(isWithinCallWindow(WEEKDAYS, opening)).toBe(true);
    expect(opening.toISOString()).toBe("2026-07-20T07:00:00.000Z"); // Monday 09:00 local
  });

  it("has no answer for a campaign with no days", () => {
    expect(nextWindowOpening({ ...WEEKDAYS, days: [] }, SUMMER_WEDNESDAY_10)).toBeNull();
  });
});

describe("reading and writing the times", () => {
  it("parses what Postgres gives back for a time column", () => {
    expect(parseWallClock("09:00:00")).toBe(540);
    expect(parseWallClock("17:30")).toBe(1050);
  });

  it("writes them back the way the form shows them", () => {
    expect(formatWallClock(540)).toBe("09:00");
    expect(formatWallClock(1050)).toBe("17:30");
  });
});
