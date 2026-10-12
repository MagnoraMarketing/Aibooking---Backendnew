import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog, encryptSecret } from "@/lib/security";
import { hashOAuthState } from "@/lib/calendar/oauth-state";
import { normalizeMyshopifyDomain } from "@/lib/shopify/domain";
import { exchangeShopifyCode, verifyCallbackHmac } from "@/lib/shopify/oauth";
import { syncWidgetToVapiAssistant } from "@/lib/vapi";
import type { Widget } from "@/types/database";

export const dynamic = "force-dynamic";

// Where Shopify sends the merchant back after they approve the install.
//
// Three independent checks have to pass before a token is even requested, and
// each one closes a different hole:
//   - the HMAC proves the query string came from Shopify and wasn't edited;
//   - the stored state proves this callback belongs to an install WE started;
//   - the widget's customer proves the person finishing it is the one who
//     started it.
// Any of them failing sends the merchant back to the dashboard with an error,
// never to a half-connected state.

function redirectTo(request: Request, widgetId: string | null, status: string) {
  const url = new URL(widgetId ? `/dashboard/agent/${widgetId}` : "/dashboard", request.url);
  if (widgetId) url.searchParams.set("tab", "webshop");
  url.searchParams.set("shopify", status);
  return NextResponse.redirect(url);
}

export const GET = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const { searchParams } = new URL(request.url);

  const code = searchParams.get("code");
  const shop = searchParams.get("shop");
  const state = searchParams.get("state");

  if (!code || !shop || !state) return redirectTo(request, null, "error");
  if (!verifyCallbackHmac(searchParams)) {
    console.error("Shopify OAuth callback failed HMAC verification");
    return redirectTo(request, null, "error");
  }

  const shopDomain = normalizeMyshopifyDomain(shop);
  if (!shopDomain) return redirectTo(request, null, "error");

  const supabase = getAdminClient();

  const { data: stateRow } = await supabase
    .from("shopify_oauth_states")
    .select("customer_id, widget_id, shop_domain, expires_at")
    .eq("state_hash", hashOAuthState(state))
    .maybeSingle<{ customer_id: string; widget_id: string; shop_domain: string; expires_at: string }>();

  // Single-use: consumed whether or not the rest succeeds, so a state can
  // never be replayed.
  if (stateRow) {
    await supabase.from("shopify_oauth_states").delete().eq("state_hash", hashOAuthState(state));
  }

  if (!stateRow) return redirectTo(request, null, "error");
  if (new Date(stateRow.expires_at).getTime() < Date.now()) return redirectTo(request, stateRow.widget_id, "expired");
  // The shop that came back must be the shop we sent them to. Without this,
  // an install approved on a different store would be recorded against this
  // widget.
  if (stateRow.shop_domain !== shopDomain) return redirectTo(request, stateRow.widget_id, "error");
  if (stateRow.customer_id !== ctx.profile.customer_id) return redirectTo(request, null, "error");

  const { data: widget } = await supabase
    .from("widgets")
    .select("*")
    .eq("id", stateRow.widget_id)
    .maybeSingle<Widget>();
  if (!widget || widget.customer_id !== ctx.profile.customer_id) return redirectTo(request, null, "error");

  let token;
  try {
    token = await exchangeShopifyCode(shopDomain, code);
  } catch (err) {
    console.error("Shopify token exchange failed:", err);
    return redirectTo(request, widget.id, "error");
  }

  // upsert rather than insert: the customer may have saved their webshop URL
  // first (the expected order), in which case the row already exists and only
  // the admin half is being filled in.
  const { error } = await supabase.from("shopify_connections").upsert(
    {
      customer_id: widget.customer_id,
      widget_id: widget.id,
      shop_domain: shopDomain,
      access_token: encryptSecret(token.accessToken),
      scopes: token.scope,
      status: "connected",
      status_error: null,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "widget_id" }
  );
  if (error) throw error;

  // The assistant needs the get_shopify_order_status tool attached now that it
  // can actually answer with it.
  const { data: settings } = await supabase
    .from("widget_settings")
    .select("extra")
    .eq("widget_id", widget.id)
    .maybeSingle<{ extra: Record<string, unknown> | null }>();
  await syncWidgetToVapiAssistant(widget, settings?.extra ?? {});

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: widget.customer_id,
    action: "shopify.order_tracking.connected",
    entityType: "widget",
    entityId: widget.id,
    // The shop domain and granted scopes are safe to record; the token is not,
    // and never appears in a log line anywhere in this integration.
    metadata: { shopDomain, scopes: token.scope },
  });

  return redirectTo(request, widget.id, "connected");
});
