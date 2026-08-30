import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./locales";

// Locale for a page with no signed-in profile yet (signup/login) — the
// NEXT_LOCALE cookie middleware.ts sets from Accept-Language on first
// visit, or the platform default if that hasn't run yet (e.g. middleware
// disabled in a preview environment).
export function getRequestLocale(): Locale {
  const cookie = cookies().get(LOCALE_COOKIE)?.value;
  return isLocale(cookie) ? cookie : DEFAULT_LOCALE;
}
