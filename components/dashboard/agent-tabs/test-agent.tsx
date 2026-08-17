"use client";

import { useEffect, useRef, useState } from "react";
import type { WidgetWithExtras } from "../agent-configurator";

type CallState = "idle" | "connecting" | "active" | "error";

function VapiVoiceTestPanel({ assistantId, publicKey }: { assistantId: string; publicKey: string }) {
  const vapiRef = useRef<import("@vapi-ai/web").default | null>(null);
  const [state, setState] = useState<CallState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    import("@vapi-ai/web").then(({ default: Vapi }) => {
      if (cancelled) return;
      const vapi = new Vapi(publicKey);
      vapi.on("call-start", () => setState("active"));
      vapi.on("call-end", () => setState("idle"));
      vapi.on("error", (err: unknown) => {
        console.error("Vapi test call error:", err);
        setError("Der opstod en fejl under opkaldet.");
        setState("error");
      });
      vapiRef.current = vapi;
    });

    return () => {
      cancelled = true;
      vapiRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  async function handleStart() {
    setError(null);
    setState("connecting");
    try {
      await vapiRef.current?.start(assistantId);
    } catch (err) {
      console.error("Failed to start Vapi test call:", err);
      setError("Kunne ikke starte opkaldet. Tjek mikrofon-tilladelser.");
      setState("error");
    }
  }

  function handleStop() {
    vapiRef.current?.stop();
    setState("idle");
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Test voice-agent (Vapi)</h2>
      <p className="mt-1 text-sm text-slate-500">
        Ring direkte til den rigtige voice-agent herfra — kræver mikrofon-adgang i browseren.
      </p>

      <div className="mt-4 flex items-center gap-3">
        {state === "active" ? (
          <button
            type="button"
            onClick={handleStop}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Afslut opkald
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStart}
            disabled={state === "connecting"}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {state === "connecting" ? "Forbinder…" : "Start opkald"}
          </button>
        )}
        <span className="text-xs font-medium text-slate-500">
          {state === "idle" && "Klar"}
          {state === "connecting" && "Forbinder…"}
          {state === "active" && "Opkald aktivt"}
          {state === "error" && "Fejl"}
        </span>
      </div>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

export function TestAgentTab({ widget, vapiPublicKey }: { widget: WidgetWithExtras; vapiPublicKey: string | null }) {
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
    <div className="space-y-4">
      {widget.vapi_assistant_id && vapiPublicKey ? (
        <VapiVoiceTestPanel assistantId={widget.vapi_assistant_id} publicKey={vapiPublicKey} />
      ) : null}

      <div className="space-y-3">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <iframe
            src={widget.shareUrl}
            title="Test agent"
            className="h-[560px] w-full"
            sandbox="allow-scripts allow-same-origin allow-forms"
            allow="microphone; autoplay"
          />
        </div>
        <p className="text-sm text-slate-500">
          Dette er den rigtige widget, live — samtaler her tæller med i forbrug og statistik ligesom på jeres
          hjemmeside.{" "}
          <a href={widget.shareUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-600">
            Åbn i nyt vindue ↗
          </a>
        </p>
      </div>
    </div>
  );
}
