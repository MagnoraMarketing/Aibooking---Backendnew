import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, updateAdminWidgetSchema } from "@/lib/security";
import { widgetUpdateToDbRow, buildShareUrl, buildEmbedSnippet } from "@/lib/widgets";
import { applyAdminWidgetConnections } from "@/lib/admin/widget-service";
import { ApiError } from "@/types/errors";
import type { Widget } from "@/types/database";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (_request, { params }) => {
  await requireMasterAdmin();
  const supabase = getAdminClient();

  const { data: widget, error } = await supabase
    .from("widgets")
    .select("*, customers(id, name, email), wapi_agents(id, wapi_agent_id, name), phone_numbers(id, phone_number)")
    .eq("id", params.id)
    .maybeSingle();
  if (error) throw error;
  if (!widget) throw ApiError.notFound("Widget not found");

  return NextResponse.json({
    widget: { ...widget, shareUrl: buildShareUrl(widget.public_id), embedSnippet: buildEmbedSnippet(widget.public_id) },
  });
});

// The widget's own columns, plus the free-form settings in
// widget_settings.extra (already supported for admin edits — see comment
// below) and, new here, its Wapi agent / phone number connection and
// deployment type (spec sections 4, 6, 8, 9).
export const PATCH = withErrorHandling(async (request, { params }) => {
  const ctx = await requireMasterAdmin();
  const {
    extra: extraUpdate,
    wapiAgentId,
    wapiAgentExternalId,
    phoneNumberId,
    deploymentType,
    calcomApiKey,
    calcomEventTypeId,
    ...widgetFields
  } = await readJsonBody(request, updateAdminWidgetSchema);
  const supabase = getAdminClient();

  const widgetRow = widgetUpdateToDbRow(widgetFields);
  if (deploymentType !== undefined) widgetRow.deployment_type = deploymentType;

  // An extra-only/connection-only edit must not send an empty UPDATE — fetch
  // instead, so the response still carries the widget and the audit log
  // still has its customer.
  const { data, error } =
    Object.keys(widgetRow).length > 0
      ? await supabase.from("widgets").update(widgetRow).eq("id", params.id).select("*").maybeSingle()
      : await supabase.from("widgets").select("*").eq("id", params.id).maybeSingle();

  if (error) throw error;
  if (!data) throw ApiError.notFound("Widget not found");

  // Merged, never replaced: the other tabs' keys live in the same blob, and
  // support editing one field must not wipe the knowledge base.
  if (extraUpdate) {
    const { data: settings } = await supabase
      .from("widget_settings")
      .select("extra")
      .eq("widget_id", params.id)
      .maybeSingle();
    const extra = { ...((settings?.extra as Record<string, unknown> | null) ?? {}), ...extraUpdate };
    const { error: extraError } = await supabase
      .from("widget_settings")
      .upsert({ widget_id: params.id, extra });
    if (extraError) throw extraError;
  }

  const connection = await applyAdminWidgetConnections(
    data as Widget,
    { wapiAgentId, wapiAgentExternalId, phoneNumberId, calcomApiKey, calcomEventTypeId },
    { userId: ctx.userId, role: ctx.profile.role }
  );

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: data.customer_id,
    action: "widget.updated",
    entityType: "widget",
    entityId: params.id,
    metadata: {
      ...widgetFields,
      ...(extraUpdate ? { extra: extraUpdate } : {}),
      ...(connection ? { wapiAgentConnected: connection.vapiAssistantId, phoneNumberId } : {}),
    },
  });

  return NextResponse.json({ widget: data });
});

export const DELETE = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireMasterAdmin();
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("widgets")
    .update({ status: "paused" })
    .eq("id", params.id)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw ApiError.notFound("Widget not found");

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: data.customer_id,
    action: "widget.paused",
    entityType: "widget",
    entityId: params.id,
  });

  return NextResponse.json({ success: true });
});
