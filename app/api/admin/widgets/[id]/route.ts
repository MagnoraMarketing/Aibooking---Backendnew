import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, widgetUpdateSchema } from "@/lib/security";
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

export const PATCH = withErrorHandling(async (request, { params }) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, widgetUpdateSchema);
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("widgets")
    .update(widgetUpdateToDbRow(body))
    .eq("id", params.id)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw ApiError.notFound("Widget not found");

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: data.customer_id,
    action: "widget.updated",
    entityType: "widget",
    entityId: params.id,
    metadata: body,
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
