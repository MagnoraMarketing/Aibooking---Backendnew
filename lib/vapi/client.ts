import "server-only";
import { VapiClient } from "@vapi-ai/server-sdk";
import type { Widget } from "@/types/database";
import { vapiEnv } from "./env";
import { buildVapiAssistantPayload } from "./mapping";
import type { AgentCapabilities, VapiSyncResult } from "./types";

let cached: VapiClient | null = null;

export function getVapiClient(): VapiClient {
  if (cached) return cached;
  cached = new VapiClient({ token: vapiEnv.apiKey });
  return cached;
}

// Creates the Vapi assistant on first call, updates the existing one (by
// the widget's stored vapi_assistant_id) on every call after that — a
// widget must never end up with two Vapi assistants.
export async function createOrSyncVapiAssistant(
  widget: Widget,
  capabilities: AgentCapabilities
): Promise<VapiSyncResult> {
  const client = getVapiClient();
  const payload = buildVapiAssistantPayload(widget, capabilities);

  if (widget.vapi_assistant_id) {
    const updated = await client.assistants.update({ id: widget.vapi_assistant_id, ...payload });
    return { widget, vapiAssistantId: updated.id, created: false };
  }

  const created = await client.assistants.create(payload);
  return { widget, vapiAssistantId: created.id, created: true };
}

export async function deleteVapiAssistant(vapiAssistantId: string): Promise<void> {
  const client = getVapiClient();
  await client.assistants.delete({ id: vapiAssistantId });
}
