import { isLocale, type Locale } from "./locales";

// Widgets store language as a bare string (widgets.language, unconstrained
// at the DB level — see 0001_init_schema.sql) but every value this platform
// actually writes to it comes from the same locale set profiles.language
// uses (see lib/i18n/locales.ts). This module is the single place that
// turns that bare code into what an AI agent actually needs to say/hear in
// the right language: a Claude system-prompt directive, the literal
// greeting spoken before any AI reasoning happens, and Twilio's BCP-47 tag.

function resolveLocale(widgetLanguage: string | null | undefined): Locale {
  return isLocale(widgetLanguage) ? widgetLanguage : "da";
}

// Every default/example system prompt on this platform (see
// lib/settings/platform.ts, lib/llm/context-builder.ts) is authored in
// Danish — Claude can still converse fluently in another language given a
// Danish system prompt, but only if explicitly told to. `null` for Danish
// itself: the prompt is already in the right language, no directive needed.
const LANGUAGE_DIRECTIVES: Record<Locale, string | null> = {
  da: null,
  en: "Always respond in English, regardless of what language this prompt itself is written in.",
  es: "Responde siempre en español, sin importar en qué idioma esté escrito este mensaje.",
  fr: "Répondez toujours en français, quelle que soit la langue de ce message.",
  pt: "Responda sempre em português, independentemente do idioma em que esta mensagem esteja escrita.",
  de: "Antworten Sie immer auf Deutsch, unabhängig davon, in welcher Sprache diese Eingabeaufforderung verfasst ist.",
};

export function languageDirective(widgetLanguage: string | null | undefined): string | null {
  return LANGUAGE_DIRECTIVES[resolveLocale(widgetLanguage)];
}

// Danish name of each language — used only inside Danish-authored
// meta-instructions we send to Claude (e.g. "generate prompt" tool's own
// prompt, see app/api/customer/widgets/[id]/generate-prompt/route.ts),
// never shown to a human.
const LANGUAGE_NAMES_DA: Record<Locale, string> = {
  da: "dansk",
  en: "engelsk",
  es: "spansk",
  fr: "fransk",
  pt: "portugisisk",
  de: "tysk",
};

export function languageNameInDanish(widgetLanguage: string | null | undefined): string {
  return LANGUAGE_NAMES_DA[resolveLocale(widgetLanguage)];
}

// Appends the directive (if any) to a system prompt — the one place every
// caller should go through, so a language added to LANGUAGE_DIRECTIVES
// above is picked up everywhere at once.
export function withLanguageDirective(systemPrompt: string, widgetLanguage: string | null | undefined): string {
  const directive = languageDirective(widgetLanguage);
  return directive ? `${systemPrompt}\n\n${directive}` : systemPrompt;
}

// The literal first thing an agent says, spoken before any AI turn runs —
// used whenever a widget has no opening_message/welcome_message of its own
// yet (a freshly created agent). Unlike the system prompt, there's no
// reasoning step to adapt this, so it must already be in the right
// language.
const DEFAULT_GREETINGS: Record<Locale, string> = {
  da: "Hej! Hvordan kan jeg hjælpe dig i dag?",
  en: "Hi! How can I help you today?",
  es: "¡Hola! ¿Cómo puedo ayudarte hoy?",
  fr: "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
  pt: "Olá! Como posso ajudá-lo hoje?",
  de: "Hallo! Wie kann ich Ihnen heute helfen?",
};

export function defaultGreeting(widgetLanguage: string | null | undefined): string {
  return DEFAULT_GREETINGS[resolveLocale(widgetLanguage)];
}

// Handful of other spoken fallbacks on the Twilio-direct (classic Gather)
// phone pipeline — see app/api/telephony/twilio/voice/*.
const NO_SPEECH_HEARD: Record<Locale, string> = {
  da: "Vi kunne ikke høre noget. Farvel for nu.",
  en: "We couldn't hear anything. Goodbye for now.",
  es: "No pudimos escuchar nada. Hasta luego.",
  fr: "Nous n'avons rien entendu. Au revoir.",
  pt: "Não conseguimos ouvir nada. Até logo.",
  de: "Wir konnten nichts hören. Auf Wiedersehen.",
};

export function noSpeechHeardText(widgetLanguage: string | null | undefined): string {
  return NO_SPEECH_HEARD[resolveLocale(widgetLanguage)];
}

const ASK_TO_REPEAT: Record<Locale, string> = {
  da: "Jeg hørte desværre ikke noget. Kan du sige det igen?",
  en: "Sorry, I didn't hear anything. Could you say that again?",
  es: "Lo siento, no escuché nada. ¿Puedes repetirlo?",
  fr: "Désolé, je n'ai rien entendu. Pouvez-vous répéter ?",
  pt: "Desculpe, não ouvi nada. Pode repetir?",
  de: "Entschuldigung, ich habe nichts gehört. Können Sie das bitte wiederholen?",
};

export function askToRepeatText(widgetLanguage: string | null | undefined): string {
  return ASK_TO_REPEAT[resolveLocale(widgetLanguage)];
}

const AGENT_UNAVAILABLE: Record<Locale, string> = {
  da: "Denne agent er ikke tilgængelig lige nu. Farvel.",
  en: "This agent isn't available right now. Goodbye.",
  es: "Este agente no está disponible en este momento. Adiós.",
  fr: "Cet agent n'est pas disponible pour le moment. Au revoir.",
  pt: "Este agente não está disponível no momento. Adeus.",
  de: "Dieser Agent ist derzeit nicht verfügbar. Auf Wiedersehen.",
};

export function agentUnavailableText(widgetLanguage: string | null | undefined): string {
  return AGENT_UNAVAILABLE[resolveLocale(widgetLanguage)];
}

// Twilio's <Say>/<Gather> `language` attribute wants a BCP-47 tag, not the
// bare locale code this app stores on widgets.language.
const TWILIO_LANGUAGE_TAGS: Record<Locale, string> = {
  da: "da-DK",
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  pt: "pt-PT",
  de: "de-DE",
};

export function toTwilioLanguage(widgetLanguage: string | null | undefined): string {
  return TWILIO_LANGUAGE_TAGS[resolveLocale(widgetLanguage)];
}
