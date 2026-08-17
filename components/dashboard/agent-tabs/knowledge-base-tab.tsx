"use client";

import { useState } from "react";
import type { KnowledgeBaseSource } from "@/lib/knowledge-base/types";
import type { WidgetWithExtras } from "../agent-configurator";

interface KnowledgeBaseTabProps {
  widget: WidgetWithExtras;
  onSourcesChange: (sources: KnowledgeBaseSource[]) => void;
}

const TYPE_LABELS: Record<KnowledgeBaseSource["type"], string> = {
  text: "Tekst",
  url: "Link",
  pdf: "PDF",
};

export function KnowledgeBaseTab({ widget, onSourcesChange }: KnowledgeBaseTabProps) {
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
      setError(data?.error?.message ?? "Kunne ikke tilføje indholdet.");
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
    if (!url.trim()) return;
    const ok = await addSource("url", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "url", url }),
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Videnbase</h2>
          <p className="mt-1 text-sm text-slate-500">
            Tilføj tekst, et link eller en PDF, så agenten kan svare mere præcist ud fra jeres eget indhold. Der
            trækkes minutter fra jeres saldo svarende til mængden af indhold.
          </p>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2 rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-medium text-slate-700">Tekst</p>
            <textarea
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Indsæt tekst, fx ofte stillede spørgsmål..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
            <button
              type="button"
              onClick={handleAddText}
              disabled={busy === "text" || !text.trim()}
              className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {busy === "text" ? "Tilføjer…" : "Tilføj tekst"}
            </button>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-medium text-slate-700">Link</p>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://jeresvirksomhed.dk"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
            <button
              type="button"
              onClick={handleAddUrl}
              disabled={busy === "url" || !url.trim()}
              className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {busy === "url" ? "Henter…" : "Hent fra link"}
            </button>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-medium text-slate-700">PDF</p>
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
              {busy === "pdf" ? "Læser PDF…" : "Upload PDF"}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Tilføjet indhold</h2>
        {sources.length === 0 ? (
          <p className="text-sm text-slate-500">Intet tilføjet endnu.</p>
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
                    {source.characterCount.toLocaleString("da-DK")} tegn · {Math.round(source.costSeconds / 60)} min
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(source.id)}
                  className="text-xs font-medium text-red-600 hover:text-red-700"
                >
                  Fjern
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
