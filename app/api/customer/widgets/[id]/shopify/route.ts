import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import {
  readJsonBody,
  withErrorHandling,
  writeAuditLog,
  requireParam,
  shopifyWebshopInputSchema,
} from "@/lib/security";
import { normalizeShopUrl } from "@/lib/shopify/domain";
import { getConnectionSummary, loadOwnedWidget } from "@/lib/shopify/connection";
import { syncShopifyWebshop, removeShopifyKnowledge } from "@/lib/shopify/sync";
import { isShopifyOAuthConfigured } from "@/lib/shopify/oauth";
import { ApiError } from "@/types/errors";
import type { Widget } from "@/types/database";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";
// Saving a webshop crawls it inline so the customer sees the result rather
// than a spinner that resolves into nothing. A large shop's product pages plus
// a dozen policy pages needs more than the default serverless budget.
export const maxDuration = 60;

// The "1. Webshop" half of the Shopify setup: the customer pastes their public
// webshop URL, and that is the whole interaction. No API keys, no Shopify
// login — that is step 2, and deliberately separate (see
// 0035_shopify_integration.sql).

async function requireOwnWidget(widgetId: string, customerId: string): Promise<Widget> {
  const supabase = getAdminClient();
  const { data, error } = await supabase.from("widgets").select("*").eq("id", widgetId).maybeSingle<Widget>();
  if (error) throw error;
  if (!data || data.customer_id !== customerId) throw ApiError.notFound("Widget not found");
  return data;
}

export const GET = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const widgetId = requireParam(params, "id");

  const widget = await loadOwnedWidget(supabase, widgetId, ctx.profile.customer_id!);
  if (!widget) throw ApiError.notFound("Widget not found");

  return NextResponse.json({
    connection: await getConnectionSummary(widgetId),
    // The dashboard hides the "Connect Shopify" button entirely when the
    // platform has no Shopify app configured, rather than offering a button
    // that can only fail.
    oauthAvailable: isShopifyOAuthConfigured(),
  });
});

export const PUT = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const widgetId = requireParam(params, "id");
  const widget = await requireOwnWidget(widgetId, ctx.profile.customer_id!);

  const body = await readJsonBody(request, shopifyWebshopInputSchema);
  const normalized = normalizeShopUrl(body.shopUrl);
  if (!normalized) throw ApiError.badRequest("invalid_url");

  const { error } = await supabase.from("shopify_connections").upsert(
    {
      customer_id: widget.customer_id,
      widget_id: widget.id,
      shop_url: normalized.origin,
      crawl_status: "pending",
      crawl_error: null,
    },
    { onConflict: "widget_id" }
  );
  if (error) throw error;

  const result = await syncShopifyWebshop({ widget, shopUrl: normalized.origin });

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: widget.customer_id,
    action: "shopify.webshop.saved",
    entityType: "widget",
    entityId: widget.id,
    // The URL is the customer's own public shop address, not a secret.
    metadata: { shopUrl: normalized.origin, ok: result.ok, failure: result.failure ?? null },
  });

  return NextResponse.json({
    connection: await getConnectionSummary(widgetId),
    sync: result,
  });
});

// Removes the webshop entirely — the crawled catalogue, the agent's webshop
// knowledge, and the Shopify Admin connection with it. Anything less would
// leave the agent still answering product questions from a shop the customer
// believes they disconnected.
export const DELETE = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const widgetId = requireParam(params, "id");
  const widget = await requireOwnWidget(widgetId, ctx.profile.customer_id!);

  const { error } = await supabase.from("shopify_connections").delete().eq("widget_id", widget.id);
  if (error) throw error;

  await removeShopifyKnowledge(widget);

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: widget.customer_id,
    action: "shopify.webshop.removed",
    entityType: "widget",
    entityId: widget.id,
  });

  return NextResponse.json({ connection: null });
});
