// Shared between server and browser: the customer's "Mand"/"Dame" choice is
// rendered by the wizard and Settings tab, and resolved into an actual Vapi
// voice on the server (lib/vapi/assistants.ts). Both halves must agree on
// the same default, or a widget can end up saved as one gender and spoken
// in the other.

export type VapiVoiceGender = "male" | "female";

// What a widget gets before the customer reaches the wizard's Stemme step,
// and what an older widget with no stored choice is treated as. Chosen once
// here so no call site can quietly disagree — a null-defaults-to-male path
// is exactly how a customer who picked "Dame" ends up with a male voice.
export const DEFAULT_VOICE_GENDER: VapiVoiceGender = "female";

// Vapi's own built-in voices, used only when the admin-configured template
// for a gender is missing or unreadable (see resolveVoiceConfig). The point
// of having one per gender is that the fallback still HONOURS the
// customer's choice: falling back to a fixed male voice for a widget set to
// "Dame" is a wrong answer, not a safe one.
export const FALLBACK_VOICE_BY_GENDER: Record<VapiVoiceGender, Record<string, unknown>> = {
  female: { provider: "vapi", version: 2, voiceId: "Lily" },
  male: { provider: "vapi", version: 2, voiceId: "Elliot" },
};
