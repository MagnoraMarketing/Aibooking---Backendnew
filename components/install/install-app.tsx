"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslation } from "@/components/i18n/language-provider";

// Chrome/Edge/Samsung Internet fire this instead of showing their own
// install banner when the page has a valid manifest (app/manifest.ts);
// holding on to it lets our own button open the native install dialog.
// Not in lib.dom.d.ts because it isn't standardised.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "ios" | "android" | "other";

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  // iPadOS 13+ reports itself as a Mac; only the touch screen gives it away.
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

interface InstallAppProps {
  // The /app/download link: goes straight to installing instead of
  // explaining. Browsers only open the install dialog from a tap, so on
  // Android the very first tap anywhere on the page starts it; on iPhone
  // Safari has no install API at all, so the steps are all we can show.
  // Someone already inside the installed app is sent on to the dashboard.
  autoInstall?: boolean;
}

export function InstallApp({ autoInstall = false }: InstallAppProps) {
  const { t } = useTranslation();
  const prompting = useRef(false);
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [installed, setInstalled] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [pageUrl, setPageUrl] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setPlatform(detectPlatform());
    setInstalled(isStandalone());
    setPageUrl(window.location.href);
    setOrigin(window.location.origin);

    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }
    function onAppInstalled() {
      setInstallPrompt(null);
      setInstalled(true);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!installPrompt || prompting.current) return;
    prompting.current = true;
    try {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      // The event can only be used once, whatever the outcome.
      setInstallPrompt(null);
      if (outcome === "accepted") setInstalled(true);
    } finally {
      prompting.current = false;
    }
  }

  useEffect(() => {
    if (!autoInstall || !installPrompt) return;
    function onFirstTap() {
      void handleInstall();
    }
    document.addEventListener("pointerdown", onFirstTap, { once: true });
    return () => document.removeEventListener("pointerdown", onFirstTap);
    // handleInstall only reads installPrompt, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoInstall, installPrompt]);

  useEffect(() => {
    if (autoInstall && installed && isStandalone()) window.location.replace("/dashboard");
  }, [autoInstall, installed]);

  const showIos = platform === "ios" || platform === "other";
  const showAndroid = platform === "android" || platform === "other";

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" width={72} height={72} className="rounded-2xl" />
        <h1 className="mt-4 text-xl font-semibold text-slate-900">{t("install.title")}</h1>

        {installed ? (
          <>
            <p className="mt-2 text-sm text-slate-600">
              <span className="font-medium text-slate-900">{t("install.installedTitle")}.</span>{" "}
              {t("install.installedBody")}
            </p>
            <Link
              href="/dashboard"
              className="mt-6 inline-block rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
            >
              {t("install.openDashboard")}
            </Link>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-600">{t("install.subtitle")}</p>

            {installPrompt && (
              <button
                type="button"
                onClick={handleInstall}
                className="mt-6 w-full rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-600"
              >
                {t("install.installButton")}
              </button>
            )}

            {platform === "other" && pageUrl && (
              <p className="mt-6 text-sm text-slate-600">
                {t("install.desktopHint")}{" "}
                <span className="break-all font-medium text-slate-900">{pageUrl}</span>
              </p>
            )}

            {showIos && (
              <InstructionSteps
                title={t("install.iphoneTitle")}
                steps={[t("install.iphoneStep1"), t("install.iphoneStep2"), t("install.iphoneStep3")]}
              />
            )}
            {showAndroid && !installPrompt && (
              <InstructionSteps
                title={t("install.androidTitle")}
                steps={[t("install.androidStep1"), t("install.androidStep2"), t("install.androidStep3")]}
              />
            )}

            <p className="mt-8 border-t border-slate-100 pt-4 text-xs text-slate-500">
              {t("install.browserHint")}{" "}
              <Link href="/dashboard" className="font-medium text-brand-600 hover:underline">
                {origin ? `${origin.replace(/^https?:\/\//, "")}/dashboard` : "/dashboard"}
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function InstructionSteps({ title, steps }: { title: string; steps: string[] }) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}
