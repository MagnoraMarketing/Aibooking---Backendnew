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
  // Spoken if the caller says nothing at all — defaults to Danish (see
  // lib/i18n/agent-content.ts's noSpeechHeardText) since most callers pass
  // this explicitly once they know the widget's language.
  noInputText?: string;
}): string {
  const language = params.language ?? "da-DK";
  const noInputText = params.noInputText ?? "Vi kunne ikke høre noget. Farvel for nu.";
  const speech = params.playUrl
    ? `<Play>${escapeXml(params.playUrl)}</Play>`
    : `<Say language="${language}">${escapeXml(params.sayText)}</Say>`;

  return `${XML_HEADER}<Response><Gather input="speech" language="${language}" speechTimeout="auto" action="${escapeXml(
    params.gatherActionUrl
  )}" method="POST">${speech}</Gather><Say language="${language}">${escapeXml(noInputText)}</Say><Hangup/></Response>`;
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

// <Connect><ConversationRelay> — routes a call (here, the browser Voice SDK
// call placed against the platform TwiML App, see relay-start's route) into
// Twilio's own STT/TTS relay, which then opens a WebSocket to `wsUrl`
// (relay-server/) carrying `parameters` as the "setup" message's
// customParameters. Deliberately omits ttsProvider/voice to use
// ConversationRelay's own defaults for now — see the ConversationRelay
// integration's README for why (V1 scope: Twilio's own voices, ElevenLabs
// as a documented future option, not built yet).
export function buildConversationRelayResponse(params: {
  wsUrl: string;
  welcomeGreeting: string;
  language: string;
  parameters: Record<string, string>;
}): string {
  const paramTags = Object.entries(params.parameters)
    .map(([name, value]) => `<Parameter name="${escapeXml(name)}" value="${escapeXml(value)}"/>`)
    .join("");

  return `${XML_HEADER}<Response><Connect><ConversationRelay url="${escapeXml(params.wsUrl)}" welcomeGreeting="${escapeXml(
    params.welcomeGreeting
  )}" language="${params.language}">${paramTags}</ConversationRelay></Connect></Response>`;
}
