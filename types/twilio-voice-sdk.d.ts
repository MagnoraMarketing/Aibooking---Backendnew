// Ambient type for the vendored Twilio Voice SDK browser global (see
// public/vendor/README.md and components/dashboard/dialer-manager.tsx) —
// `import type` only, so this never pulls the actual SDK into the server
// or dashboard bundle; the real script tag is public/vendor/twilio-voice-sdk.min.js.
import type { Device } from "@twilio/voice-sdk";

declare global {
  interface Window {
    Twilio?: { Device: typeof Device };
  }
}

export {};
