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
//
// Overridable by env because Vapi retires voices on its own schedule and we
// found that out the hard way: "Lily" was the female fallback until Vapi
// started rejecting every assistant update that used it —
//
//   "The Lily voice is part of a legacy voice set that is being phased out,
//    and assistants cannot be updated to use this voice."
//
// — which failed the WHOLE assistant sync, so prompts, knowledge-base
// additions and tools stopped reaching every female-voice widget too. A voice
// name going stale must be fixable by setting a variable, not by a deploy.
// The durable fix is still to configure the voice templates, which these
// only stand in for.
const DEFAULT_FALLBACK_VOICE_ID: Record<VapiVoiceGender, string> = {
  female: "Paige",
  male: "Elliot",
};

function fallbackVoiceId(gender: VapiVoiceGender): string {
  const override = gender === "female" ? process.env.VAPI_FALLBACK_VOICE_FEMALE : process.env.VAPI_FALLBACK_VOICE_MALE;
  return override?.trim() || DEFAULT_FALLBACK_VOICE_ID[gender];
}

export function fallbackVoiceFor(gender: VapiVoiceGender): Record<string, unknown> {
  return { provider: "vapi", version: 2, voiceId: fallbackVoiceId(gender) };
}

// Kept as an object for the call sites that read it directly. Built lazily
// through a getter so an env override set after module load still applies.
export const FALLBACK_VOICE_BY_GENDER: Record<VapiVoiceGender, Record<string, unknown>> = {
  get female() {
    return fallbackVoiceFor("female");
  },
  get male() {
    return fallbackVoiceFor("male");
  },
};
