import { describe, it, expect } from "vitest";
import {
  bookingSucceeded,
  classifyBookingTool,
  computeStats,
  normalizeCall,
  normalizeCallDetail,
} from "@/lib/aibooking-dashboard/calls";

// The Aibooking.dk Dashboard reads AIbooking's own agents' calls straight
// from Vapi's call list. These pin what it takes from a call: duration,
// summary, recording, and above all which bookings the agent made.

const CALL = {
  id: "call-1",
  assistantId: "6e91b6e9-4115-497e-9ebc-180127aae192",
  type: "webCall",
  status: "ended",
  createdAt: "2026-09-29T10:00:00.000Z",
  startedAt: "2026-09-29T10:00:05.000Z",
  endedAt: "2026-09-29T10:02:35.000Z",
  endedReason: "customer-ended-call",
  cost: 0.42,
  customer: { number: "+4512345678" },
  analysis: { summary: "Kunden bookede en demo.", successEvaluation: "true" },
  artifact: {
    recordingUrl: "https://storage.vapi.ai/call-1-mono.wav",
    messages: [
      { role: "system", message: "Du er AIbooking's receptionist." },
      { role: "bot", message: "Hej, velkommen til AIbooking.", secondsFromStart: 0.5 },
      { role: "user", message: "Jeg vil gerne booke en demo.", secondsFromStart: 3.2 },
      {
        role: "tool_calls",
        toolCalls: [
          { id: "t1", type: "function", function: { name: "check_availability", arguments: '{"date":"2026-10-01"}' } },
        ],
      },
      { role: "tool_call_result", toolCallId: "t1", name: "check_availability", result: "Ledige tider: 10:00" },
      {
        role: "tool_calls",
        toolCalls: [
          {
            id: "t2",
            type: "function",
            function: {
              name: "create_booking",
              arguments: '{"start_time":"2026-10-01T10:00:00+02:00","customer_name":"Mette","customer_email":"mette@example.dk"}',
            },
          },
        ],
      },
      {
        role: "tool_call_result",
        toolCallId: "t2",
        name: "create_booking",
        result: "Tiden er booket. Bekræft 2026-10-01T10:00:00+02:00 (Europe/Copenhagen) over for kunden.",
      },
      { role: "bot", message: "Du er booket.", secondsFromStart: 140 },
    ],
  },
};

describe("reading a Vapi call for the dashboard", () => {
  it("takes duration, cost, caller, summary and whether there is a recording", () => {
    const call = normalizeCall(CALL, "agent-widget");
    expect(call).toMatchObject({
      id: "call-1",
      agentId: "agent-widget",
      durationSeconds: 150,
      cost: 0.42,
      customerNumber: "+4512345678",
      summary: "Kunden bookede en demo.",
      hasRecording: true,
      endedReason: "customer-ended-call",
    });
  });

  it("finds the booking the agent made, and not the availability lookup", () => {
    const { bookings } = normalizeCall(CALL, "agent-widget");
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({
      kind: "create",
      customerName: "Mette",
      customerEmail: "mette@example.dk",
      appointmentTime: "2026-10-01T10:00:00+02:00",
      success: true,
    });
  });

  it("reports a refused booking as failed", () => {
    const refused = structuredClone(CALL);
    const result = refused.artifact.messages.find((m) => m.toolCallId === "t2")!;
    result.result = "Tiden kunne ikke bookes. Spørg om en anden tid.";
    expect(normalizeCall(refused, "a").bookings[0]!.success).toBe(false);
  });

  it("gives the detail view the transcript without the system prompt", () => {
    const detail = normalizeCallDetail(CALL, "agent-widget");
    expect(detail.recordingUrl).toBe("https://storage.vapi.ai/call-1-mono.wav");
    expect(detail.transcript.map((l) => l.role)).toEqual(["assistant", "user", "assistant"]);
  });

  // Older calls carry their artifacts on the call itself.
  it("reads an older call with top-level transcript and recording", () => {
    const call = normalizeCallDetail(
      {
        id: "old",
        recordingUrl: "https://storage.vapi.ai/old.wav",
        summary: "Gammelt resumé",
        transcript: "AI: Hej\nUser: Hej med dig",
      },
      "a"
    );
    expect(call.summary).toBe("Gammelt resumé");
    expect(call.recordingUrl).toBe("https://storage.vapi.ai/old.wav");
    expect(call.transcript).toHaveLength(2);
    expect(call.durationSeconds).toBe(0);
  });
});

describe("recognising booking tools by name", () => {
  it.each([
    ["create_booking", "create"],
    ["book_appointment", "create"],
    ["reschedule_booking", "reschedule"],
    ["cancel_booking", "cancel"],
    ["check_availability", null],
    ["get_booking", null],
    ["get_event_types", null],
    ["transferCall", null],
  ])("%s → %s", (name, kind) => {
    expect(classifyBookingTool(name)).toBe(kind);
  });

  it("reads our own tools' answers", () => {
    expect(bookingSucceeded("Tiden er booket. Bekræft …")).toBe(true);
    expect(bookingSucceeded("Tiden er flyttet til …")).toBe(true);
    expect(bookingSucceeded("Tiden kunne IKKE flyttes, og den oprindelige tid står stadig.")).toBe(false);
    expect(bookingSucceeded(null)).toBe(false);
  });
});

describe("statistics", () => {
  const now = new Date("2026-09-30T12:00:00");

  it("totals calls, talk time, bookings and conversion", () => {
    const booked = normalizeCall(CALL, "widget");
    const unanswered = normalizeCall({ id: "c2", createdAt: "2026-09-30T09:00:00", endedReason: "customer-did-not-answer" }, "inbound");
    const stats = computeStats([booked, unanswered], 7, now);

    expect(stats.totalCalls).toBe(2);
    expect(stats.answeredCalls).toBe(1);
    expect(stats.totalSeconds).toBe(150);
    expect(stats.bookings).toBe(1);
    expect(stats.conversionRate).toBe(1);
    expect(stats.uniqueCallers).toBe(1);
    expect(stats.endedReasons).toHaveLength(2);
  });

  it("has a point for every day in the period, quiet days included", () => {
    const stats = computeStats([normalizeCall({ id: "c", createdAt: "2026-09-30T09:00:00" }, "inbound")], 7, now);
    expect(stats.daily).toHaveLength(7);
    expect(stats.daily.at(-1)).toMatchObject({ day: "2026-09-30", total: 1, byAgent: { inbound: 1 } });
    expect(stats.daily[0]!.total).toBe(0);
  });
});
