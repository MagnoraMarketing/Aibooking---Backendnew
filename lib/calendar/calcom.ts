import "server-only";
import { ApiError } from "@/types/errors";

const CALCOM_API_BASE = "https://api.cal.com/v1";

export interface CalcomEventType {
  id: number;
  title: string;
}

// Cal.com is API-key based (no OAuth) — the customer pastes a key from
// their Cal.com "Settings → Developer → API keys" page. We verify it works
// and return their event types so the dashboard can let them pick which one
// the agent books against.
export async function fetchCalcomEventTypes(apiKey: string): Promise<CalcomEventType[]> {
  const response = await fetch(`${CALCOM_API_BASE}/event-types?apiKey=${encodeURIComponent(apiKey)}`);

  if (response.status === 401 || response.status === 403) {
    throw ApiError.badRequest("Ugyldig Cal.com API-nøgle.");
  }
  if (!response.ok) {
    throw new Error(`Cal.com API request failed: ${response.status}`);
  }

  const data = (await response.json()) as { event_types: Array<{ id: number; title: string }> };
  return data.event_types.map((eventType) => ({ id: eventType.id, title: eventType.title }));
}
