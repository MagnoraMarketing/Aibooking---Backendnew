"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "@/components/i18n/language-provider";
import type { ShopifyConnectionSummary } from "@/lib/shopify/types";
import type { WidgetWithExtras } from "../agent-configurator";

// The Webshop / Shopify integration. One button and one field: which shop, and
// approve. The customer never sees a token, a scope or an API version.
//
// There is nothing to sync and nothing to index — once connected, the agent
// reads products, stock, policies and orders from Shopify at the moment a
// customer asks. So this tab has no catalogue state to show, only whether the
// shop is connected.

interface WebshopTabProps {
  widget: WidgetWithExtras;
}

export function WebshopTab({ widget }: WebshopTabProps) {
  const { t } = useTranslation();
  const searchParams = useSearchParams();

  const [connection, setConnection] = useState<ShopifyConnectionSummary | null>(null);
  const [oauthAvailable, setOauthAvailable] = useState(true);
  const [shopDomain, setShopDomain] = useState("");
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Set by the OAuth callback's redirect (app/api/customer/shopify/callback):
  // the customer comes back here from Shopify, so this is where they get told
  // whether it worked.
  const oauthResult = searchParams.get("shopify");

  const load = useCallback(async () => {
    const res = await fetch(`/api/customer/widgets/${widget.id}/shopify`);
    if (!res.ok) return;
    const data = await res.json();
    setConnection(data.connection ?? null);
    setOauthAvailable(data.oauthAvailable !== false);
  }, [widget.id]);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function handleDisconnect() {
    if (!window.confirm(t("agent.webshop.disconnectConfirm"))) return;
    setBusy("disconnect");
    setError(null);
    const res = await fetch(`/api/customer/widgets/${widget.id}/shopify`, { method: "DELETE" });
    if (res.ok) {
      setConnection(null);
      setShopDomain("");
    } else {
      setError(t("agent.webshop.errorGeneric"));
    }
    setBusy(null);
  }

  const connected = connection?.status === "connected";

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
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
            }`}
          >
            <span aria-hidden>{connected ? "✓" : "•"}</span>
            {connected ? t("agent.webshop.statusConnected") : t("agent.webshop.statusNotConnected")}
          </span>
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

        {!oauthAvailable ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {t("agent.webshop.oauthUnavailable")}
          </p>
        ) : connected ? (
          <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm text-emerald-800">
              {t("agent.webshop.storeLabel")}: <strong>{connection?.shopDomain}</strong>
            </p>
            <p className="text-sm text-emerald-700">{t("agent.webshop.connectedExplainer")}</p>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy !== null}
              className="text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-60"
            >
              {t("agent.webshop.disconnect")}
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
          </div>
        )}
      </div>
    </div>
  );
}
