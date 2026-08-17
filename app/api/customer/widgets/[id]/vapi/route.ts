import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, vapiSyncSchema, requireParam } from "@/lib/security";
import { buildShareUrl, buildEmbedSnippet } from "@/lib/widgets";
import { createOrSyncVapiAssistant, deleteVapiAssistant, DEFAULT_AGENT_CAPABILITIES } from "@/lib/vapi";
import type { AgentCapabilities } from "@/lib/vapi/types";
import type { Widget } from "@/types/database";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

async function loadOwnWidget(supabase: ReturnType<typeof getAdminClient>, widgetId: string, customerId: string): Promise<Widget> {
  const { data, error } = await supabase.from("widgets").select("*").eq("id", widgetId).maybeSingle<Widget>();
  if (error) throw error;
  if (!data || data.customer_id !== customerId) throw ApiError.notFound("Widget not found");
  return data;
}

async function loadExtra(supabase: ReturnType<typeof getAdminClient>, widgetId: string): Promise<Record<string, unknown>> {
  const { data } = await supabase.from("widget_settings").select("extra").eq("widget_id", widgetId).maybeSingle();
  return (data?.extra as Record<string, unknown> | null) ?? {};
}

function capabilitiesFromExtra(extra: Record<string, unknown>): AgentCapabilities {
  const stored = (extra.capabilities as Partial<AgentCapabilities> | undefined) ?? {};
  return { ...DEFAULT_AGENT_CAPABILITIES, ...stored };
}

// Creates the widget's Vapi assistant on first call, updates the existing
// one (by stored vapi_assistant_id) on every subsequent call — this is the
// single endpoint behind the Voice Agent tab's "Create/update agent"
// button. Never creates two assistants for the same widget.
export const POST = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, vapiSyncSchema);
  const supabase = getAdminClient();
  const widgetId = requireParam(params, "id");

  const widget = await loadOwnWidget(supabase, widgetId, ctx.profile.customer_id!);

  const dbRow: Record<string, unknown> = {};
  if (body.businessDescription !== undefined) dbRow.business_description = body.businessDescription;
  if (body.businessPhone !== undefined) dbRow.business_phone = body.businessPhone;
  if (body.businessEmail !== undefined) dbRow.business_email = body.businessEmail;
  if (body.websiteUrl !== undefined) dbRow.website_url = body.websiteUrl;
  if (body.voiceProvider !== undefined) dbRow.vapi_voice_provider = body.voiceProvider;
  if (body.voiceId !== undefined) dbRow.vapi_voice_id = body.voiceId;
  if (body.llmProvider !== undefined) dbRow.vapi_llm_provider = body.llmProvider;
  if (body.llmModel !== undefined) dbRow.vapi_llm_model = body.llmModel;
  if (body.widgetMode !== undefined) dbRow.widget_mode = body.widgetMode;

  const existingExtra = await loadExtra(supabase, widgetId);
  let capabilities = capabilitiesFromExtra(existingExtra);
  if (body.capabilities) {
    capabilities = { ...capabilities, ...body.capabilities };
    await supabase.from("widget_settings").upsert({ widget_id: widgetId, extra: { ...existingExtra, capabilities } });
  }

  let widgetForVapi = widget;
  if (Object.keys(dbRow).length > 0) {
    const { data: updated, error } = await supabase.from("widgets").update(dbRow).eq("id", widgetId).select("*").single<Widget>();
    if (error) throw error;
    widgetForVapi = updated;
  }

  // Vapi is called only after the widget's own config is safely persisted,
  // and vapi_assistant_id is only written after Vapi confirms success — so
  // a Vapi-side failure never leaves an orphaned assistant reference or a
  // half-written widget row (see error-handling requirements in the task).
  let syncResult;
  try {
    syncResult = await createOrSyncVapiAssistant(widgetForVapi, capabilities);
  } catch (err) {
    console.error(`Vapi assistant sync failed for widget ${widgetId}:`, err);
    throw ApiError.internal("Could not create the voice agent right now. Please try again shortly.");
  }

  const { data: finalWidget, error: finalError } = await supabase
    .from("widgets")
    .update({ vapi_assistant_id: syncResult.vapiAssistantId, vapi_synced_at: new Date().toISOString() })
    .eq("id", widgetId)
    .select("*")
    .single<Widget>();
  if (finalError) throw finalError;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: ctx.profile.customer_id,
    action: syncResult.created ? "widget.vapi_assistant_created" : "widget.vapi_assistant_updated",
    entityType: "widget",
    entityId: widgetId,
    metadata: { vapiAssistantId: syncResult.vapiAssistantId },
  });

  return NextResponse.json(
    {
      widget: {
        ...finalWidget,
        shareUrl: buildShareUrl(finalWidget.public_id),
        embedSnippet: buildEmbedSnippet(finalWidget.public_id),
      },
      created: syncResult.created,
    },
    { status: syncResult.created ? 201 : 200 }
  );
});

// Removes the Vapi assistant behind this widget. The widget itself is kept
// (soft delete, matching the rest of this app) — only the Vapi link is
// cleared, so the customer can reconfigure and create a fresh assistant.
export const DELETE = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const widgetId = requireParam(params, "id");

  const widget = await loadOwnWidget(supabase, widgetId, ctx.profile.customer_id!);

  if (!widget.vapi_assistant_id) {
    return NextResponse.json({ widget });
  }

  try {
    await deleteVapiAssistant(widget.vapi_assistant_id);
  } catch (err) {
    // Still clear our local reference even if the remote delete failed
    // (e.g. it was already removed on Vapi's side) — a dangling id that
    // blocks re-creating the assistant is worse than a rare orphaned
    // assistant left in the Vapi dashboard.
    console.error(`Failed to delete Vapi assistant ${widget.vapi_assistant_id}:`, err);
  }

  const { data: updated, error } = await supabase
    .from("widgets")
    .update({ vapi_assistant_id: null, vapi_synced_at: null })
    .eq("id", widgetId)
    .select("*")
    .single<Widget>();
  if (error) throw error;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: ctx.profile.customer_id,
    action: "widget.vapi_assistant_deleted",
    entityType: "widget",
    entityId: widgetId,
  });

  return NextResponse.json({ widget: updated });
});
