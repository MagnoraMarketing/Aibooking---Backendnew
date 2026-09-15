"use client";

import { useState } from "react";
import type { WidgetWithExtras } from "../agent-configurator";
import { useTranslation } from "@/components/i18n/language-provider";

// Lets a webshop be connected during agent creation itself, alongside the
// calendar step — same PUT /api/customer/widgets/[id]/shopify the Webshop tab
// uses, just the one field.
//
// Only step 1 (the public webshop) is offered here. Order tracking needs a
// redirect out to Shopify and back, which would drop the customer out of the
// wizard mid-flow — so that step is pointed at the Webshop tab instead, where
// returning from Shopify lands correctly. Optional either way: "Spring over"
// leaves the agent with no webshop.
export function WizardWebshopStep({ widget, onNext }: { widget: WidgetWithExtras; onNext: () => void }) {
  const { t } = useTranslation();
  const [shopUrl, setShopUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ products: number; pages: number } | null>(null);

  async function handleSave() {
    const trimmed = shopUrl.trim();
    if (!trimmed) {
      setError(t("agent.webshop.errorInvalidUrl"));
      return;
    }
    setSaving(true);
    setError(null);

    const res = await fetch(`/api/customer/widgets/${widget.id}/shopify`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopUrl: trimmed }),
    });

    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const code = data?.error?.message;
      setError(code === "invalid_url" ? t("agent.webshop.errorInvalidUrl") : t("agent.webshop.errorGeneric"));
      return;
    }

    const data = await res.json();
    if (data.sync && !data.sync.ok) {
      setError(
        data.sync.failure === "not_shopify"
          ? t("agent.webshop.errorNotShopify")
          : t("agent.webshop.errorCrawlFailed")
      );
      return;
    }
    setResult({ products: data.sync?.productCount ?? 0, pages: data.sync?.pageCount ?? 0 });
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t("agent.webshop.title")}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">{t("agent.wizardWebshop.description")}</p>
      </div>

      {result ? (
        <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-800">{t("agent.webshop.statusConnected")}</p>
          <p className="text-sm text-emerald-700">
            {t("agent.webshop.productsIndexed", { count: result.products })} ·{" "}
            {t("agent.webshop.pagesIndexed", { count: result.pages })}
          </p>
          <p className="text-sm text-emerald-700">{t("agent.wizardWebshop.orderTrackingLater")}</p>
        </div>
      ) : (
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
            disabled={saving}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? t("agent.webshop.saving") : t("agent.webshop.saveButton")}
          </button>
        </div>
      )}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onNext}
          className={
            result
              ? "rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              : "rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          }
        >
          {result ? t("agent.wizardWebshop.continue") : t("agent.wizardWebshop.skip")}
        </button>
      </div>
    </div>
  );
}
