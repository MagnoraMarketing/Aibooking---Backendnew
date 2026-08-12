"use client";

import { useState } from "react";
import type { WidgetWithExtras } from "../agent-configurator";

export function EmbedCodeTab({ widget }: { widget: WidgetWithExtras }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(widget.embedSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Indsæt på jeres hjemmeside</h2>
        <p className="mt-1 text-sm text-slate-500">
          Indsæt denne kode lige før <code>&lt;/body&gt;</code> på jeres side.
        </p>
      </div>

      <div className="relative">
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">
          <code>{widget.embedSnippet}</code>
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          className="absolute right-3 top-3 rounded-md bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/20"
        >
          {copied ? "Kopieret!" : "Kopiér"}
        </button>
      </div>

      <p className="text-sm text-slate-500">
        Del-link (til test eller sociale medier):{" "}
        <a href={widget.shareUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-600">
          {widget.shareUrl}
        </a>
      </p>
    </div>
  );
}
