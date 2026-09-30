import type { Metadata } from "next";
import { getRequestLocale } from "@/lib/i18n/get-locale";
import { translate } from "@/lib/i18n/dictionaries";
import { LanguageProvider } from "@/components/i18n/language-provider";
import { InstallApp } from "@/components/install/install-app";

export function generateMetadata(): Metadata {
  return { title: translate(getRequestLocale(), "install.title") };
}

// The direct "download" link (/app/download, also reachable as /download):
// same page as /app, but it starts installing on the first tap — see
// InstallApp's autoInstall.
export default function DownloadAppPage() {
  const locale = getRequestLocale();

  return (
    <LanguageProvider initialLocale={locale}>
      <InstallApp autoInstall />
    </LanguageProvider>
  );
}
