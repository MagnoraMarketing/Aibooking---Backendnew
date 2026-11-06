"use client";

import { useEffect, useState } from "react";
import type { WidgetWithExtras } from "../agent-configurator";
import { useTranslation } from "@/components/i18n/language-provider";
import { primaryButtonClass, secondaryButtonClass } from "../agent-flow-ui";

// widget.js fails silently by design in production (a console.error, no
// visible UI) so a broken embed never wrecks a customer's real site — but
// that same silence makes this preview useless for diagnosing why nothing
// shows up. Fetch the same config endpoint widget.js calls, from the
// dashboard page itself, so a failure here surfaces as a real banner
// instead of an empty box with no explanation.
function useWidgetConfigCheck(publicId: string, enabled: boolean) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"checking" | "ok" | "error">("checking");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
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
  }, [publicId, enabled, t]);

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

type HealthStatus = "ok" | "widget_paused" | "customer_inactive" | "no_assistant";

// Asks the dashboard's own health route (app/api/customer/widgets/[id]/health)
// why the agent can or cannot be reached, before the preview is even shown.
// The public config endpoint deliberately answers every unavailable case with
// the same "Widget not found" — useless to the owner, who is looking right at
// the agent. This gives them the reason and a button that fixes it.
function useWidgetHealth(widgetId: string, refreshKey: string) {
  const [state, setState] = useState<{ status: HealthStatus | "checking" | "error"; message: string | null }>({
    status: "checking",
    message: null,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "checking", message: null });
    fetch(`/api/customer/widgets/${encodeURIComponent(widgetId)}/health`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "error", message: data?.error?.message ?? `HTTP ${res.status}` });
          return;
        }
        setState({ status: (data?.status as HealthStatus) ?? "ok", message: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : null });
      });
    return () => {
      cancelled = true;
    };
  }, [widgetId, refreshKey, nonce]);

  return { ...state, recheck: () => setNonce((n) => n + 1) };
}

export function TestAgentTab({
  widget,
  onWidgetChange,
}: {
  widget: WidgetWithExtras;
  // Lets the fix buttons below (turn the agent on, set the voice assistant up
  // again) hand the saved widget back, so the rest of the page — the status
  // switch, the list of agents — shows the same state.
  onWidgetChange?: (widget: Partial<WidgetWithExtras>) => void;
}) {
  const { t } = useTranslation();
  const [showCode, setShowCode] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const mismatchedOrigin = useMismatchedEmbedOrigin(widget.embedSnippet);
  const health = useWidgetHealth(widget.id, `${widget.status}:${widget.updated_at}`);
  const ready = health.status === "ok";
  const configCheck = useWidgetConfigCheck(widget.public_id, ready);

  // A real same-origin URL, not an iframe srcdoc: a srcdoc document's URL is
  // `about:srcdoc`, which has no origin, and the widget's realtime stack
  // (Vapi -> Daily) ends up calling postMessage with the literal string
  // "null" as its target origin — which throws, leaving the customer looking
  // at a dead microphone button. See app/widget/[publicId]/preview/route.ts.
  //
  // updated_at busts the frame whenever the widget is saved, so the preview
  // shows the agent as it is now rather than as it was when the tab opened.
  const previewUrl = `/widget/${encodeURIComponent(widget.public_id)}/preview?v=${encodeURIComponent(widget.updated_at)}`;

  // Both fixes are the same save: status=active turns a paused agent on, and
  // any save of an agent on the Vapi model with no assistant provisions one
  // (see the self-heal in app/api/customer/widgets/[id]/route.ts PATCH).
  async function fix() {
    setFixing(true);
    setFixError(null);
    const res = await fetch(`/api/customer/widgets/${widget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    setFixing(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setFixError(data?.error?.message ?? t("agentFlow.test.fixFailed"));
      return;
    }
    const { widget: updated } = await res.json();
    onWidgetChange?.(updated);
    health.recheck();
  }

  if (health.status === "checking") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
        {t("agentFlow.test.checking")}
      </div>
    );
  }

  if (!ready) {
    const problem =
      health.status === "widget_paused"
        ? { title: t("agentFlow.test.pausedTitle"), body: t("agentFlow.test.pausedBody"), action: t("agentFlow.test.pausedAction") }
        : health.status === "no_assistant"
          ? {
              title: t("agentFlow.test.noAssistantTitle"),
              body: t("agentFlow.test.noAssistantBody"),
              action: t("agentFlow.test.noAssistantAction"),
            }
          : health.status === "customer_inactive"
            ? { title: t("agentFlow.test.accountInactiveTitle"), body: t("agentFlow.test.accountInactiveBody"), action: null }
            : {
                title: t("agentFlow.test.checkFailedTitle"),
                body: health.message ?? t("common.unknownError"),
                action: null,
              };

    return (
      <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <div>
          <p className="text-sm font-semibold text-amber-900">{problem.title}</p>
          <p className="mt-1 text-sm text-amber-800">{problem.body}</p>
        </div>
        {fixError ? <p className="text-sm text-red-600">{fixError}</p> : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          {problem.action ? (
            <button type="button" onClick={fix} disabled={fixing} className={primaryButtonClass}>
              {fixing ? t("common.saving") : problem.action}
            </button>
          ) : null}
          <button type="button" onClick={health.recheck} className={secondaryButtonClass}>
            {t("agentFlow.test.recheck")}
          </button>
        </div>
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

      {/* On a phone the framed page is narrow and short; opening the same
          preview full-screen is the better test, so it is offered first. */}
      <a href={previewUrl} target="_blank" rel="noreferrer" className={`${primaryButtonClass} sm:hidden`}>
        {t("agentFlow.test.openFullscreen")}
      </a>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* No sandbox attribute: this is our own page on our own origin, and
            sandboxing it would need allow-same-origin to keep that origin
            anyway — which is not a boundary, just another way to reintroduce
            the "null" origin this preview exists to avoid. */}
        <iframe
          src={previewUrl}
          title={t("agent.testAgent.iframeTitle")}
          className="h-[520px] w-full border-0 sm:h-[680px]"
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
          className="hidden shrink-0 text-sm font-medium text-brand-600 hover:text-brand-700 sm:block"
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
