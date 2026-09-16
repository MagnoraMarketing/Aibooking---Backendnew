import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import {
  withErrorHandling,
  writeAuditLog,
  requireParam,
  readJsonBody,
  encryptSecret,
  shopifyManualConnectSchema,
} from "@/lib/security";
import { getConnectionSummary, loadOwnedWidget } from "@/lib/shopify/connection";
import { isShopifyOAuthConfigured } from "@/lib/shopify/oauth";
import { normalizeMyshopifyDomain } from "@/lib/shopify/domain";
import { fetchShopifyAccessScopes, ShopifyAdminApiError } from "@/lib/shopify/admin-api";
import { SHOPIFY_SCOPES } from "@/lib/shopify/oauth";
import { syncWidgetToVapiAssistant } from "@/lib/vapi";
import { ApiError } from "@/types/errors";
import type { Widget } from "@/types/database";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Status, connect and disconnect for one widget's Shopify connection.
//
// There are two ways in. OAuth (../../../shopify/connect) is the better one
// and needs a Shopify app configured on the platform. POST here is the other:
// the merchant creates a custom app in their own Shopify admin, assigns the
// read scopes, and pastes the Admin API access token — the same shape Cal.com
// uses, and the only route available to a platform without its own app.
//
// Either way nothing about the shop is stored but the connection: every
// product, price, policy and order is read from the Admin API at the moment a
// customer asks.

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
// Which of the scopes we need this token is actually missing, so the customer
// is told what to tick rather than just "that didn't work".
const REQUIRED_SCOPES = SHOPIFY_SCOPES.split(",").map((scope) => scope.trim());

export const POST = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const widgetId = requireParam(params, "id");

  const owned = await loadOwnedWidget(supabase, widgetId, ctx.profile.customer_id!);
  if (!owned) throw ApiError.notFound("Widget not found");

  const body = await readJsonBody(request, shopifyManualConnectSchema);

  const shopDomain = normalizeMyshopifyDomain(body.shop);
  if (!shopDomain) throw ApiError.badRequest("invalid_shop_domain");

  // Verifying before storing is the point: a token that can't be used is
  // worse stored than rejected, because the failure then surfaces mid-call to
  // a customer instead of here, where someone can fix it.
  let granted: string[];
  try {
    granted = await fetchShopifyAccessScopes({ shopDomain, accessToken: body.accessToken });
  } catch (err) {
    if (err instanceof ShopifyAdminApiError && err.kind === "unauthorized") {
      throw ApiError.badRequest("invalid_token");
    }
    console.error("Shopify manual connect verification failed:", err);
    throw ApiError.badRequest("verification_failed");
  }

  const missing = REQUIRED_SCOPES.filter((scope) => !granted.includes(scope));
  // read_products is the one the agent is useless without. The others narrow
  // what it can answer, and resolveShopifyCapabilities already gates on them,
  // so a token missing only those still connects — it just gets fewer tools.
  if (!granted.includes("read_products")) {
    throw ApiError.badRequest(`missing_scopes:${missing.join(",")}`);
  }

  const { error } = await supabase.from("shopify_connections").upsert(
    {
      customer_id: owned.customer_id,
      widget_id: owned.id,
      shop_domain: shopDomain,
      access_token: encryptSecret(body.accessToken),
      scopes: granted.join(","),
      status: "connected",
      status_error: null,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "widget_id" }
  );
  if (error) throw error;

  // The assistant needs its Shopify tools attached now that it can use them.
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
    customerId: owned.customer_id,
    action: "shopify.connected",
    entityType: "widget",
    entityId: widgetId,
    // The shop and the granted scopes are safe to record; the token is not,
    // and appears in no log line anywhere in this integration.
    metadata: { shopDomain, scopes: granted.join(","), method: "manual_token" },
  });

  return NextResponse.json({
    connection: await getConnectionSummary(widgetId),
    missingScopes: missing,
  });
});

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
