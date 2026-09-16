import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog, requireParam } from "@/lib/security";
import { getConnectionSummary, loadOwnedWidget } from "@/lib/shopify/connection";
import { isShopifyOAuthConfigured } from "@/lib/shopify/oauth";
import { syncWidgetToVapiAssistant } from "@/lib/vapi";
import { ApiError } from "@/types/errors";
import type { Widget } from "@/types/database";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Status and disconnect for one widget's Shopify connection. There is nothing
// to save here and nothing to sync: connecting is the OAuth redirect in
// ../../../shopify/connect, and everything the agent knows about the shop is
// read from the Admin API at the moment a customer asks.

export const GET = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const widgetId = requireParam(params, "id");

  const widget = await loadOwnedWidget(supabase, widgetId, ctx.profile.customer_id!);
  if (!widget) throw ApiError.notFound("Widget not found");

  return NextResponse.json({
    connection: await getConnectionSummary(widgetId),
    // The dashboard hides the Connect button entirely when the platform has no
    // Shopify app configured, rather than offering one that can only fail.
    oauthAvailable: isShopifyOAuthConfigured(),
  });
});

// Disconnects the shop from this widget. The row goes with it: it holds only
// the connection, so there is nothing else to clean up.
//
// This is the local half of revoking. The merchant uninstalls the app on
// Shopify's side to revoke it there; either way the next lookup finds no
// credentials and the agent says it can't check.
export const DELETE = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const widgetId = requireParam(params, "id");

  const owned = await loadOwnedWidget(supabase, widgetId, ctx.profile.customer_id!);
  if (!owned) throw ApiError.notFound("Widget not found");

  const { error } = await supabase.from("shopify_connections").delete().eq("widget_id", widgetId);
  if (error) throw error;

  // The assistant is still holding Shopify tools it can no longer fulfil —
  // re-syncing drops them.
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
    action: "shopify.disconnected",
    entityType: "widget",
    entityId: widgetId,
  });

  return NextResponse.json({ connection: null });
});
