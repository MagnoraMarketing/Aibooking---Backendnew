import "server-only";

const VAPI_API_BASE = "https://api.vapi.ai";

function getPrivateKey(): string {
  const privateKey = process.env.VAPI_PRIVATE_KEY;
  if (!privateKey) throw new Error("Missing required environment variable: VAPI_PRIVATE_KEY");
  return privateKey;
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
    throw new Error(`Vapi API request failed: ${response.status} ${errorBody}`);
  }

  return response;
}
