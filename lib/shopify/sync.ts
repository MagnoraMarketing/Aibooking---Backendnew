import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { syncWidgetToVapiAssistant } from "@/lib/vapi";
import type { KnowledgeBaseSource } from "@/lib/knowledge-base/types";
import type { Widget } from "@/types/database";
import { crawlShopifyStore, ShopifyCrawlError } from "./crawl";
import { formatShopifyKnowledge, replaceShopifySource, SHOPIFY_SOURCE_ID } from "./knowledge";

// Runs one webshop sync end to end: read the shop's public information pages,
// rewrite the agent's Shopify knowledge source, and push the new prompt to the
// widget's Vapi assistant.
//
// Products are not part of this. They are looked up live per question through
// the Admin API (lib/shopify/products.ts), so nothing here can go stale into a
// price the agent quotes.
//
// The knowledge lands in widget_settings.extra.knowledgeBase like every other
// source, under one FIXED id. That id is the whole trick: a re-sync replaces
// the previous crawl instead of stacking a second copy of the shop next to it,
// which is what "Refresh Shopify data" has to mean.

export type ShopifySyncFailure = "invalid_url" | "unreachable" | "not_shopify" | "failed";

export interface ShopifySyncResult {
  ok: boolean;
  failure?: ShopifySyncFailure;
  pageCount: number;
}

export async function syncShopifyWebshop(params: {
  widget: Widget;
  shopUrl: string;
}): Promise<ShopifySyncResult> {
  const supabase = getAdminClient();
  const { widget, shopUrl } = params;

  await supabase
    .from("shopify_connections")
    .update({ crawl_status: "running", crawl_error: null })
    .eq("widget_id", widget.id);

  let crawl;
  try {
    crawl = await crawlShopifyStore(shopUrl);
  } catch (err) {
    const failure: ShopifySyncFailure =
      err instanceof ShopifyCrawlError && (err.message === "invalid_url" || err.message === "unreachable")
        ? (err.message as ShopifySyncFailure)
        : "failed";
    // Technical detail stays server-side; the column holds a short code the UI
    // turns into a sentence the customer can act on.
    console.error("Shopify crawl failed:", err);
    await supabase
      .from("shopify_connections")
      .update({ crawl_status: "error", crawl_error: failure })
      .eq("widget_id", widget.id);
    return { ok: false, failure, pageCount: 0 };
  }

  if (!crawl.looksLikeShopify) {
    await supabase
      .from("shopify_connections")
      .update({ crawl_status: "error", crawl_error: "not_shopify" })
      .eq("widget_id", widget.id);
    return { ok: false, failure: "not_shopify", pageCount: 0 };
  }

  const content = formatShopifyKnowledge(crawl, shopUrl);

  const { error: connectionError } = await supabase
    .from("shopify_connections")
    .update({
      crawl_status: "ok",
      crawl_error: null,
      crawled_page_count: crawl.pages.length,
      last_sync_at: new Date().toISOString(),
    })
    .eq("widget_id", widget.id);
  if (connectionError) throw connectionError;

  const { data: settings } = await supabase
    .from("widget_settings")
    .select("extra")
    .eq("widget_id", widget.id)
    .maybeSingle<{ extra: Record<string, unknown> | null }>();

  const extra = settings?.extra ?? {};
  const sources = (extra.knowledgeBase as KnowledgeBaseSource[] | undefined) ?? [];

  const source: KnowledgeBaseSource = {
    id: SHOPIFY_SOURCE_ID,
    type: "shopify",
    label: `Webshop: ${shopUrl}`,
    content,
    characterCount: content.length,
    // Free, unlike a manual knowledge-base upload. The customer did not choose
    // how much text their own shop contains, and a re-sync they are told to run
    // must not quietly cost them minutes every time.
    costSeconds: 0,
    createdAt: new Date().toISOString(),
  };

  const updatedExtra = { ...extra, knowledgeBase: replaceShopifySource(sources, source) };
  const { error: settingsError } = await supabase
    .from("widget_settings")
    .upsert({ widget_id: widget.id, extra: updatedExtra });
  if (settingsError) throw settingsError;

  await syncWidgetToVapiAssistant(widget, updatedExtra);

  return { ok: true, pageCount: crawl.pages.length };
}

// Disconnecting the webshop has to take its knowledge with it — otherwise the
// agent keeps answering from a catalogue the customer believes they removed.
export async function removeShopifyKnowledge(widget: Widget): Promise<void> {
  const supabase = getAdminClient();
  const { data: settings } = await supabase
    .from("widget_settings")
    .select("extra")
    .eq("widget_id", widget.id)
    .maybeSingle<{ extra: Record<string, unknown> | null }>();

  const extra = settings?.extra ?? {};
  const sources = (extra.knowledgeBase as KnowledgeBaseSource[] | undefined) ?? [];
  if (!sources.some((source) => source.id === SHOPIFY_SOURCE_ID)) return;

  const updatedExtra = { ...extra, knowledgeBase: replaceShopifySource(sources, null) };
  await supabase.from("widget_settings").upsert({ widget_id: widget.id, extra: updatedExtra });
  await syncWidgetToVapiAssistant(widget, updatedExtra);
}
