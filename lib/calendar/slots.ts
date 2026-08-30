import { getZonedParts, zonedTimeToUtc } from "./timezone";

export interface BusyInterval {
  start: string; // ISO 8601
  end: string; // ISO 8601
}

// Google Calendar and Microsoft Graph both report free/busy as opaque
// intervals with no notion of "event types"/duration — unlike Cal.com,
// which returns bookable slots directly. This derives the same shape
// (a short list of open slots) by walking business hours and excluding
// anything that overlaps a busy interval, so the two OAuth providers can
// offer a comparable "here are open times" answer.
export function generateBusinessHourSlots(params: {
  windowStart: Date;
  windowEnd: Date;
  timezone: string;
  durationMinutes: number;
  busy: BusyInterval[];
  now?: Date;
  businessStartHour?: number;
  businessEndHour?: number;
  maxSlots?: number;
}): string[] {
  const businessStartHour = params.businessStartHour ?? 9;
  const businessEndHour = params.businessEndHour ?? 17;
  const maxSlots = params.maxSlots ?? 8;
  const now = params.now ?? new Date();
  const durationMs = params.durationMinutes * 60 * 1000;

  const busy = params.busy
    .map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));

  function overlapsBusy(startMs: number, endMs: number): boolean {
    return busy.some((b) => startMs < b.end && endMs > b.start);
  }

  const slots: string[] = [];
  // One calendar day per iteration, in the target timezone, so a slot at
  // 09:00 always means 09:00 local regardless of the caller's own offset.
  const cursor = getZonedParts(params.windowStart, params.timezone);
  const endParts = getZonedParts(params.windowEnd, params.timezone);
  const endMarker = Date.UTC(endParts.year, endParts.month - 1, endParts.day);

  let dayCursor = Date.UTC(cursor.year, cursor.month - 1, cursor.day);

  while (dayCursor <= endMarker && slots.length < maxSlots) {
    const dayDate = new Date(dayCursor);
    const weekday = dayDate.getUTCDay();
    // Business-hours only, Monday-Friday — a reasonable default for a
    // Danish SMB's booking window; matches what Cal.com event types
    // typically configure out of the box.
    if (weekday !== 0 && weekday !== 6) {
      const year = dayDate.getUTCFullYear();
      const month = dayDate.getUTCMonth() + 1;
      const day = dayDate.getUTCDate();

      for (let minutes = businessStartHour * 60; minutes + params.durationMinutes <= businessEndHour * 60; minutes += params.durationMinutes) {
        if (slots.length >= maxSlots) break;

        const hour = Math.floor(minutes / 60);
        const minute = minutes % 60;
        const slotStart = zonedTimeToUtc(year, month, day, hour, minute, params.timezone);
        const slotStartMs = slotStart.getTime();
        const slotEndMs = slotStartMs + durationMs;

        if (slotStartMs <= now.getTime()) continue;
        if (slotStartMs < params.windowStart.getTime() || slotStartMs > params.windowEnd.getTime()) continue;
        if (overlapsBusy(slotStartMs, slotEndMs)) continue;

        slots.push(slotStart.toISOString());
      }
    }

    dayCursor += 24 * 60 * 60 * 1000;
  }

  return slots;
}
