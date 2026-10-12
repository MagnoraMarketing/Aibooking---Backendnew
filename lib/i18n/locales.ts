// The 6 languages the Dashboard/Admin UI (and, by extension, the default
// system prompt / first message a widget's AI agent uses — see
// lib/vapi/assistants.ts and lib/settings/platform.ts) can be presented in.
// Distinct from widgets.language, which is the same set of values but
// scoped to one widget's own spoken language rather than a person's UI
// preference — see 0009_profile_language.sql's comment.
export const LOCALES = ["da", "en", "es", "fr", "pt", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "da";

export const LOCALE_LABELS: Record<Locale, string> = {
  da: "Dansk",
  en: "English",
  es: "Español",
  fr: "Français",
  pt: "Português",
  de: "Deutsch",
};

export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
