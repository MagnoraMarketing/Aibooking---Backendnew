import "server-only";
import { ApiError } from "@/types/errors";
import { requireCredentialEnv } from "@/lib/security/env";

const VAPI_API_BASE = "https://api.vapi.ai";

function getPrivateKey(): string {
  return requireCredentialEnv(
    "VAPI_PRIVATE_KEY",
    "Vapi er ikke konfigureret på platformen endnu (mangler VAPI_PRIVATE_KEY i miljøvariablerne)."
  );
}

export async function vapiFetch(path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${VAPI_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getPrivateKey()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw ApiError.internal(`Vapi afviste anmodningen (${response.status}): ${errorBody || "ingen detaljer"}`);
  }

  return response;
}
