"use client";

import { useEffect, useState } from "react";
import type { WidgetWithExtras } from "../agent-configurator";
import { useTranslation } from "@/components/i18n/language-provider";

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

// The origin the embed snippet points at, when that isn't this dashboard's
// own. Resolved in an effect rather than during render: window doesn't exist
// server-side, and a mismatch that only appears after hydration would
// otherwise make the markup differ between the two.
function useMismatchedEmbedOrigin(embedSnippet: string): string | null {
  const [mismatch, setMismatch] = useState<string | null>(null);

  useEffect(() => {
    const src = /src="([^"]*)\/widget\.js"/.exec(embedSnippet)?.[1];
    if (!src) return;
    try {
      const embedOrigin = new URL(src, window.location.origin).origin;
      setMismatch(embedOrigin === window.location.origin ? null : embedOrigin);
    } catch {
      setMismatch(null);
    }
  }, [embedSnippet]);

  return mismatch;
}

export function TestAgentTab({ widget }: { widget: WidgetWithExtras }) {
  const { t } = useTranslation();
  const [showCode, setShowCode] = useState(false);
  const mismatchedOrigin = useMismatchedEmbedOrigin(widget.embedSnippet);
  const configCheck = useWidgetConfigCheck(widget.public_id);

  // A real same-origin URL, not an iframe srcdoc: a srcdoc document's URL is
  // `about:srcdoc`, which has no origin, and the widget's realtime stack
  // (Vapi -> Daily) ends up calling postMessage with the literal string
  // "null" as its target origin — which throws, leaving the customer looking
  // at a dead microphone button. See app/widget/[publicId]/preview/route.ts.
  //
  // updated_at busts the frame whenever the widget is saved, so the preview
  // shows the agent as it is now rather than as it was when the tab opened.
  const previewUrl = `/widget/${encodeURIComponent(widget.public_id)}/preview?v=${encodeURIComponent(widget.updated_at)}`;

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

      {mismatchedOrigin ? (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">{t("agent.testAgent.embedOriginWarningTitle")}</p>
          <p className="mt-1">{t("agent.testAgent.embedOriginWarningBody", { origin: mismatchedOrigin })}</p>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* No sandbox attribute: this is our own page on our own origin, and
            sandboxing it would need allow-same-origin to keep that origin
            anyway — which is not a boundary, just another way to reintroduce
            the "null" origin this preview exists to avoid. */}
        <iframe
          src={previewUrl}
          title={t("agent.testAgent.iframeTitle")}
          className="h-[680px] w-full border-0"
          allow="microphone; autoplay"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          {t("agent.testAgent.description")}{" "}
          {/* The same simulated page the frame shows, which is what the
              sentence before this link describes — not the bare share page. */}
          <a href={previewUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-600">
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

      {showCode ? <PreviewHtml url={previewUrl} loadingLabel={t("common.loading")} /> : null}
    </div>
  );
}

// "Vis HTML" shows the page as actually served, fetched from the same URL the
// frame loads, rather than a second copy of the markup built here — the two
// drifting apart is exactly how a preview stops being a preview.
function PreviewHtml({ url, loadingLabel }: { url: string; loadingLabel: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((res) => res.text())
      .then((text) => {
        if (!cancelled) setHtml(text);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">
      <code>{html ?? loadingLabel}</code>
    </pre>
  );
}
