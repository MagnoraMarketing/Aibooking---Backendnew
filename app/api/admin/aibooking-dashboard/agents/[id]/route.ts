import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import {
  withErrorHandling,
  readJsonBody,
  requireParam,
  writeAuditLog,
  updateDashboardAgentSchema,
} from "@/lib/security";
import { assertVapiAssistantExists } from "@/lib/aibooking-dashboard/service";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Changing an agent's Vapi id only changes which calls the dashboard shows.
// It does not touch the assistant itself or what answers the widget/phone.
export const PATCH = withErrorHandling(async (request, { params }) => {
  const ctx = await requireMasterAdmin();
  const id = requireParam(params, "id");
  const input = await readJsonBody(request, updateDashboardAgentSchema);
  if (input.vapiAssistantId) await assertVapiAssistantExists(input.vapiAssistantId);

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.channel !== undefined) update.channel = input.channel;
  if (input.vapiAssistantId !== undefined) update.vapi_assistant_id = input.vapiAssistantId;
  if (input.isActive !== undefined) update.is_active = input.isActive;
  if (input.sortOrder !== undefined) update.sort_order = input.sortOrder;
  if (Object.keys(update).length === 0) throw ApiError.badRequest("Intet at opdatere");

  const { data, error } = await getAdminClient()
    .from("aibooking_dashboard_agents")
    .update(update)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error?.code === "23505") throw ApiError.conflict("Denne Vapi-assistent er allerede på dashboardet.");
  if (error) throw error;
  if (!data) throw ApiError.notFound("Agenten findes ikke");

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "aibooking_dashboard.agent_updated",
    entityType: "aibooking_dashboard_agent",
    entityId: id,
    metadata: update,
  });

  return NextResponse.json({ agent: data });
});

export const DELETE = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireMasterAdmin();
  const id = requireParam(params, "id");

  const { data, error } = await getAdminClient()
    .from("aibooking_dashboard_agents")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw ApiError.notFound("Agenten findes ikke");

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "aibooking_dashboard.agent_removed",
    entityType: "aibooking_dashboard_agent",
    entityId: id,
  });

  return NextResponse.json({ success: true });
});
