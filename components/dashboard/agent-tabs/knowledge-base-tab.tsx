"use client";

import { useState } from "react";
import type { KnowledgeBaseSource } from "@/lib/knowledge-base/types";
import type { WidgetWithExtras } from "../agent-configurator";
import { useTranslation } from "@/components/i18n/language-provider";

interface KnowledgeBaseTabProps {
  widget: WidgetWithExtras;
  onSourcesChange: (sources: KnowledgeBaseSource[]) => void;
}

export function KnowledgeBaseTab({ widget, onSourcesChange }: KnowledgeBaseTabProps) {
  const { t } = useTranslation();
  const TYPE_LABELS: Record<KnowledgeBaseSource["type"], string> = {
    text: t("agent.knowledgeBase.typeText"),
    url: t("agent.knowledgeBase.typeUrl"),
    pdf: t("agent.knowledgeBase.typePdf"),
  };
  const sources = (widget.extra.knowledgeBase as KnowledgeBaseSource[] | undefined) ?? [];

  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"text" | "url" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addSource(kind: "text" | "url" | "pdf", init: RequestInit): Promise<boolean> {
    setBusy(kind);
    setError(null);

    const res = await fetch(`/api/customer/widgets/${widget.id}/knowledge-base`, {
      method: "POST",
      ...init,
    });

    setBusy(null);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("agent.knowledgeBase.addContentError"));
      return false;
    }

    const data = await res.json();
    onSourcesChange(data.knowledgeBase);
    return true;
  }

  async function handleAddText() {
    if (!text.trim()) return;
    const ok = await addSource("text", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "text", text }),
    });
    if (ok) setText("");
  }

  async function handleAddUrl() {
    const trimmed = url.trim();
    if (!trimmed) return;
    // The server requires an absolute URL (with scheme) — most people type
    // "www.example.com" or "example.com" without one, so fill it in rather
    // than bouncing them with a validation error over something this
    // obvious to fix.
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const ok = await addSource("url", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "url", url: normalized }),
    });
    if (ok) setUrl("");
  }

  async function handleAddPdf() {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const ok = await addSource("pdf", { body: form });
    if (ok) setFile(null);
  }

  async function handleDelete(sourceId: string) {
    const res = await fetch(`/api/customer/widgets/${widget.id}/knowledge-base/${sourceId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      const data = await res.json();
      onSourcesChange(data.knowledgeBase);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {t("agent.knowledgeBase.title")}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{t("agent.knowledgeBase.description")}</p>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2 rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-medium text-slate-700">{t("agent.knowledgeBase.textCardTitle")}</p>
            <textarea
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("agent.knowledgeBase.textPlaceholder")}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
            <button
              type="button"
              onClick={handleAddText}
              disabled={busy === "text" || !text.trim()}
              className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {busy === "text" ? t("agent.knowledgeBase.addingText") : t("agent.knowledgeBase.addTextButton")}
            </button>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-medium text-slate-700">{t("agent.knowledgeBase.linkCardTitle")}</p>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("agent.knowledgeBase.linkPlaceholder")}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
            <button
              type="button"
              onClick={handleAddUrl}
              disabled={busy === "url" || !url.trim()}
              className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {busy === "url" ? t("agent.knowledgeBase.fetchingLink") : t("agent.knowledgeBase.fetchLinkButton")}
            </button>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-medium text-slate-700">{t("agent.knowledgeBase.pdfCardTitle")}</p>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
            />
            <button
              type="button"
              onClick={handleAddPdf}
              disabled={busy === "pdf" || !file}
              className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {busy === "pdf" ? t("agent.knowledgeBase.readingPdf") : t("agent.knowledgeBase.uploadPdfButton")}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t("agent.knowledgeBase.addedContentTitle")}
        </h2>
        {sources.length === 0 ? (
          <p className="text-sm text-slate-500">{t("agent.knowledgeBase.nothingAddedYet")}</p>
        ) : (
          <ul className="space-y-2">
            {sources.map((source) => (
              <li
                key={source.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-3"
              >
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {TYPE_LABELS[source.type]}: {source.label}
                  </p>
                  <p className="text-xs text-slate-500">
                    {t("agent.knowledgeBase.sourceMeta", {
                      count: source.characterCount.toLocaleString("da-DK"),
                      minutes: Math.round(source.costSeconds / 60),
                    })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(source.id)}
                  className="text-xs font-medium text-red-600 hover:text-red-700"
                >
                  {t("agent.knowledgeBase.removeButton")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
