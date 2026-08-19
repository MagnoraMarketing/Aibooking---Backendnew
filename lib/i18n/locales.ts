// The 5 languages the Dashboard/Admin UI (and, by extension, the default
// system prompt / first message a widget's AI agent uses — see
// lib/vapi/assistants.ts and lib/settings/platform.ts) can be presented in.
// Distinct from widgets.language, which is the same set of values but
// scoped to one widget's own spoken language rather than a person's UI
// preference — see 0009_profile_language.sql's comment.
export const LOCALES = ["da", "en", "es", "fr", "pt"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "da";

export const LOCALE_LABELS: Record<Locale, string> = {
  da: "Dansk",
  en: "English",
  es: "Español",
  fr: "Français",
  pt: "Português",
};

export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

// Best-effort match of a browser's Accept-Language / navigator.language
// value (e.g. "en-US", "pt-BR", "fr") to one of our 5 supported locales —
// falls back to the platform default rather than guessing at an unsupported
// language.
export function matchLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const candidates = acceptLanguage
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase())
    .filter(Boolean) as string[];

  for (const candidate of candidates) {
    const primary = candidate.split("-")[0];
    if (isLocale(primary)) return primary;
  }

  return DEFAULT_LOCALE;
}
