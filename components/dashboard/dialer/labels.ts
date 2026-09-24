import type { LeadDisposition, LeadStatus } from "@/types/database";

// Outcomes offered after a call, in the order a caller reaches for them.
export const DISPOSITIONS: { value: LeadDisposition; label: string }[] = [
  { value: "interested", label: "Interesseret" },
  { value: "booked", label: "Møde booket" },
  { value: "call_back", label: "Ønsker at blive ringet op" },
  { value: "not_interested", label: "Ikke interesseret" },
  { value: "no_answer", label: "Ingen svar" },
  { value: "busy", label: "Optaget" },
  { value: "voicemail", label: "Telefonsvarer" },
  { value: "wrong_number", label: "Forkert nummer" },
  { value: "do_not_call", label: "Må ikke ringes op" },
  { value: "other", label: "Andet" },
];

export function dispositionLabel(value: string | null | undefined): string {
  return DISPOSITIONS.find((d) => d.value === value)?.label ?? value ?? "";
}

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  pending: "Ikke ringet",
  calling: "Ringer nu",
  called: "Ringet",
  callback: "Tilbagekald",
  do_not_call: "Må ikke ringes op",
};

export const CALL_STATUS_LABELS: Record<string, string> = {
  initiated: "Startet",
  ringing: "Ringer",
  "in-progress": "I samtale",
  completed: "Besvaret",
  busy: "Optaget",
  "no-answer": "Ingen svar",
  failed: "Fejlede",
  canceled: "Afbrudt",
};

export function formatDuration(seconds: number | null | undefined): string {
  const total = Math.max(0, seconds ?? 0);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("da-DK", { dateStyle: "medium", timeStyle: "short" });
}

// <input type="datetime-local"> speaks the browser's own time zone; the API
// wants an instant.
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "Europe/Copenhagen";
  }
}
