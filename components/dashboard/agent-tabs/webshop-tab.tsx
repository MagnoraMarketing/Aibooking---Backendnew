"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "@/components/i18n/language-provider";
import type { ShopifyConnectionSummary } from "@/lib/shopify/types";
import type { WidgetWithExtras } from "../agent-configurator";

// The Webshop / Shopify tab. Two numbered steps and nothing else on screen:
// paste the shop address, then approve the Shopify connection. The customer
// never sees a token, a scope or an API version — the setup they are asked to
// understand is "which shop" and "may we look at your orders".
//
// Everything this component knows about the connection comes from
// ShopifyConnectionSummary, which by construction carries no credential.

interface WebshopTabProps {
  widget: WidgetWithExtras;
}

// The server answers failures with short codes rather than prose, so the
// message the customer reads is translated here rather than being whatever
// English a crawler happened to throw.
const ERROR_KEYS: Record<string, string> = {
  invalid_url: "agent.webshop.errorInvalidUrl",
  unreachable: "agent.webshop.errorCrawlFailed",
  failed: "agent.webshop.errorCrawlFailed",
  not_shopify: "agent.webshop.errorNotShopify",
  invalid_shop_domain: "agent.webshop.errorInvalidShopDomain",
};

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
        ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
      }`}
    >
      <span aria-hidden>{ok ? "✓" : "•"}</span>
      {label}
    </span>
  );
}

export function WebshopTab({ widget }: WebshopTabProps) {
  const { t } = useTranslation();
  const searchParams = useSearchParams();

  const [connection, setConnection] = useState<ShopifyConnectionSummary | null>(null);
  const [oauthAvailable, setOauthAvailable] = useState(true);
  const [shopUrl, setShopUrl] = useState("");
  const [shopDomain, setShopDomain] = useState("");
  const [busy, setBusy] = useState<"save" | "refresh" | "remove" | "connect" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Set by the OAuth callback's redirect (app/api/customer/shopify/callback):
  // the customer comes back here from Shopify, so this is where they get told
  // whether it worked.
  const oauthResult = searchParams.get("shopify");

  const load = useCallback(async () => {
    const res = await fetch(`/api/customer/widgets/${widget.id}/shopify`);
    if (!res.ok) {
      setLoaded(true);
      return;
    }
    const data = await res.json();
    setConnection(data.connection ?? null);
    setOauthAvailable(data.oauthAvailable !== false);
    if (data.connection?.shopUrl) setShopUrl(data.connection.shopUrl);
    setLoaded(true);
  }, [widget.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function readError(res: Response): Promise<string> {
    const data = await res.json().catch(() => null);
    const code = data?.error?.message as string | undefined;
    return code && ERROR_KEYS[code] ? t(ERROR_KEYS[code]!) : t("agent.webshop.errorGeneric");
  }

  async function handleSave() {
    const trimmed = shopUrl.trim();
    if (!trimmed) return;
    setBusy("save");
    setError(null);

    const res = await fetch(`/api/customer/widgets/${widget.id}/shopify`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopUrl: trimmed }),
    });

    if (!res.ok) {
      setError(await readError(res));
      setBusy(null);
      return;
    }

    const data = await res.json();
    setConnection(data.connection ?? null);
    // A crawl can fail without the request failing — the row is saved either
    // way, and the customer needs to know their shop wasn't read.
    if (data.sync && !data.sync.ok) {
      const key = ERROR_KEYS[data.sync.failure as string];
      setError(key ? t(key) : t("agent.webshop.errorCrawlFailed"));
    }
    setBusy(null);
  }

  async function handleRefresh() {
    setBusy("refresh");
    setError(null);
    const res = await fetch(`/api/customer/widgets/${widget.id}/shopify/sync`, { method: "POST" });
    if (!res.ok) {
      setError(await readError(res));
      setBusy(null);
      return;
    }
    const data = await res.json();
    setConnection(data.connection ?? null);
    if (data.sync && !data.sync.ok) {
      const key = ERROR_KEYS[data.sync.failure as string];
      setError(key ? t(key) : t("agent.webshop.errorCrawlFailed"));
    }
    setBusy(null);
  }

  async function handleRemove() {
    if (!window.confirm(t("agent.webshop.removeConfirm"))) return;
    setBusy("remove");
    setError(null);
    const res = await fetch(`/api/customer/widgets/${widget.id}/shopify`, { method: "DELETE" });
    if (res.ok) {
      setConnection(null);
      setShopUrl("");
    } else {
      setError(await readError(res));
    }
    setBusy(null);
  }

  function handleConnect() {
    const trimmed = shopDomain.trim();
    if (!trimmed) {
      setError(t("agent.webshop.errorInvalidShopDomain"));
      return;
    }
    setBusy("connect");
    setError(null);
    // A full-page navigation, not fetch: this leaves our site for Shopify's own
    // permission prompt and comes back through the callback route.
    window.location.href = `/api/customer/shopify/connect?widgetId=${encodeURIComponent(
      widget.id
    )}&shop=${encodeURIComponent(trimmed)}`;
  }

  async function handleDisconnectOrderTracking() {
    setBusy("disconnect");
    setError(null);
    const res = await fetch(`/api/customer/widgets/${widget.id}/shopify/order-tracking`, { method: "DELETE" });
    if (res.ok) {
      const data = await res.json();
      setConnection(data.connection ?? null);
    } else {
      setError(await readError(res));
    }
    setBusy(null);
  }

  const webshopConnected = Boolean(connection?.shopUrl && connection.crawlStatus === "ok");
  const ordersConnected = connection?.status === "connected";
  const lastSynced = connection?.lastSyncAt
    ? new Date(connection.lastSyncAt).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t("agent.webshop.title")}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">{t("agent.webshop.description")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill
              ok={webshopConnected}
              label={webshopConnected ? t("agent.webshop.statusConnected") : t("agent.webshop.statusNotConnected")}
            />
            <StatusPill
              ok={ordersConnected}
              label={
                ordersConnected
                  ? t("agent.webshop.orderTrackingEnabled")
                  : t("agent.webshop.statusNotConnected")
              }
            />
          </div>
        </div>

        {oauthResult === "connected" ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
            {t("agent.webshop.connectedNotice")}
          </p>
        ) : null}
        {oauthResult === "error" || oauthResult === "expired" ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {t("agent.webshop.errorOAuthFailed")}
          </p>
        ) : null}
        {connection?.status === "reauth_required" ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t("agent.webshop.reauthRequired")}
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>

      {/* 1. Webshop — the public half. Works on its own. */}
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{t("agent.webshop.step1Title")}</h3>
          <p className="mt-1 text-sm text-slate-500">{t("agent.webshop.step1Description")}</p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={shopUrl}
            onChange={(e) => setShopUrl(e.target.value)}
            placeholder={t("agent.webshop.urlPlaceholder")}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={busy !== null || !shopUrl.trim()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busy === "save" ? t("agent.webshop.saving") : t("agent.webshop.saveButton")}
          </button>
        </div>

        {connection?.shopUrl ? (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
              <span>{t("agent.webshop.productsIndexed", { count: connection.productCount })}</span>
              <span>{t("agent.webshop.pagesIndexed", { count: connection.pageCount })}</span>
              {lastSynced ? <span>{t("agent.webshop.lastSynced", { date: lastSynced })}</span> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleRefresh}
                disabled={busy !== null}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              >
                {busy === "refresh" ? t("agent.webshop.refreshing") : t("agent.webshop.refreshButton")}
              </button>
              <button
                type="button"
                onClick={handleRemove}
                disabled={busy !== null}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-60"
              >
                {t("agent.webshop.removeButton")}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* 2. Order tracking — the private half, behind Shopify's own consent. */}
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{t("agent.webshop.step2Title")}</h3>
          <p className="mt-1 text-sm text-slate-500">{t("agent.webshop.step2Description")}</p>
        </div>

        {!oauthAvailable ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {t("agent.webshop.oauthUnavailable")}
          </p>
        ) : ordersConnected ? (
          <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-medium text-emerald-800">{t("agent.webshop.connectedNotice")}</p>
            <p className="text-sm text-emerald-700">
              {t("agent.webshop.storeLabel")}: {connection?.shopDomain}
            </p>
            <button
              type="button"
              onClick={handleDisconnectOrderTracking}
              disabled={busy !== null}
              className="rounded-lg px-1 py-0.5 text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-60"
            >
              {t("agent.webshop.disconnectOrderTracking")}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700" htmlFor="shopify-shop-domain">
              {t("agent.webshop.shopDomainLabel")}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="shopify-shop-domain"
                value={shopDomain}
                onChange={(e) => setShopDomain(e.target.value)}
                placeholder={t("agent.webshop.shopDomainPlaceholder")}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
              <button
                type="button"
                onClick={handleConnect}
                disabled={busy !== null}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {busy === "connect" ? t("agent.webshop.connecting") : t("agent.webshop.connectButton")}
              </button>
            </div>
            <p className="text-xs text-slate-500">{t("agent.webshop.shopDomainHelp")}</p>
            {loaded && !connection?.shopUrl ? (
              <p className="text-xs text-slate-500">{t("agent.webshop.saveWebshopFirst")}</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
