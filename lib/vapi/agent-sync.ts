import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { listVapiAssistants, getVapiAssistantDetails, type VapiAssistantSummary } from "./assistants";
import type { WapiAgent } from "@/types/database";

export interface WapiAgentSyncResult {
  total: number;
  created: number;
  updated: number;
  lastSyncedAt: string;
}

function toMetadata(summary: VapiAssistantSummary): Record<string, unknown> {
  return {
    voiceProvider: summary.voiceProvider,
    voiceId: summary.voiceId,
    modelProvider: summary.modelProvider,
    modelName: summary.modelName,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}

// Pulls every assistant from the platform's Vapi account and upserts it into
// wapi_agents, matched on wapi_agent_id. Never deletes a row that no longer
// comes back from Vapi — a widget can still be pointed at it, and the admin
// UI needs a name to show even for an agent that has since been removed
// upstream (see 0043_admin_wapi_control_center.sql's header comment).
export async function syncWapiAgents(): Promise<WapiAgentSyncResult> {
  const assistants = await listVapiAssistants();
  const supabase = getAdminClient();
  const now = new Date().toISOString();

  const { data: existingRows } = await supabase.from("wapi_agents").select("wapi_agent_id");
  const existingIds = new Set((existingRows ?? []).map((row) => row.wapi_agent_id as string));

  if (assistants.length > 0) {
    const { error } = await supabase.from("wapi_agents").upsert(
      assistants.map((assistant) => ({
        wapi_agent_id: assistant.id,
        name: assistant.name,
        status: "active",
        language: assistant.language,
        voice: assistant.voiceId,
        metadata: toMetadata(assistant),
        last_synced_at: now,
      })),
      { onConflict: "wapi_agent_id" }
    );
    if (error) throw error;
  }

  const created = assistants.filter((a) => !existingIds.has(a.id)).length;

  return {
    total: assistants.length,
    created,
    updated: assistants.length - created,
    lastSyncedAt: now,
  };
}

// Refreshes a single cached row from Vapi (per-row "Refresh"/"View" on the
// admin Wapi Agents page), or creates one for an id an admin typed in
// manually that the bulk sync hasn't seen yet — same upsert path either way.
// Returns the row as it stands locally if Vapi can't be reached, so a
// transient API hiccup never breaks the page (see spec's "Prøv igen"
// requirement) — the row is simply not marked freshly synced.
export async function refreshWapiAgent(wapiAgentId: string): Promise<WapiAgent> {
  const supabase = getAdminClient();

  try {
    const details = await getVapiAssistantDetails(wapiAgentId);
    if (details) {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("wapi_agents")
        .upsert(
          {
            wapi_agent_id: details.id,
            name: details.name,
            status: "active",
            language: details.language,
            voice: details.voiceId,
            metadata: toMetadata(details),
            last_synced_at: now,
          },
          { onConflict: "wapi_agent_id" }
        )
        .select("*")
        .single();
      if (error) throw error;
      return data as WapiAgent;
    }
  } catch (err) {
    console.error(`Failed to live-refresh Wapi agent ${wapiAgentId}:`, err);
  }

  // Vapi didn't return it (deleted upstream, or unreachable) — fall back to
  // whatever is cached, creating a bare placeholder row if this is a manually
  // typed id that was never synced before.
  const { data: existing } = await supabase
    .from("wapi_agents")
    .select("*")
    .eq("wapi_agent_id", wapiAgentId)
    .maybeSingle();
  if (existing) return existing as WapiAgent;

  const { data: created, error: createError } = await supabase
    .from("wapi_agents")
    .upsert({ wapi_agent_id: wapiAgentId, status: "unknown" }, { onConflict: "wapi_agent_id" })
    .select("*")
    .single();
  if (createError) throw createError;
  return created as WapiAgent;
}
