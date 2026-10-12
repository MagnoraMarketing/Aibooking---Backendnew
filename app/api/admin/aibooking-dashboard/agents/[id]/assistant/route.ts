import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import {
  withErrorHandling,
  readJsonBody,
  requireParam,
  writeAuditLog,
  updateDashboardAssistantSchema,
} from "@/lib/security";
import { vapiFetch } from "@/lib/vapi/client";
import { buildEndCallTool } from "@/lib/vapi/assistants";
import { findWidgetIdForAssistant } from "@/lib/vapi/assistant-owner";
import { buildAssistantPatch, readAssistantConfig } from "@/lib/aibooking-dashboard/assistant-config";
import type { DashboardAgent } from "@/lib/aibooking-dashboard/calls";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

type Raw = Record<string, unknown>;

async function loadAgent(id: string): Promise<DashboardAgent> {
  const { data, error } = await getAdminClient().from("aibooking_dashboard_agents").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw ApiError.notFound("Agenten findes ikke");
  return data as DashboardAgent;
}

async function loadAssistant(assistantId: string): Promise<Raw> {
  try {
    const response = await vapiFetch(`/assistant/${encodeURIComponent(assistantId)}`, { method: "GET" });
    return (await response.json()) as Raw;
  } catch {
    throw ApiError.badRequest("Assistenten kunne ikke hentes fra Vapi. Tjek at ID'et er rigtigt.");
  }
}

// The types of the saved Vapi tools the assistant uses (model.toolIds), so an
// end-call tool attached that way is recognised and not added a second time.
async function savedToolTypes(assistant: Raw): Promise<string[]> {
  const model = (assistant.model ?? {}) as Raw;
  const ids = Array.isArray(model.toolIds) ? (model.toolIds as unknown[]).filter((id): id is string => typeof id === "string") : [];
  const types = await Promise.all(
    ids.map(async (id) => {
      try {
        const response = await vapiFetch(`/tool/${encodeURIComponent(id)}`, { method: "GET" });
        const tool = (await response.json()) as { type?: unknown };
        return typeof tool.type === "string" ? tool.type : null;
      } catch {
        return null;
      }
    })
  );
  return types.filter((type): type is string => type !== null);
}

// An assistant that also belongs to an agent in the platform's own agent
// list is rewritten by that agent's sync (and by "Vapi resync"), so edits
// made here would not last. The editor says so.
async function linkedWidgetName(assistantId: string): Promise<string | null> {
  const widgetId = await findWidgetIdForAssistant(assistantId);
  if (!widgetId) return null;
  const { data } = await getAdminClient().from("widgets").select("name").eq("id", widgetId).maybeSingle();
  return (data as { name?: string } | null)?.name ?? "en agent";
}

// The assistant's editable settings, read live from Vapi.
export const GET = withErrorHandling(async (_request, { params }) => {
  await requireMasterAdmin();
  const agent = await loadAgent(requireParam(params, "id"));
  const assistant = await loadAssistant(agent.vapi_assistant_id);
  const [toolTypes, linkedWidget] = await Promise.all([
    savedToolTypes(assistant),
    linkedWidgetName(agent.vapi_assistant_id),
  ]);
  return NextResponse.json({ config: readAssistantConfig(assistant, toolTypes), linkedWidget });
});

// Writes the edited settings back to the assistant in Vapi. Everything the
// editor does not show is sent back exactly as Vapi returned it.
export const PATCH = withErrorHandling(async (request, { params }) => {
  const ctx = await requireMasterAdmin();
  const agent = await loadAgent(requireParam(params, "id"));
  const input = await readJsonBody(request, updateDashboardAssistantSchema);

  const assistant = await loadAssistant(agent.vapi_assistant_id);
  const toolTypes = await savedToolTypes(assistant);

  let body: Raw;
  try {
    body = buildAssistantPatch(assistant, input, buildEndCallTool(), toolTypes);
  } catch (err) {
    throw ApiError.badRequest(err instanceof Error ? err.message : String(err));
  }
  if (Object.keys(body).length === 0) {
    return NextResponse.json({ config: readAssistantConfig(assistant, toolTypes) });
  }

  let updated: Raw;
  try {
    const response = await vapiFetch(`/assistant/${encodeURIComponent(agent.vapi_assistant_id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    updated = (await response.json()) as Raw;
  } catch (err) {
    console.error(`Could not update Vapi assistant ${agent.vapi_assistant_id}:`, String(err));
    throw ApiError.badRequest("Vapi afviste ændringen. Prøv igen, eller ret agenten direkte i Vapi.");
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "aibooking_dashboard.assistant_updated",
    entityType: "aibooking_dashboard_agent",
    entityId: agent.id,
    metadata: { vapiAssistantId: agent.vapi_assistant_id, fields: Object.keys(input) },
  });

  return NextResponse.json({ config: readAssistantConfig(updated, toolTypes) });
});
