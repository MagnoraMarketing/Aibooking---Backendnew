// Hand-built TwiML — deliberately not the `twilio` npm package's TwiML
// builder (not a dependency here) since these three response shapes cover
// everything the turn-based pipeline needs. See this module's sibling
// files for the "why turn-based, not Media Streams" tradeoff.
import "server-only";

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

// Speaks `sayText` (via <Play> of an ElevenLabs-synthesized clip when
// `playUrl` is given, falling back to Twilio's own <Say> otherwise), then
// listens for the caller's next turn via Twilio's built-in speech
// recognition and posts the transcript to `gatherActionUrl`.
export function buildGatherResponse(params: {
  sayText: string;
  playUrl?: string | null;
  gatherActionUrl: string;
  language?: string;
}): string {
  const language = params.language ?? "da-DK";
  const speech = params.playUrl
    ? `<Play>${escapeXml(params.playUrl)}</Play>`
    : `<Say language="${language}">${escapeXml(params.sayText)}</Say>`;

  return `${XML_HEADER}<Response><Gather input="speech" language="${language}" speechTimeout="auto" action="${escapeXml(
    params.gatherActionUrl
  )}" method="POST">${speech}</Gather><Say language="${language}">Vi kunne ikke høre noget. Farvel for nu.</Say><Hangup/></Response>`;
}

// Terminal response — no further <Gather>, the call ends after this line.
export function buildSayAndHangupResponse(params: { sayText: string; playUrl?: string | null; language?: string }): string {
  const language = params.language ?? "da-DK";
  const speech = params.playUrl
    ? `<Play>${escapeXml(params.playUrl)}</Play>`
    : `<Say language="${language}">${escapeXml(params.sayText)}</Say>`;
  return `${XML_HEADER}<Response>${speech}<Hangup/></Response>`;
}

export function twimlResponseHeaders(): Record<string, string> {
  return { "Content-Type": "text/xml; charset=utf-8" };
}
