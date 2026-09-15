import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog, requireParam } from "@/lib/security";
import { getConnectionSummary } from "@/lib/shopify/connection";
import { syncShopifyWebshop } from "@/lib/shopify/sync";
import { ApiError } from "@/types/errors";
import type { Widget } from "@/types/database";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Refresh Shopify data". Re-crawls the shop the customer already saved, so
// new products and changed prices reach the agent. The URL is read from the
// stored row rather than the request — a refresh cannot quietly become a
// re-point at a different shop.
export const POST = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const widgetId = requireParam(params, "id");

  const { data: widget, error } = await supabase.from("widgets").select("*").eq("id", widgetId).maybeSingle<Widget>();
  if (error) throw error;
  if (!widget || widget.customer_id !== ctx.profile.customer_id) throw ApiError.notFound("Widget not found");

  const { data: connection } = await supabase
    .from("shopify_connections")
    .select("shop_url")
    .eq("widget_id", widgetId)
    .maybeSingle<{ shop_url: string | null }>();

  if (!connection?.shop_url) throw ApiError.badRequest("no_webshop");

  const result = await syncShopifyWebshop({ widget, shopUrl: connection.shop_url });

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: widget.customer_id,
    action: "shopify.webshop.synced",
    entityType: "widget",
    entityId: widget.id,
    metadata: { ok: result.ok, pageCount: result.pageCount },
  });

  return NextResponse.json({ connection: await getConnectionSummary(widgetId), sync: result });
});
