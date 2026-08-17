// Languages offered across the Agent Studio (Settings tab + Voice Agent
// tab) and used to derive the Vapi transcriber language. Adding a language
// later is a one-line addition here — nothing else needs to change.
export interface SupportedLanguage {
  code: string;
  label: string;
  // BCP-47 tag Vapi's default transcriber (Deepgram) understands.
  transcriberLanguage: string;
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: "da", label: "Dansk", transcriberLanguage: "da" },
  { code: "en", label: "English", transcriberLanguage: "en" },
  { code: "es", label: "Español", transcriberLanguage: "es" },
  { code: "sv", label: "Svenska", transcriberLanguage: "sv" },
  { code: "no", label: "Norsk", transcriberLanguage: "no" },
  { code: "de", label: "Deutsch", transcriberLanguage: "de" },
];

export function getTranscriberLanguage(languageCode: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === languageCode)?.transcriberLanguage ?? "en";
}
