"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WidgetWithExtras } from "../agent-configurator";
import { useTranslation } from "@/components/i18n/language-provider";

// Testing a phone agent used to show the website widget: a chat bubble in a
// simulated web page, which is not what anyone is about to ship. This is the
// same assistant, reached the way a caller reaches it — the call rings, you
// answer, you talk. It is the phone call minus the phone network: the audio
// runs over the browser, so it proves the agent, its prompt, its knowledge
// base and its booking tools, but not the forwarding of a real line.
//
// Same plumbing the widget uses (public/widget.js): POST /api/widget/session
// for a public key and assistant id, then Vapi's own script-tag SDK build
// from their CDN. Deliberately not @vapi-ai/web — see the note in widget.js
// about that package's dist being unusable from a plain script tag.
const VAPI_SDK_URL = "https://cdn.jsdelivr.net/gh/VapiAI/html-script-tag@latest/dist/assets/index.js";

interface VapiClient {
  on(event: string, handler: (payload?: unknown) => void): void;
  start(assistantId: string): void;
  stop(): void;
}

declare global {
  interface Window {
    vapiSDK?: { run(options: { apiKey: string; assistant: string; config: Record<string, unknown> }): VapiClient };
  }
}

let sdkPromise: Promise<NonNullable<Window["vapiSDK"]>> | null = null;

function loadVapiSdk(): Promise<NonNullable<Window["vapiSDK"]>> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.vapiSDK) {
      resolve(window.vapiSDK);
      return;
    }
    const script = document.createElement("script");
    script.src = VAPI_SDK_URL;
    script.async = true;
    script.onload = () => {
      if (window.vapiSDK) resolve(window.vapiSDK);
      else reject(new Error("Vapi SDK loaded but window.vapiSDK is missing"));
    };
    script.onerror = () => reject(new Error("Failed to load Vapi SDK"));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

// Vapi's error payload has no fixed shape — it varies by what failed (the
// microphone, ICE negotiation, the assistant itself) — so dig for whatever
// text it carries instead of collapsing every failure into one line.
function describeVapiError(payload: unknown): string | null {
  if (payload instanceof Error) return payload.message;
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["errorMsg", "error", "message", "type"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
      if (value && typeof value === "object") {
        const nested = (value as Record<string, unknown>).message;
        if (typeof nested === "string" && nested.trim()) return nested;
      }
    }
  }
  return null;
}

type CallState = "idle" | "connecting" | "live" | "ended";

interface Line {
  role: "user" | "assistant";
  text: string;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function TestCallTab({ widget }: { widget: WidgetWithExtras }) {
  const { t } = useTranslation();
  const [state, setState] = useState<CallState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [seconds, setSeconds] = useState(0);
  const clientRef = useRef<VapiClient | null>(null);
  // The call listeners are registered once, on the one client this tab
  // keeps, so they must not close over a `t` that changes when the language
  // does. Read the current one through a ref instead.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const translate = useCallback((key: string) => tRef.current(key), []);

  // Ticks only while the call is up, so the timer shows call length rather
  // than how long the tab has been open.
  useEffect(() => {
    if (state !== "live") return;
    const id = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  // A call left running when the tab unmounts keeps the microphone open and
  // keeps billing — hang up on the way out.
  useEffect(() => {
    return () => {
      try {
        clientRef.current?.stop();
      } catch {
        // Already gone; nothing to hang up.
      }
    };
  }, []);

  const answer = useCallback(async () => {
    setError(null);
    setLines([]);
    setSeconds(0);
    setState("connecting");

    try {
      const res = await fetch("/api/widget/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicId: widget.public_id }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      }
      if (!data?.vapi?.publicKey || !data?.vapi?.assistantId) {
        throw new Error(t("agent.testCall.errorNoAssistant"));
      }

      const sdk = await loadVapiSdk();

      // One client per tab, reused for every call — the same thing
      // public/widget.js does, and for the same reason. Calling run() again
      // per call builds a second client while the first still holds the
      // microphone, so the new call connects, the assistant talks, and
      // nothing the person says ever arrives. Vapi then ends it with
      // "assistant-did-not-receive-customer-audio": the first test call
      // worked, every one after it was silence.
      if (!clientRef.current) {
        const client = sdk.run({ apiKey: data.vapi.publicKey, assistant: data.vapi.assistantId, config: {} });

        client.on("call-start", () => {
          setError(null);
          setState("live");
        });
        client.on("call-end", () => setState("ended"));
        client.on("message", (payload) => {
          const message = payload as { type?: string; transcriptType?: string; transcript?: string; role?: string };
          // Only final transcript lines: the partial ones rewrite themselves
          // word by word, which reads as stuttering rather than as a call.
          if (message?.type !== "transcript" || message.transcriptType !== "final" || !message.transcript) return;
          setLines((prev) => [...prev, { role: message.role === "user" ? "user" : "assistant", text: message.transcript! }]);
        });
        client.on("error", (payload) => {
          console.error("Vapi test call error:", payload);
          const detail = describeVapiError(payload);
          setError(
            detail && /customer-audio|microphone|permission|NotAllowed/i.test(detail)
              ? translate("agent.testCall.errorNoMicrophone")
              : detail || translate("agent.testCall.errorDuringCall")
          );
          setState("ended");
        });

        clientRef.current = client;
      }

      clientRef.current.start(data.vapi.assistantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.unknownError"));
      setState("idle");
    }
  }, [t, translate, widget.public_id]);

  function hangUp() {
    try {
      clientRef.current?.stop();
    } catch {
      // The SDK may have torn the call down already.
    }
    setState("ended");
  }

  const ringing = state === "connecting";
  const live = state === "live";

  return (
    <div className="space-y-4">
      <div className="mx-auto max-w-sm overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-lg">
        <div className="space-y-1 px-6 pt-8 text-center">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            {live ? t("agent.testCall.statusLive") : ringing ? t("agent.testCall.statusRinging") : state === "ended" ? t("agent.testCall.statusEnded") : t("agent.testCall.statusIncoming")}
          </p>
          <p className="text-xl font-semibold text-white">{widget.business_name || widget.name}</p>
          <p className="text-sm text-slate-400">
            {live ? formatDuration(seconds) : t("agent.testCall.incomingSubtitle")}
          </p>
        </div>

        <div className="mt-6 flex h-56 flex-col gap-2 overflow-y-auto bg-slate-950/40 px-4 py-3 text-sm">
          {lines.length === 0 ? (
            <p className="m-auto text-center text-xs text-slate-500">
              {live ? t("agent.testCall.listening") : t("agent.testCall.transcriptEmpty")}
            </p>
          ) : (
            lines.map((line, index) => (
              <p
                key={index}
                className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                  line.role === "user"
                    ? "self-end bg-brand-600 text-white"
                    : "self-start bg-slate-800 text-slate-100"
                }`}
              >
                {line.text}
              </p>
            ))
          )}
        </div>

        <div className="flex items-center justify-center gap-6 px-6 py-6">
          {live || ringing ? (
            <button
              type="button"
              onClick={hangUp}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-2xl text-white transition hover:bg-red-700"
              aria-label={t("agent.testCall.hangUp")}
            >
              ✕
            </button>
          ) : (
            <button
              type="button"
              onClick={answer}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-2xl text-white transition hover:bg-emerald-600"
              aria-label={t("agent.testCall.answer")}
            >
              ✆
            </button>
          )}
        </div>
      </div>

      {error ? <p className="text-center text-sm text-red-600">{error}</p> : null}

      <p className="mx-auto max-w-lg text-center text-sm text-slate-500">{t("agent.testCall.description")}</p>
    </div>
  );
}
