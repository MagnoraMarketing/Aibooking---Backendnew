import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog, requireParam } from "@/lib/security";
import { getConnectionSummary, loadOwnedWidget } from "@/lib/shopify/connection";
import { syncWidgetToVapiAssistant } from "@/lib/vapi";
import { ApiError } from "@/types/errors";
import type { Widget } from "@/types/database";

export const dynamic = "force-dynamic";

// Disconnects order tracking only, leaving the public webshop knowledge in
// place — the two halves are independent (see 0035_shopify_integration.sql),
// and a customer who wants to revoke our access to their orders should not
// lose their product answers as well.
//
// Clearing the token here is the local half of revoking. The merchant
// uninstalls the app on Shopify's side to revoke it there; either way the next
// order lookup finds no credentials and the agent says it can't check.
export const DELETE = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const widgetId = requireParam(params, "id");

  const owned = await loadOwnedWidget(supabase, widgetId, ctx.profile.customer_id!);
  if (!owned) throw ApiError.notFound("Widget not found");

  const { error } = await supabase
    .from("shopify_connections")
    .update({
      access_token: null,
      shop_domain: null,
      scopes: null,
      status: "not_connected",
      status_error: null,
      connected_at: null,
    })
    .eq("widget_id", widgetId);
  if (error) throw error;

  // The assistant is holding a get_shopify_order_status tool it can no longer
  // fulfil — re-syncing drops it.
  const { data: widget } = await supabase.from("widgets").select("*").eq("id", widgetId).maybeSingle<Widget>();
  if (widget) {
    const { data: settings } = await supabase
      .from("widget_settings")
      .select("extra")
      .eq("widget_id", widgetId)
      .maybeSingle<{ extra: Record<string, unknown> | null }>();
    await syncWidgetToVapiAssistant(widget, settings?.extra ?? {});
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: ctx.profile.customer_id,
    action: "shopify.order_tracking.disconnected",
    entityType: "widget",
    entityId: widgetId,
  });

  return NextResponse.json({ connection: await getConnectionSummary(widgetId) });
});
