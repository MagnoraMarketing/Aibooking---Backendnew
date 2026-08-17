// Curated, provider-independent presets shown in the Voice Agent tab.
// Deliberately not exhaustive — the goal is a "Recommended" default plus a
// handful of sensible alternatives, not exposing Vapi's full provider matrix
// to normal customers. Extending this list is how new providers/models get
// added later (see the Vapi CreateAssistantDto model/voice unions in
// lib/vapi/mapping.ts for what else Vapi itself supports).

export interface LlmPreset {
  provider: string;
  model: string;
  label: string;
  recommended?: boolean;
}

export const LLM_PRESETS: LlmPreset[] = [
  { provider: "openai", model: "gpt-4o-mini", label: "OpenAI GPT-4o mini (hurtig, anbefalet)", recommended: true },
  { provider: "openai", model: "gpt-4o", label: "OpenAI GPT-4o (højere kvalitet)" },
  { provider: "anthropic", model: "claude-3-5-haiku-20241022", label: "Anthropic Claude 3.5 Haiku (hurtig)" },
  { provider: "anthropic", model: "claude-sonnet-4-5-20250929", label: "Anthropic Claude Sonnet 4.5 (bedste kvalitet)" },
];

export const DEFAULT_LLM_PRESET = LLM_PRESETS[0]!;

export interface VoicePreset {
  provider: string;
  voiceId: string;
  label: string;
  recommended?: boolean;
}

// Vapi's own built-in "vapi" voice provider requires no external API key or
// dashboard configuration on the customer's part, so it's the only preset
// offered out of the box. Other providers (11labs, playht, azure, cartesia,
// deepgram, openai, rime-ai) work too — see the "Custom voice" option in the
// Voice Agent tab — but require the account owner to have that provider's
// credentials configured in the Vapi dashboard.
export const VOICE_PRESETS: VoicePreset[] = [
  { provider: "vapi", voiceId: "Elliot", label: "Elliot (mand, anbefalet)", recommended: true },
  { provider: "vapi", voiceId: "Kylie", label: "Kylie (kvinde)" },
  { provider: "vapi", voiceId: "Cole", label: "Cole (mand)" },
  { provider: "vapi", voiceId: "Paige", label: "Paige (kvinde)" },
];

export const DEFAULT_VOICE_PRESET = VOICE_PRESETS[0]!;

// Voice providers selectable via "Custom voice" once the customer has that
// provider configured in their Vapi account.
export const VOICE_PROVIDERS = [
  "vapi",
  "11labs",
  "playht",
  "azure",
  "cartesia",
  "deepgram",
  "openai",
  "rime-ai",
] as const;

export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];
