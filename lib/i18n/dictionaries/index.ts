import type { Locale } from "../locales";
import { DEFAULT_LOCALE } from "../locales";
import type { Namespace } from "./types";
import { common } from "./common";
import { auth } from "./auth";
import { dashboardShell } from "./dashboardShell";
import { adminShell } from "./adminShell";
import { profile } from "./profile";
import { agent } from "./agent";
import { adminPages } from "./adminPages";
import { dashboardPages } from "./dashboardPages";

// Add a namespace file's export here to make its keys reachable as
// "namespaceName.key" from useTranslation()'s t(). Each namespace is a
// self-contained file (all 5 locales per key) so unrelated pages can be
// translated independently without touching the same file.
const NAMESPACES: Record<string, Namespace> = {
  common,
  auth,
  dashboardShell,
  adminShell,
  profile,
  agent,
  adminPages,
  dashboardPages,
};

// Works identically on the server and the client — dictionaries are plain
// bundled objects, no async loading/fs/network involved.
export function translate(locale: Locale, key: string): string {
  const dotIndex = key.indexOf(".");
  const namespaceName = dotIndex === -1 ? key : key.slice(0, dotIndex);
  const entryKey = dotIndex === -1 ? "" : key.slice(dotIndex + 1);

  const entry = NAMESPACES[namespaceName]?.[entryKey];
  if (!entry) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[i18n] Missing translation key: "${key}"`);
    }
    return key;
  }

  return entry[locale] ?? entry[DEFAULT_LOCALE] ?? key;
}
