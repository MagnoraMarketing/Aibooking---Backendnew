import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, shopifyConnectQuerySchema } from "@/lib/security";
import { hashOAuthState } from "@/lib/calendar/oauth-state";
import { normalizeMyshopifyDomain } from "@/lib/shopify/domain";
import { buildShopifyAuthorizeUrl, generateOAuthState } from "@/lib/shopify/oauth";
import { loadOwnedWidget } from "@/lib/shopify/connection";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// Step 2 of the Shopify setup: send the merchant to their own shop's
// permission prompt. Nothing sensitive is handed to the browser here — the
// customer is redirected to Shopify, approves there, and comes back to
// ../callback.
//
// The widget being connected is bound into the stored state, not carried in
// the callback URL, so a forged callback cannot attach a shop to a widget the
// caller doesn't own.
export const GET = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const { searchParams } = new URL(request.url);
  const parsed = shopifyConnectQuerySchema.safeParse({
    widgetId: searchParams.get("widgetId"),
    shop: searchParams.get("shop"),
  });
  if (!parsed.success) throw ApiError.badRequest("Missing or invalid widgetId/shop");

  const shopDomain = normalizeMyshopifyDomain(parsed.data.shop);
  if (!shopDomain) throw ApiError.badRequest("invalid_shop_domain");

  const supabase = getAdminClient();
  const widget = await loadOwnedWidget(supabase, parsed.data.widgetId, ctx.profile.customer_id!);
  if (!widget) throw ApiError.notFound("Widget not found");

  const state = generateOAuthState();
  // Only the hash is stored: a leaked database row can't be replayed as a
  // valid callback.
  const { error } = await supabase.from("shopify_oauth_states").insert({
    state_hash: hashOAuthState(state),
    customer_id: widget.customer_id,
    widget_id: widget.id,
    shop_domain: shopDomain,
  });
  if (error) throw error;

  return NextResponse.redirect(buildShopifyAuthorizeUrl(shopDomain, state));
});
