import "server-only";

export {
  createVapiAssistant,
  updateVapiAssistant,
  DEFAULT_VAPI_FIRST_MESSAGE,
  type VapiAssistantParams,
} from "./assistants";
export { syncWidgetToVapiAssistant } from "./sync";
export { importTwilioPhoneNumber, type ImportTwilioNumberParams, type VapiPhoneNumber } from "./phone-numbers";
export { createOutboundCall, type CreateOutboundCallParams } from "./calls";

function getPublicKey(): string {
  const publicKey = process.env.VAPI_PUBLIC_KEY;
  if (!publicKey) throw new Error("Missing required environment variable: VAPI_PUBLIC_KEY");
  return publicKey;
}

export interface VapiCallConfig {
  publicKey: string;
  assistantId: string;
}

// Unlike OpenAI Realtime, Vapi calls don't need a server-minted ephemeral
// secret — the Vapi Web SDK connects directly from the browser using the
// (safe-to-expose) public key plus the widget's assistant id. This just
// bundles the two together and fails fast if either is missing, mirroring
// createRealtimeClientSecret's error behavior in lib/realtime.
export function getVapiCallConfig(assistantId: string | null | undefined): VapiCallConfig {
  if (!assistantId) {
    throw new Error(
      "Widget is missing a Vapi assistant id (set widget_settings.extra.vapiAssistantId)"
    );
  }
  return { publicKey: getPublicKey(), assistantId };
}
