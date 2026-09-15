import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { decryptSecret } from "@/lib/security/crypto";
import type { ShopifyConnectionSummary } from "./types";

// One place that reads and writes shopify_connections, so every caller gets
// the same two guarantees: a row is only ever reachable through the widget
// that owns it, and the access token is decrypted exactly where it is used
// and never anywhere else.

export interface ShopifyConnectionRow {
  id: string;
  customer_id: string;
  widget_id: string;
  shop_url: string | null;
  crawl_status: string;
  crawl_error: string | null;
  crawled_page_count: number;
  last_sync_at: string | null;
  shop_domain: string | null;
  access_token: string | null;
  scopes: string | null;
  status: string;
  status_error: string | null;
  connected_at: string | null;
}

// Everything except the token. Used by every read that is going to select a
// row into something a route might return, so the ciphertext cannot be
// selected by accident.
const PUBLIC_COLUMNS =
  "id, customer_id, widget_id, shop_url, crawl_status, crawl_error, crawled_page_count, last_sync_at, shop_domain, scopes, status, status_error, connected_at";

type SupabaseAdmin = ReturnType<typeof getAdminClient>;

// The ownership check every Shopify route starts with. Resolving the customer
// from the widget — rather than trusting a customer id in the request — is
// what makes one customer's webshop unreachable from another's session.
export async function loadOwnedWidget(
  supabase: SupabaseAdmin,
  widgetId: string,
  customerId: string
): Promise<{ id: string; customer_id: string } | null> {
  const { data, error } = await supabase
    .from("widgets")
    .select("id, customer_id")
    .eq("id", widgetId)
    .maybeSingle<{ id: string; customer_id: string }>();
  if (error) throw error;
  if (!data || data.customer_id !== customerId) return null;
  return data;
}

export async function getConnectionSummary(widgetId: string): Promise<ShopifyConnectionSummary | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("shopify_connections")
    .select(PUBLIC_COLUMNS)
    .eq("widget_id", widgetId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return toSummary(data as Omit<ShopifyConnectionRow, "access_token">);
}

export function toSummary(row: Omit<ShopifyConnectionRow, "access_token">): ShopifyConnectionSummary {
  return {
    shopUrl: row.shop_url,
    shopDomain: row.shop_domain,
    status: row.status as ShopifyConnectionSummary["status"],
    statusError: row.status_error,
    crawlStatus: row.crawl_status as ShopifyConnectionSummary["crawlStatus"],
    crawlError: row.crawl_error,
    pageCount: row.crawled_page_count,
    lastSyncAt: row.last_sync_at,
    connectedAt: row.connected_at,
  };
}

export interface ShopifyAdminCredentials {
  connectionId: string;
  shopDomain: string;
  accessToken: string;
  /** Comma-separated scopes Shopify actually granted at install time. */
  scopes: string | null;
}

// The Admin API half. Returns null — never throws — whenever this widget
// simply cannot look an order up: no row, no completed install, or a
// connection already marked as needing reconnection. Callers turn that into an
// honest "I can't check orders" instead of an error.
export async function loadAdminCredentials(widgetId: string): Promise<ShopifyAdminCredentials | null> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("shopify_connections")
    .select("id, shop_domain, access_token, scopes, status")
    .eq("widget_id", widgetId)
    .maybeSingle<{
      id: string;
      shop_domain: string | null;
      access_token: string | null;
      scopes: string | null;
      status: string;
    }>();

  if (!data || data.status !== "connected" || !data.shop_domain || !data.access_token) return null;

  try {
    return {
      connectionId: data.id,
      shopDomain: data.shop_domain,
      accessToken: decryptSecret(data.access_token),
      scopes: data.scopes,
    };
  } catch (err) {
    // A token that won't decrypt means the encryption key changed. Say so in
    // the log, not to the caller, and behave as "not connected".
    console.error("Failed to decrypt Shopify access token:", err);
    return null;
  }
}

// Called when Shopify itself tells us the token is no longer good (the
// merchant uninstalled or revoked the app). Flipping the status is what makes
// the dashboard show "needs reconnecting" instead of silently failing every
// order lookup from then on.
export async function markConnectionNeedsReauth(connectionId: string, reason: string): Promise<void> {
  const supabase = getAdminClient();
  await supabase
    .from("shopify_connections")
    .update({ status: "reauth_required", status_error: reason })
    .eq("id", connectionId);
}
