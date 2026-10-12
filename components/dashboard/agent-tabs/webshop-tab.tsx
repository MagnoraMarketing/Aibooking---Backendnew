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

// Shopify's app-development screen lives under the store's own admin, so the
// link only exists once we know which store. Typed as "dinbutik.myshopify.com"
// in the field above, the admin path wants just "dinbutik" — the same handle,
// without the domain. Anything that doesn't look like a store address yields
// no link rather than a broken one.
export function shopifyDevelopAppsUrl(shopDomain: string): string | null {
  const handle = shopDomain.trim().toLowerCase().replace(/^https?:\/\//, "").split(".")[0];
  if (!handle || !/^[a-z0-9][a-z0-9-]*$/.test(handle)) return null;
  return `https://admin.shopify.com/store/${handle}/settings/apps/development`;
}

export function WebshopTab({ widget }: WebshopTabProps) {
  const { t } = useTranslation();
  const searchParams = useSearchParams();

  const [connection, setConnection] = useState<ShopifyConnectionSummary | null>(null);
  const [oauthAvailable, setOauthAvailable] = useState(true);
  const [shopDomain, setShopDomain] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [busy, setBusy] = useState<"connect" | "save" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missingScopes, setMissingScopes] = useState<string[]>([]);

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

  // The path for a platform with no Shopify app of its own: the merchant
  // makes a custom app in their own Shopify admin and pastes its Admin API
  // token. The server verifies it against Shopify before storing anything, so
  // a bad token fails here rather than mid-conversation with a customer.
  async function handleSaveToken() {
    const shop = shopDomain.trim();
    const token = accessToken.trim();
    if (!shop) {
      setError(t("agent.webshop.errorInvalidShopDomain"));
      return;
    }
    if (!token) {
      setError(t("agent.webshop.errorTokenRequired"));
      return;
    }

    setBusy("save");
    setError(null);
    setMissingScopes([]);

    const res = await fetch(`/api/customer/widgets/${widget.id}/shopify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop, accessToken: token }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const code = String(data?.error?.message ?? "");
      if (code === "invalid_shop_domain") setError(t("agent.webshop.errorInvalidShopDomain"));
      else if (code === "invalid_token") setError(t("agent.webshop.errorInvalidToken"));
      else if (code.startsWith("missing_scopes:")) {
        setError(t("agent.webshop.errorMissingScopes", { scopes: code.slice("missing_scopes:".length) }));
      } else setError(t("agent.webshop.errorVerificationFailed"));
      setBusy(null);
      return;
    }

    const data = await res.json();
    setConnection(data.connection ?? null);
    setMissingScopes(data.missingScopes ?? []);
    // Never keep the token in component state once it is stored.
    setAccessToken("");
    setBusy(null);
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

  // Recomputed as they type, so the setup link points into their own store the
  // moment the domain field above is filled in.
  const developAppsUrl = shopifyDevelopAppsUrl(shopDomain);
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

        {connected ? (
          <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm text-emerald-800">
              {t("agent.webshop.storeLabel")}: <strong>{connection?.shopDomain}</strong>
            </p>
            <p className="text-sm text-emerald-700">{t("agent.webshop.connectedExplainer")}</p>
            {missingScopes.length > 0 ? (
              <p className="text-sm text-amber-700">
                {t("agent.webshop.missingScopesNotice", { scopes: missingScopes.join(", ") })}
              </p>
            ) : null}
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
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-900">{t("agent.webshop.featuresTitle")}</p>
              <ul className="mt-2 space-y-1.5">
                {(["feature1", "feature2", "feature3", "feature4"] as const).map((key) => (
                  <li key={key} className="flex items-start gap-2 text-sm text-emerald-800">
                    <span aria-hidden className="mt-0.5 text-emerald-600">✓</span>
                    {t(`agent.webshop.${key}`)}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs font-medium text-emerald-700">{t("agent.webshop.featuresChannels")}</p>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700" htmlFor="shopify-shop-domain">
                {t("agent.webshop.shopDomainLabel")}
              </label>
              <input
                id="shopify-shop-domain"
                value={shopDomain}
                onChange={(e) => setShopDomain(e.target.value)}
                placeholder={t("agent.webshop.shopDomainPlaceholder")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
              <p className="text-xs text-slate-500">{t("agent.webshop.shopDomainHelp")}</p>
            </div>

            {/* The one-click path, only when the platform has a Shopify app. */}
            {oauthAvailable ? (
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm text-slate-600">{t("agent.webshop.oauthIntro")}</p>
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={busy !== null}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {busy === "connect" ? t("agent.webshop.connecting") : t("agent.webshop.connectButton")}
                </button>
              </div>
            ) : null}

            {/* The token path. Always available — it is the only one that
                works before a platform Shopify app exists. */}
            <div className="space-y-2 rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-medium text-slate-700">{t("agent.webshop.tokenTitle")}</p>
              <ol className="space-y-2 text-sm text-slate-600">
                <li>
                  {t("agent.webshop.tokenStep1")}{" "}
                  {developAppsUrl ? (
                    <a
                      href={developAppsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {t("agent.webshop.tokenStep1Link")}
                    </a>
                  ) : (
                    <span className="text-slate-500">{t("agent.webshop.tokenStep1NeedsDomain")}</span>
                  )}
                </li>
                <li>{t("agent.webshop.tokenStep2")}</li>
                <li>{t("agent.webshop.tokenStep3")}</li>
                <li>{t("agent.webshop.tokenStep4")}</li>
              </ol>
              <label className="block text-sm font-medium text-slate-700" htmlFor="shopify-access-token">
                {t("agent.webshop.tokenLabel")}
              </label>
              <input
                id="shopify-access-token"
                type="password"
                autoComplete="off"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="shpat_…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
              <p className="text-xs text-slate-500">{t("agent.webshop.tokenHelp")}</p>
              <button
                type="button"
                onClick={handleSaveToken}
                disabled={busy !== null}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {busy === "save" ? t("agent.webshop.saving") : t("agent.webshop.saveTokenButton")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
