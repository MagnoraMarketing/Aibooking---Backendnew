"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "@/components/i18n/language-provider";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// "Hent app": installs the dashboard as an app on the phone. Chrome/Android
// get the native prompt, or the menu steps when the browser offers none; iOS
// has no prompt, so Safari users get the Add to Home Screen steps. Both show
// straight away when they arrive from a QR code (?app=1).
//
// Never on a computer: desktop Chrome fires the same install prompt, which
// would put the dashboard on the desktop as a web app. There the QR code next
// to this button is the way to get the app.
function detectPlatform(): "ios" | "android" | "desktop" {
  const ua = navigator.userAgent;
  // iPadOS Safari reports itself as a Mac; touch support gives it away.
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/android/i.test(ua)) return "android";
  return "desktop";
}

export function InstallAppButton() {
  const { t } = useTranslation();
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop">("desktop");
  const [help, setHelp] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    const detected = detectPlatform();
    setPlatform(detected);
    if (detected === "ios" && new URLSearchParams(window.location.search).get("app") === "1") setHelp(true);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || platform === "desktop") return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={async () => {
          if (promptEvent) {
            await promptEvent.prompt();
            await promptEvent.userChoice.catch(() => null);
            setPromptEvent(null);
          } else setHelp(!help);
        }}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        {t("auth.app.install")}
      </button>
      {help ? (
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          {t(platform === "ios" ? "auth.app.iosHelp" : "auth.app.androidHelp")}
        </p>
      ) : null}
    </div>
  );
}
