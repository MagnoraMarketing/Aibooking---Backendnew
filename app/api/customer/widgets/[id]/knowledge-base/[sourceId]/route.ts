import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog, requireParam } from "@/lib/security";
import type { KnowledgeBaseSource } from "@/lib/knowledge-base/types";
import { syncWidgetToVapiAssistant } from "@/lib/vapi";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// No refund on delete — the content already had its (one-time) effect on
// every conversation since it was added; removing it now doesn't undo that.
export const DELETE = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const widgetId = requireParam(params, "id");
  const sourceId = requireParam(params, "sourceId");

  const { data: widget, error } = await supabase.from("widgets").select("*").eq("id", widgetId).maybeSingle();
  if (error) throw error;
  if (!widget || widget.customer_id !== ctx.profile.customer_id) throw ApiError.notFound("Widget not found");

  const { data: settings } = await supabase
    .from("widget_settings")
    .select("extra")
    .eq("widget_id", widgetId)
    .maybeSingle();
  const extra = (settings?.extra as Record<string, unknown> | null) ?? {};
  const existingSources = (extra.knowledgeBase as KnowledgeBaseSource[] | undefined) ?? [];
  const updatedSources = existingSources.filter((source) => source.id !== sourceId);

  if (updatedSources.length === existingSources.length) {
    throw ApiError.notFound("Knowledge base source not found");
  }

  const updatedExtra = { ...extra, knowledgeBase: updatedSources };
  const { error: upsertError } = await supabase
    .from("widget_settings")
    .upsert({ widget_id: widgetId, extra: updatedExtra });
  if (upsertError) throw upsertError;

  await syncWidgetToVapiAssistant(widget, updatedExtra);

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: ctx.profile.customer_id,
    action: "widget.knowledge_base.removed",
    entityType: "widget",
    entityId: widgetId,
    metadata: { sourceId },
  });

  return NextResponse.json({ knowledgeBase: updatedSources });
});
