// The Aibooking.dk Dashboard's reading of Vapi calls.
//
// Pure — no fetching, no database — so the server can shape what Vapi
// returns and the browser can compute statistics for any agent selection
// from the same functions, without a second round trip per tab.

import { parseCallReport, type TranscriptLine } from "@/lib/vapi/call-report";

export type DashboardChannel = "widget" | "inbound" | "outbound";

export interface DashboardAgent {
  id: string;
  name: string;
  channel: DashboardChannel;
  vapi_assistant_id: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type BookingKind = "create" | "reschedule" | "cancel";

export interface DashboardBooking {
  callId: string;
  agentId: string;
  kind: BookingKind;
  toolName: string;
  customerName: string | null;
  customerEmail: string | null;
  // The time asked for, as the agent passed it to the tool.
  appointmentTime: string | null;
  success: boolean;
  result: string | null;
  at: string;
}

export interface DashboardCall {
  id: string;
  agentId: string;
  type: string | null;
  status: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  cost: number;
  endedReason: string | null;
  customerNumber: string | null;
  summary: string | null;
  successEvaluation: string | null;
  hasRecording: boolean;
  bookings: DashboardBooking[];
}

export interface DashboardCallDetail extends DashboardCall {
  transcript: TranscriptLine[];
  recordingUrl: string | null;
}

type Raw = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function obj(value: unknown): Raw {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
}

// Vapi has moved the call's artifacts around over time: transcript, messages
// and recording used to sit on the call itself and now live under
// `artifact`, the summary under `analysis`. Reading both keeps older calls
// in the history.
function flatten(raw: Raw): Raw {
  const artifact = obj(raw.artifact);
  const analysis = obj(raw.analysis);
  const recording = obj(artifact.recording);
  const mono = obj(recording.mono);
  return {
    ...raw,
    ...artifact,
    summary: str(analysis.summary) ?? str(raw.summary),
    recordingUrl: str(artifact.recordingUrl) ?? str(mono.combinedUrl) ?? str(raw.recordingUrl),
  };
}

function durationOf(raw: Raw): number {
  const start = str(raw.startedAt);
  const end = str(raw.endedAt);
  if (!start || !end) return 0;
  const seconds = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
}

// Which booking step a tool call was, by its name. Our own assistants use
// create_booking / reschedule_booking / cancel_booking (lib/vapi/
// assistants.ts), but the platform's agents can also carry tools set up
// directly in Vapi, so the match is on what the name means, not the exact
// spelling. Lookups (availability, event types, finding a booking) are not
// bookings.
export function classifyBookingTool(name: string): BookingKind | null {
  const n = name.toLowerCase();
  if (/check|availab|ledig|get_|find|lookup|search|list|slot|event_type/.test(n)) return null;
  if (/cancel|aflys/.test(n)) return "cancel";
  if (/reschedul|flyt|move/.test(n)) return "reschedule";
  if (/book|appointment|reserv|create_event|aftale/.test(n)) return "create";
  return null;
}

// Whether the tool's answer reads as done. create_booking says so in as many
// words ("Tiden er booket"); for other tools a refusal reads as one.
export function bookingSucceeded(result: string | null): boolean {
  if (!result) return false;
  if (/^tiden er (booket|flyttet|aflyst)/i.test(result)) return true;
  return !/(fejl|error|ikke|failed|unable|mangler|invalid|could not|cannot)/i.test(result);
}

function parseArgs(value: unknown): Raw {
  if (typeof value === "string") {
    try {
      return obj(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return obj(value);
}

function pick(args: Raw, keys: string[]): string | null {
  for (const key of keys) {
    const value = str(args[key]);
    if (value) return value;
  }
  return null;
}

export function extractBookings(raw: Raw, agentId: string): DashboardBooking[] {
  const flat = flatten(raw);
  const messages = Array.isArray(flat.messages) ? (flat.messages as Raw[]) : [];
  const callId = String(raw.id ?? "");
  const at = str(raw.startedAt) ?? str(raw.createdAt) ?? new Date(0).toISOString();

  const results = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "tool_call_result") continue;
    const id = str(message.toolCallId);
    const result = typeof message.result === "string" ? message.result : message.result != null ? JSON.stringify(message.result) : null;
    if (id && result) results.set(id, result);
  }

  const bookings: DashboardBooking[] = [];
  for (const message of messages) {
    if (message.role !== "tool_calls" || !Array.isArray(message.toolCalls)) continue;
    for (const call of message.toolCalls as Raw[]) {
      const fn = obj(call.function);
      const name = str(fn.name);
      if (!name) continue;
      const kind = classifyBookingTool(name);
      if (!kind) continue;
      const args = parseArgs(fn.arguments);
      const result = results.get(String(call.id ?? "")) ?? null;
      bookings.push({
        callId,
        agentId,
        kind,
        toolName: name,
        customerName: pick(args, ["customer_name", "name", "attendee_name"]),
        customerEmail: pick(args, ["customer_email", "email", "attendee_email"]),
        appointmentTime: pick(args, ["start_time", "new_start_time", "start", "time", "date"]),
        success: bookingSucceeded(result),
        result,
        at,
      });
    }
  }
  return bookings;
}

export function normalizeCall(raw: Raw, agentId: string): DashboardCall {
  const flat = flatten(raw);
  const analysis = obj(raw.analysis);
  const customer = obj(raw.customer);
  const evaluation = analysis.successEvaluation;
  return {
    id: String(raw.id ?? ""),
    agentId,
    type: str(raw.type),
    status: str(raw.status),
    createdAt: str(raw.createdAt) ?? str(raw.startedAt) ?? new Date(0).toISOString(),
    startedAt: str(raw.startedAt),
    endedAt: str(raw.endedAt),
    durationSeconds: durationOf(raw),
    cost: typeof raw.cost === "number" && Number.isFinite(raw.cost) ? raw.cost : 0,
    endedReason: str(raw.endedReason),
    customerNumber: str(customer.number),
    summary: str(flat.summary),
    successEvaluation: evaluation == null ? null : String(evaluation),
    hasRecording: Boolean(str(flat.recordingUrl)),
    bookings: extractBookings(raw, agentId),
  };
}

export function normalizeCallDetail(raw: Raw, agentId: string): DashboardCallDetail {
  const report = parseCallReport(flatten(raw));
  return {
    ...normalizeCall(raw, agentId),
    transcript: report?.transcript ?? [],
    recordingUrl: report?.recordingUrl ?? null,
  };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface DailyPoint {
  day: string; // YYYY-MM-DD, local time
  byAgent: Record<string, number>;
  total: number;
}

export interface DashboardStats {
  totalCalls: number;
  answeredCalls: number;
  totalSeconds: number;
  avgSeconds: number;
  totalCost: number;
  uniqueCallers: number;
  bookings: number;
  failedBookings: number;
  reschedules: number;
  cancellations: number;
  conversionRate: number;
  daily: DailyPoint[];
  endedReasons: { reason: string; count: number }[];
  byHour: number[];
}

function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function computeStats(calls: DashboardCall[], days: number, now: Date = new Date()): DashboardStats {
  const answered = calls.filter((call) => call.durationSeconds > 0);
  const totalSeconds = calls.reduce((sum, call) => sum + call.durationSeconds, 0);
  const allBookings = calls.flatMap((call) => call.bookings);
  const bookings = allBookings.filter((b) => b.kind === "create" && b.success).length;

  // Every day in the period gets a point, so a quiet day shows as zero
  // rather than disappearing from the chart.
  const daily: DailyPoint[] = [];
  const index = new Map<string, DailyPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const point = { day: dayKey(date), byAgent: {}, total: 0 };
    daily.push(point);
    index.set(point.day, point);
  }

  const reasons = new Map<string, number>();
  const byHour = new Array<number>(24).fill(0);
  for (const call of calls) {
    const when = new Date(call.startedAt ?? call.createdAt);
    const point = index.get(dayKey(when));
    if (point) {
      point.byAgent[call.agentId] = (point.byAgent[call.agentId] ?? 0) + 1;
      point.total += 1;
    }
    byHour[when.getHours()] = (byHour[when.getHours()] ?? 0) + 1;
    const reason = call.endedReason ?? "ukendt";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  return {
    totalCalls: calls.length,
    answeredCalls: answered.length,
    totalSeconds,
    avgSeconds: answered.length ? Math.round(totalSeconds / answered.length) : 0,
    totalCost: calls.reduce((sum, call) => sum + call.cost, 0),
    uniqueCallers: new Set(calls.map((call) => call.customerNumber).filter(Boolean)).size,
    bookings,
    failedBookings: allBookings.filter((b) => b.kind === "create" && !b.success).length,
    reschedules: allBookings.filter((b) => b.kind === "reschedule" && b.success).length,
    cancellations: allBookings.filter((b) => b.kind === "cancel" && b.success).length,
    conversionRate: answered.length ? bookings / answered.length : 0,
    daily,
    endedReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    byHour,
  };
}
