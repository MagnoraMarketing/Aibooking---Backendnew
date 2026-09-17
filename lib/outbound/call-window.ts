// When a campaign is allowed to ring someone.
//
// A window is wall-clock time in a place — "09:00 in Denmark" — not an
// instant. Storing it as UTC would drift by an hour every March and October,
// and a campaign set to start at nine would start at eight all winter. So the
// window is compared against the local time in the campaign's own zone, which
// is what Intl gives us without pulling in a date library.

export interface CallWindow {
  startMinutes: number;
  endMinutes: number;
  // ISO weekdays, Monday = 1 … Sunday = 7.
  days: number[];
  timeZone: string;
}

// "09:00" / "09:00:00" → minutes since midnight.
export function parseWallClock(value: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return 0;
  const hours = Math.min(23, Number(match[1]));
  const minutes = Math.min(59, Number(match[2]));
  return hours * 60 + minutes;
}

export function formatWallClock(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

const ISO_WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// The local weekday and time-of-day at `instant`, in `timeZone`. Intl is the
// only thing in the platform that knows when Denmark last moved its clocks.
function localParts(instant: Date, timeZone: string): { weekday: number; minutes: number } {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  let weekday = 1;
  let hour = 0;
  let minute = 0;
  for (const part of formatter.formatToParts(instant)) {
    if (part.type === "weekday") weekday = ISO_WEEKDAY[part.value] ?? 1;
    if (part.type === "hour") hour = Number(part.value);
    if (part.type === "minute") minute = Number(part.value);
  }
  // Midnight comes back as "24" from some ICU versions.
  if (hour === 24) hour = 0;

  return { weekday, minutes: hour * 60 + minute };
}

export function isWithinCallWindow(window: CallWindow, at: Date): boolean {
  // A campaign with no days selected is one nobody can be rung by. That is a
  // configuration the UI does not offer, and treating it as "always" would
  // turn a mistake into calls.
  if (window.days.length === 0) return false;

  const { weekday, minutes } = localParts(at, window.timeZone);
  if (!window.days.includes(weekday)) return false;
  return minutes >= window.startMinutes && minutes < window.endMinutes;
}

// The next moment this campaign may dial, at or after `from`. Used to park a
// contact until the window opens rather than failing it — an evening launch
// should start in the morning, not throw the list away.
//
// Walks day by day: a week of steps is cheap and always terminates, and it
// gets daylight saving right for free because every check is a fresh local
// reading rather than arithmetic on an offset.
export function nextWindowOpening(window: CallWindow, from: Date): Date | null {
  if (window.days.length === 0) return null;
  if (isWithinCallWindow(window, from)) return from;

  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const day = new Date(from.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const { weekday, minutes } = localParts(day, window.timeZone);
    if (!window.days.includes(weekday)) continue;
    // Today only counts if the window has not already closed.
    if (dayOffset === 0 && minutes >= window.endMinutes) continue;

    const offsetIntoWindow = dayOffset === 0 ? Math.max(0, window.startMinutes - minutes) : 0;
    if (dayOffset === 0) {
      return new Date(day.getTime() + offsetIntoWindow * 60_000);
    }
    // A later day: step to its window start by the difference between the
    // local clock at that moment and the opening time.
    return new Date(day.getTime() + (window.startMinutes - minutes) * 60_000);
  }

  return null;
}
