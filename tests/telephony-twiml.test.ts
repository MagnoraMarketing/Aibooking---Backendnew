import { describe, it, expect } from "vitest";
import { escapeXml, buildGatherResponse, buildSayAndHangupResponse } from "@/lib/telephony/twiml";

describe("escapeXml", () => {
  it("escapes all five XML special characters", () => {
    expect(escapeXml(`<tag> & "quotes" 'apos'`)).toBe("&lt;tag&gt; &amp; &quot;quotes&quot; &apos;apos&apos;");
  });
});

describe("buildGatherResponse", () => {
  it("uses <Say> with the reply text when no playUrl is given", () => {
    const xml = buildGatherResponse({ sayText: "Hej & velkommen", gatherActionUrl: "https://x.test/turn" });
    expect(xml).toContain('<Say language="da-DK">Hej &amp; velkommen</Say>');
    expect(xml).toContain('<Gather input="speech" language="da-DK" speechTimeout="auto" action="https://x.test/turn"');
    expect(xml).not.toContain("<Play>");
  });

  it("uses <Play> instead of <Say> for the reply when a playUrl is given", () => {
    const xml = buildGatherResponse({
      sayText: "ignored for playback",
      playUrl: "https://x.test/audio/msg-1",
      gatherActionUrl: "https://x.test/turn",
    });
    expect(xml).toContain("<Play>https://x.test/audio/msg-1</Play>");
    // The reply text itself must never appear as a <Say> — only the fixed
    // "no speech heard" fallback (outside <Gather>) is allowed to.
    expect(xml).not.toContain("ignored for playback");
    const gatherSection = xml.slice(xml.indexOf("<Gather"), xml.indexOf("</Gather>"));
    expect(gatherSection).not.toContain("<Say");
  });

  it("respects a custom language", () => {
    const xml = buildGatherResponse({ sayText: "Hi", gatherActionUrl: "https://x.test/turn", language: "en-US" });
    expect(xml).toContain('language="en-US"');
  });

  it("always includes a fallback Say + Hangup for a silent Gather", () => {
    const xml = buildGatherResponse({ sayText: "Hi", gatherActionUrl: "https://x.test/turn" });
    expect(xml).toContain("<Hangup/>");
  });
});

describe("buildSayAndHangupResponse", () => {
  it("is a terminal response with no Gather", () => {
    const xml = buildSayAndHangupResponse({ sayText: "Farvel" });
    expect(xml).toContain("<Say");
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Gather");
  });
});
