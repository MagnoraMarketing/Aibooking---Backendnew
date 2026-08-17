"use client";

import { useMemo, useState } from "react";
import type { WidgetWithExtras } from "../agent-configurator";

// Widget-controlled text (business_name, welcome_message) is interpolated
// into the preview's raw HTML below — escape it so a stray "<" or "&" can't
// break the markup (this iframe is srcDoc'd with allow-same-origin, so it
// shares the dashboard's own origin).
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// A stand-in "customer homepage" carrying the widget's *actual* embed
// snippet, so Test Agent shows exactly what a visitor would see once this
// is pasted onto their real site — not just the bare widget on a blank page.
function buildPreviewHtml(widget: WidgetWithExtras): string {
  const businessName = escapeHtml(widget.business_name ?? widget.name);
  const welcomeMessage = escapeHtml(widget.welcome_message ?? "Velkommen til vores hjemmeside.");

  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { margin: 0; font-family: system-ui, sans-serif; color: #0f172a; }
  header { padding: 56px 24px; text-align: center; background: ${widget.secondary_color}1a; }
  header h1 { margin: 0 0 8px; font-size: 28px; }
  header p { margin: 0; color: #475569; }
  main { max-width: 720px; margin: 0 auto; padding: 32px 24px 140px; line-height: 1.6; color: #334155; }
  .placeholder-block { height: 160px; border-radius: 12px; background: #e2e8f0; margin: 24px 0; }
</style>
</head>
<body>
  <header>
    <h1>${businessName}</h1>
    <p>${welcomeMessage}</p>
  </header>
  <main>
    <h2>Sådan ser jeres side ud</h2>
    <p>
      Dette er en simuleret side, så I kan se hvordan agenten opfører sig,
      når den er sat ind på jeres rigtige hjemmeside — med præcis den
      samme kode som under "Embed Code".
    </p>
    <div class="placeholder-block"></div>
    <p>
      Klik på ikonet i hjørnet for at teste agenten. Samtaler her tæller
      med i forbrug og statistik, ligesom på jeres rigtige side.
    </p>
  </main>
  ${widget.embedSnippet}
</body>
</html>`;
}

export function TestAgentTab({ widget }: { widget: WidgetWithExtras }) {
  const [showCode, setShowCode] = useState(false);
  const previewHtml = useMemo(() => buildPreviewHtml(widget), [widget]);

  if (widget.status !== "active") {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">
          Agenten er sat på pause. Aktivér den under &quot;Dine agenter&quot; for at teste den live.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <iframe
          srcDoc={previewHtml}
          title="Test agent"
          className="h-[560px] w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          allow="microphone; autoplay"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          Simuleret side med jeres rigtige indlejrings-kode — samtaler her tæller med i forbrug og statistik
          ligesom på jeres hjemmeside.{" "}
          <a href={widget.shareUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-600">
            Åbn i nyt vindue ↗
          </a>
        </p>
        <button
          type="button"
          onClick={() => setShowCode((v) => !v)}
          className="shrink-0 text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          {showCode ? "Skjul HTML" : "Vis HTML"}
        </button>
      </div>

      {showCode ? (
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">
          <code>{previewHtml}</code>
        </pre>
      ) : null}
    </div>
  );
}
