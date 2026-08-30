// No-dependency IANA timezone conversion for Google/Outlook slot generation
// (Cal.com does this server-side; here we compute candidate business-hours
// slots ourselves from a freebusy/schedule response, so it has to be done
// correctly — a naive fixed-UTC-offset would be wrong for any timezone with
// DST, including Europe/Copenhagen for roughly half the year).

// What wall-clock date/time a UTC instant reads as in `timeZone`.
export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 (Sun) - 6 (Sat), matching Date#getDay()
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function getZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(instant);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // Midnight is sometimes rendered as "24" by this formatter depending on
  // runtime ICU data; normalize to 0 so downstream hour comparisons are sane.
  const hour = Number(get("hour")) % 24;

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

// Converts a local wall-clock time in `timeZone` to the UTC instant it
// represents. Standard fixed-point trick: guess the instant assuming UTC,
// see what wall time that guess actually reads as in the target zone, and
// correct by the difference — two passes handle the (rare) case where the
// first correction crosses a DST transition.
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  let guess = Date.UTC(year, month - 1, day, hour, minute);

  for (let i = 0; i < 2; i++) {
    const zoned = getZonedParts(new Date(guess), timeZone);
    const zonedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute);
    const wantedAsUtc = Date.UTC(year, month - 1, day, hour, minute);
    const diff = wantedAsUtc - zonedAsUtc;
    if (diff === 0) break;
    guess += diff;
  }

  return new Date(guess);
}
