import type { Metadata } from "next";
import { getRequestLocale } from "@/lib/i18n/get-locale";
import { translate } from "@/lib/i18n/dictionaries";
import { LanguageProvider } from "@/components/i18n/language-provider";
import { InstallApp } from "@/components/install/install-app";

export function generateMetadata(): Metadata {
  return { title: translate(getRequestLocale(), "install.title") };
}

// The shareable "download the app" link (/app). Public on purpose — people
// install first and sign in inside the app, which opens on /dashboard.
export default function InstallAppPage() {
  const locale = getRequestLocale();

  return (
    <LanguageProvider initialLocale={locale}>
      <InstallApp />
    </LanguageProvider>
  );
}
