"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "@/components/i18n/language-provider";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// "Hent app": installs the dashboard as an app. Chrome/Android get the native
// prompt; iOS has none, so Safari users get the Add to Home Screen steps —
// straight away when they arrive from a QR code (?app=1).
export function InstallAppButton() {
  const { t } = useTranslation();
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [iosHelp, setIosHelp] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIos(ios);
    if (ios && new URLSearchParams(window.location.search).get("app") === "1") setIosHelp(true);
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

  if (installed || (!promptEvent && !isIos)) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={async () => {
          if (promptEvent) {
            await promptEvent.prompt();
            await promptEvent.userChoice.catch(() => null);
            setPromptEvent(null);
          } else setIosHelp(!iosHelp);
        }}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        {t("auth.app.install")}
      </button>
      {iosHelp ? <p className="mt-2 text-xs leading-relaxed text-slate-500">{t("auth.app.iosHelp")}</p> : null}
    </div>
  );
}
