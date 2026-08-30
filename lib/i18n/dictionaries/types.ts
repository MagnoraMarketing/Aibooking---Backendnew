import type { Locale } from "../locales";

// One translated string per supported locale. `da` is required (it's the
// platform's original/fallback language); the rest are required too so a
// missing translation is a type error, not a silent English/Danish leak.
export type TranslationEntry = Record<Locale, string>;

// A namespace is a flat map of dotted-suffix keys to their translations,
// e.g. common["nav.dashboard"]. Keeping all languages side by side per
// key (rather than one file per locale) makes it obvious at a glance when
// a translation is missing, and keeps each namespace file self-contained.
export type Namespace = Record<string, TranslationEntry>;
