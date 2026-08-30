import "server-only";
import { ApiError } from "@/types/errors";
import { requireCredentialEnv } from "@/lib/security/env";

export { createVapiAssistant, updateVapiAssistant, type VapiAssistantParams, type VapiVoiceGender } from "./assistants";
export { syncWidgetToVapiAssistant } from "./sync";
export { importTwilioPhoneNumber, type ImportTwilioNumberParams, type VapiPhoneNumber } from "./phone-numbers";
export { createOutboundCall, type CreateOutboundCallParams } from "./calls";

function getPublicKey(): string {
  return requireCredentialEnv(
    "VAPI_PUBLIC_KEY",
    "Vapi er ikke konfigureret på platformen endnu (mangler VAPI_PUBLIC_KEY i miljøvariablerne)."
  );
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
    throw ApiError.internal("Agenten mangler en Vapi-assistent endnu — gem agenten igen under Settings for at oprette den.");
  }
  return { publicKey: getPublicKey(), assistantId };
}
