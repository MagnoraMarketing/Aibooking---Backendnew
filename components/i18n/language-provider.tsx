"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { translate } from "@/lib/i18n/dictionaries";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n/locales";

interface LanguageContextValue {
  locale: Locale;
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

interface LanguageProviderProps {
  initialLocale: Locale;
  // Called after a user explicitly changes their language (see the Profile
  // settings page) — the provider always updates the NEXT_LOCALE cookie
  // itself (so the next server-rendered page matches immediately); pass
  // this to also persist it to the signed-in user's profile.language.
  onLocaleChange?: (locale: Locale) => void;
  children: ReactNode;
}

export function LanguageProvider({ initialLocale, onLocaleChange, children }: LanguageProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      onLocaleChange?.(next);
    },
    [onLocaleChange]
  );

  const value = useMemo<LanguageContextValue>(
    () => ({
      locale,
      t: (key, vars) => interpolate(translate(locale, key), vars),
      setLocale,
    }),
    [locale, setLocale]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useTranslation(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useTranslation must be used within a LanguageProvider");
  return ctx;
}
