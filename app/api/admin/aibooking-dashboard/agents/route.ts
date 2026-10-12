import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, readJsonBody, writeAuditLog, createDashboardAgentSchema } from "@/lib/security";
import { assertVapiAssistantExists, listDashboardAgents } from "@/lib/aibooking-dashboard/service";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// The agents shown on the Aibooking.dk Dashboard — AIbooking's own widget,
// inbound line and (later) outbound, each one a Vapi assistant.
export const GET = withErrorHandling(async () => {
  await requireMasterAdmin();
  return NextResponse.json({ agents: await listDashboardAgents() });
});

export const POST = withErrorHandling(async (request) => {
  const ctx = await requireMasterAdmin();
  const input = await readJsonBody(request, createDashboardAgentSchema);
  await assertVapiAssistantExists(input.vapiAssistantId);

  const supabase = getAdminClient();
  const existing = await listDashboardAgents();
  const { data, error } = await supabase
    .from("aibooking_dashboard_agents")
    .insert({
      name: input.name,
      channel: input.channel,
      vapi_assistant_id: input.vapiAssistantId,
      sort_order: existing.reduce((max, agent) => Math.max(max, agent.sort_order + 1), 0),
    })
    .select("*")
    .single();
  if (error?.code === "23505") throw ApiError.conflict("Denne Vapi-assistent er allerede på dashboardet.");
  if (error) throw error;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "aibooking_dashboard.agent_added",
    entityType: "aibooking_dashboard_agent",
    entityId: data.id as string,
    metadata: { name: input.name, channel: input.channel, vapiAssistantId: input.vapiAssistantId },
  });

  return NextResponse.json({ agent: data }, { status: 201 });
});
