"use client";

import { useEffect, useMemo, useState } from "react";
import type { WidgetWithExtras } from "../agent-configurator";
import { useTranslation } from "@/components/i18n/language-provider";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

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
function buildPreviewHtml(widget: WidgetWithExtras, t: Translate): string {
  const businessName = escapeHtml(widget.business_name ?? widget.name);
  const welcomeMessage = escapeHtml(widget.welcome_message ?? t("agent.testAgent.defaultWelcomeMessage"));

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
    <h2>${escapeHtml(t("agent.testAgent.previewHeading"))}</h2>
    <p>
      ${escapeHtml(t("agent.testAgent.previewParagraph"))}
    </p>
    <div class="placeholder-block"></div>
    <p>
      ${escapeHtml(t("agent.testAgent.previewFooterParagraph"))}
    </p>
  </main>
  ${widget.embedSnippet}
</body>
</html>`;
}

// widget.js fails silently by design in production (a console.error, no
// visible UI) so a broken embed never wrecks a customer's real site — but
// that same silence makes this preview useless for diagnosing why nothing
// shows up. Fetch the same config endpoint widget.js calls, from the
// dashboard page itself, so a failure here surfaces as a real banner
// instead of an empty box with no explanation.
function useWidgetConfigCheck(publicId: string) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"checking" | "ok" | "error">("checking");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("checking");
    setErrorMessage(null);

    fetch(`/api/widget/config?publicId=${encodeURIComponent(publicId)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setErrorMessage(data?.error?.message ?? `HTTP ${res.status}`);
          setStatus("error");
          return;
        }
        setStatus("ok");
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : t("common.unknownError"));
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [publicId, t]);

  return { status, errorMessage };
}

export function TestAgentTab({ widget }: { widget: WidgetWithExtras }) {
  const { t } = useTranslation();
  const [showCode, setShowCode] = useState(false);
  const previewHtml = useMemo(() => buildPreviewHtml(widget, t), [widget, t]);
  const configCheck = useWidgetConfigCheck(widget.public_id);

  if (widget.status !== "active") {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">{t("agent.testAgent.pausedMessage")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {configCheck.status === "error" ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">{t("agent.testAgent.configErrorTitle")}</p>
          <p className="mt-1">
            {t("agent.testAgent.configErrorFromLabel")} <code>/api/widget/config</code>
            {t("agent.testAgent.configErrorSuffix", { detail: configCheck.errorMessage ?? "" })}
          </p>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <iframe
          srcDoc={previewHtml}
          title={t("agent.testAgent.iframeTitle")}
          className="h-[560px] w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          allow="microphone; autoplay"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          {t("agent.testAgent.description")}{" "}
          <a href={widget.shareUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-600">
            {t("agent.testAgent.openInNewWindow")}
          </a>
        </p>
        <button
          type="button"
          onClick={() => setShowCode((v) => !v)}
          className="shrink-0 text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          {showCode ? t("agent.testAgent.hideHtml") : t("agent.testAgent.showHtml")}
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
