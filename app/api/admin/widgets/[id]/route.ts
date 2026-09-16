import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import {
  readJsonBody,
  withErrorHandling,
  writeAuditLog,
  widgetUpdateSchema,
  widgetExtraSettingsSchema,
} from "@/lib/security";
import { widgetUpdateToDbRow, buildShareUrl, buildEmbedSnippet } from "@/lib/widgets";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (_request, { params }) => {
  await requireMasterAdmin();
  const supabase = getAdminClient();

  const { data: widget, error } = await supabase.from("widgets").select("*").eq("id", params.id).maybeSingle();
  if (error) throw error;
  if (!widget) throw ApiError.notFound("Widget not found");

  return NextResponse.json({
    widget: { ...widget, shareUrl: buildShareUrl(widget.public_id), embedSnippet: buildEmbedSnippet(widget.public_id) },
  });
});

// The widget's own columns, plus the free-form settings in
// widget_settings.extra — the customer dashboard could already edit those,
// support could not, so anything living there (an agent's outbound assistant,
// say) was a database job.
const adminWidgetUpdateSchema = widgetUpdateSchema.extend({
  extra: widgetExtraSettingsSchema.optional(),
});

export const PATCH = withErrorHandling(async (request, { params }) => {
  const ctx = await requireMasterAdmin();
  const { extra: extraUpdate, ...widgetFields } = await readJsonBody(request, adminWidgetUpdateSchema);
  const supabase = getAdminClient();

  const widgetRow = widgetUpdateToDbRow(widgetFields);

  // An extra-only edit must not send an empty UPDATE — fetch instead, so the
  // response still carries the widget and the audit log still has its
  // customer.
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

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: data.customer_id,
    action: "widget.updated",
    entityType: "widget",
    entityId: params.id,
    metadata: { ...widgetFields, ...(extraUpdate ? { extra: extraUpdate } : {}) },
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
