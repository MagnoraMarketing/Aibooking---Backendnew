import { describe, it, expect } from "vitest";
import { parseCallReport } from "@/lib/vapi/call-report";

// "Samtaledetaljer" showed three empty tabs on every voice conversation the
// platform had ever had — transcript, summary and recording were all sitting
// in the end-of-call-report we store, and the dashboard read
// conversation_messages instead, which a voice call never writes to.

const STRUCTURED = {
  summary: "Kunden bookede en herreklip i morgen kl. 14.",
  recordingUrl: "https://storage.vapi.ai/call-1-mono.wav",
  stereoRecordingUrl: "https://storage.vapi.ai/call-1-stereo.wav",
  messages: [
    { role: "system", message: "Du er receptionist hos Frisørstuen." },
    { role: "bot", message: "Hej og velkommen til Frisørstuen.", secondsFromStart: 0.4 },
    { role: "user", message: "Jeg skal have en klipning i morgen.", secondsFromStart: 4.8 },
    { role: "tool_calls", message: "" },
    { role: "bot", message: "Klokken 14 er ledig.", secondsFromStart: 61.2 },
  ],
};

describe("reading a finished call's report", () => {
  it("returns the turns in order, with the agent's labelled as the assistant", () => {
    const report = parseCallReport(STRUCTURED)!;

    expect(report.transcript).toEqual([
      { role: "assistant", text: "Hej og velkommen til Frisørstuen.", secondsFromStart: 0 },
      { role: "user", text: "Jeg skal have en klipning i morgen.", secondsFromStart: 5 },
      { role: "assistant", text: "Klokken 14 er ledig.", secondsFromStart: 61 },
    ]);
  });

  // The system prompt is not something anyone said, and the tool traffic in
  // between is not conversation either.
  it("leaves out the system prompt and the tool calls", () => {
    const report = parseCallReport(STRUCTURED)!;

    expect(report.transcript.some((line) => line.text.includes("Du er receptionist"))).toBe(false);
    expect(report.transcript).toHaveLength(3);
  });

  it("carries the summary and the recording through", () => {
    const report = parseCallReport(STRUCTURED)!;

    expect(report.summary).toBe("Kunden bookede en herreklip i morgen kl. 14.");
    expect(report.recordingUrl).toBe("https://storage.vapi.ai/call-1-mono.wav");
  });

  // The stereo file puts each speaker on its own channel, so it plays back as
  // one side of the conversation per ear.
  it("offers the mono recording, not the stereo one", () => {
    const report = parseCallReport(STRUCTURED)!;

    expect(report.recordingUrl).not.toContain("stereo");
  });
});

describe("a report with only the plain-text transcript", () => {
  const PLAIN = {
    transcript: "AI: Hej, velkommen.\nUser: Hvem har jeg ringet til?\nAI: Du har kontaktet Frisørstuen.\n",
  };

  it("reads the turns out of the string when the structured copy is missing", () => {
    const report = parseCallReport(PLAIN)!;

    expect(report.transcript).toEqual([
      { role: "assistant", text: "Hej, velkommen.", secondsFromStart: null },
      { role: "user", text: "Hvem har jeg ringet til?", secondsFromStart: null },
      { role: "assistant", text: "Du har kontaktet Frisørstuen.", secondsFromStart: null },
    ]);
  });

  it("prefers the structured turns when both are there, since only those carry timings", () => {
    const report = parseCallReport({ ...STRUCTURED, transcript: "AI: noget helt andet\n" })!;

    expect(report.transcript[0]!.text).toBe("Hej og velkommen til Frisørstuen.");
  });
});

describe("a report with nothing in it", () => {
  it("returns an empty transcript rather than throwing", () => {
    expect(parseCallReport({})).toEqual({ transcript: [], summary: null, recordingUrl: null });
  });

  // A call that connected and ended without a word — the tab should say so,
  // not show a blank field that looks broken.
  it("treats a blank summary and recording as absent", () => {
    expect(parseCallReport({ summary: "   ", recordingUrl: "" })).toMatchObject({
      summary: null,
      recordingUrl: null,
    });
  });

  it("returns nothing at all for a conversation with no call", () => {
    expect(parseCallReport(null)).toBeNull();
  });
});
