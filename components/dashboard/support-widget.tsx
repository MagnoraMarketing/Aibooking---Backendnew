"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/components/i18n/language-provider";

// A floating onboarding/support button, bottom-left, on every dashboard
// page — AIbooking's own voice assistant (configured directly in Vapi's
// dashboard, referenced here only by id via VAPI_SUPPORT_ASSISTANT_ID) that
// helps a customer get set up and answers questions about the platform
// itself. Unrelated to the per-customer Voice Widget product this app sells
// (public/widget.js, app/api/widget/*) — this one talks to AIbooking, not to
// one of our customers' own customers.
//
// Loads the same official Vapi script-tag SDK (window.vapiSDK.run) that
// public/widget.js already uses successfully, and hides Vapi's own default
// floating button the same way, since this renders its own.
const VAPI_SDK_URL = "https://cdn.jsdelivr.net/gh/VapiAI/html-script-tag@latest/dist/assets/index.js";

interface VapiCallClient {
  start: (assistantId: string) => void;
  stop: () => void;
  on: (event: string, callback: (payload?: unknown) => void) => void;
}

interface VapiSdk {
  run: (params: { apiKey: string; assistant: string; config: Record<string, unknown> }) => VapiCallClient;
}

declare global {
  interface Window {
    vapiSDK?: VapiSdk;
  }
}

let vapiSdkPromise: Promise<VapiSdk> | null = null;

function loadVapiSdk(): Promise<VapiSdk> {
  if (vapiSdkPromise) return vapiSdkPromise;
  vapiSdkPromise = new Promise((resolve, reject) => {
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
  return vapiSdkPromise;
}

function hideDefaultVapiButton() {
  if (document.getElementById("aibooking-support-vapi-hide-btn")) return;
  const style = document.createElement("style");
  style.id = "aibooking-support-vapi-hide-btn";
  style.textContent = ".vapi-btn{display:none!important;}";
  document.head.appendChild(style);
}

interface SupportWidgetConfig {
  publicKey: string;
  assistantId: string;
}

type CallStatus = "idle" | "connecting" | "active" | "error";

export function SupportWidget() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<SupportWidgetConfig | null>(null);
  const [status, setStatus] = useState<CallStatus>("idle");
  const clientRef = useRef<VapiCallClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/customer/support-widget");
      if (!res.ok || cancelled) return;
      const data = await res.json().catch(() => null);
      if (cancelled || !data?.enabled) return;
      setConfig({ publicKey: data.publicKey, assistantId: data.assistantId });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Stopping on unmount matters here specifically because this button lives
  // in the dashboard layout: a client-side route change re-renders it, but
  // React only unmounts it on a full page navigation away from /dashboard
  // (e.g. logging out) — an active call should hang up then, not linger.
  useEffect(() => {
    return () => {
      clientRef.current?.stop();
    };
  }, []);

  async function handleClick() {
    if (status === "connecting") return;

    if (status === "active") {
      clientRef.current?.stop();
      return;
    }

    if (!config) return;
    setStatus("connecting");

    try {
      const vapiSDK = await loadVapiSdk();
      if (!clientRef.current) {
        hideDefaultVapiButton();
        const client = vapiSDK.run({ apiKey: config.publicKey, assistant: config.assistantId, config: {} });
        client.on("call-start", () => setStatus("active"));
        client.on("call-end", () => setStatus("idle"));
        client.on("error", (e) => {
          console.error("Support widget call error:", e);
          setStatus("error");
        });
        clientRef.current = client;
      }
      clientRef.current.start(config.assistantId);
    } catch (err) {
      console.error("Support widget failed to start:", err);
      setStatus("error");
    }
  }

  if (!config) return null;

  const label =
    status === "active"
      ? t("dashboardShell.supportWidget.active")
      : status === "connecting"
        ? t("dashboardShell.supportWidget.connecting")
        : status === "error"
          ? t("dashboardShell.supportWidget.error")
          : t("dashboardShell.supportWidget.label");

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      title={label}
      className={`fixed bottom-24 left-4 z-[999998] sm:bottom-5 sm:left-5 flex h-14 w-14 items-center justify-center rounded-full text-2xl text-white shadow-lg transition hover:scale-105 ${
        status === "active" ? "bg-red-600 hover:bg-red-700" : "bg-brand-600 hover:bg-brand-700"
      }`}
    >
      {status === "connecting" ? (
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />
      ) : status === "active" ? (
        <span aria-hidden="true">⏹</span>
      ) : (
        <span aria-hidden="true">🎧</span>
      )}
    </button>
  );
}
