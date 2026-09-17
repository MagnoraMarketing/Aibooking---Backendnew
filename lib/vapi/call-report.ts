// What a finished Vapi call left behind: what was said, what it came to, and
// the audio. All three arrive in the end-of-call-report and are stored
// verbatim in vapi_events by app/api/webhooks/vapi.
//
// The dashboard's "Samtaledetaljer" promised these three tabs from the start
// and filled none of them for a voice conversation: it only ever read
// conversation_messages, which the text pipeline writes and a voice call
// never touches. Nothing was missing from the data — only the reading of it.

export interface TranscriptLine {
  role: "user" | "assistant";
  text: string;
  secondsFromStart: number | null;
}

export interface VapiCallReport {
  transcript: TranscriptLine[];
  summary: string | null;
  recordingUrl: string | null;
  // When the call actually connected, and how Vapi says it ended. Inbound
  // does not need either — the conversation row carries its own timestamps —
  // but an outbound contact has no conversation, so this report is the only
  // place its call details exist.
  startedAt: string | null;
  endedReason: string | null;
}

// Vapi labels the agent's turns "bot" in the structured messages and "AI" in
// the plain-text transcript; the dashboard says "assistent" either way.
function speaker(role: string): TranscriptLine["role"] | null {
  if (/^user$/i.test(role)) return "user";
  if (/^(bot|assistant|ai)$/i.test(role)) return "assistant";
  return null;
}

// `messages` carries the turns with their roles and timings. `transcript` is
// the same conversation as one string, which is all an older report has —
// and all a report has when Vapi drops the structured copy.
function readTranscript(payload: Record<string, unknown>): TranscriptLine[] {
  const structured = Array.isArray(payload.messages) ? (payload.messages as Record<string, unknown>[]) : [];

  const lines: TranscriptLine[] = [];
  for (const message of structured) {
    const role = speaker(String(message.role ?? ""));
    // A system prompt is not something the caller said, and the tool traffic
    // in between is not conversation either.
    if (!role) continue;
    const text = typeof message.message === "string" ? message.message : "";
    if (!text.trim()) continue;
    lines.push({
      role,
      text: text.trim(),
      secondsFromStart:
        typeof message.secondsFromStart === "number" ? Math.round(message.secondsFromStart) : null,
    });
  }
  if (lines.length > 0) return lines;

  const plain = typeof payload.transcript === "string" ? payload.transcript : "";
  for (const line of plain.split("\n")) {
    const match = /^(user|ai|bot|assistant):\s*(.*)$/i.exec(line.trim());
    if (!match) continue;
    const role = speaker(match[1]!);
    if (!role || !match[2]!.trim()) continue;
    lines.push({ role, text: match[2]!.trim(), secondsFromStart: null });
  }
  return lines;
}

export function parseCallReport(payload: Record<string, unknown> | null | undefined): VapiCallReport | null {
  if (!payload) return null;

  const summary = typeof payload.summary === "string" ? payload.summary.trim() : "";
  // Mono, not stereo: the stereo file puts each speaker on its own channel,
  // which plays back as one side of the conversation per ear.
  const recordingUrl = typeof payload.recordingUrl === "string" ? payload.recordingUrl.trim() : "";

  return {
    transcript: readTranscript(payload),
    summary: summary || null,
    recordingUrl: recordingUrl || null,
    startedAt: typeof payload.startedAt === "string" ? payload.startedAt : null,
    endedReason: typeof payload.endedReason === "string" ? payload.endedReason : null,
  };
}
