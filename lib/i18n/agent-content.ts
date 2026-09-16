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
// Danish system prompt, but only if explicitly told to.
//
// Danish gets a directive of its own even though the prompt is already
// Danish: without one, a Danish agent answers an English-speaking visitor in
// English, and drifts into English stock phrases ("one moment", "let me
// check") between Danish sentences. The language a customer picked in
// Settings is the language their visitors get — every sentence of it,
// fillers and confirmations included.
const LANGUAGE_DIRECTIVES: Record<Locale, string> = {
  da: "Tal altid dansk — hele samtalen, også korte mellemsætninger som “et øjeblik” og bekræftelser. Svar på dansk, også hvis kunden skriver eller taler et andet sprog.",
  en: "Always speak English — the whole conversation, including short filler phrases like “one moment” and confirmations. Answer in English even if the customer writes or speaks another language, and regardless of what language this prompt itself is written in.",
  es: "Habla siempre en español — toda la conversación, incluidas las frases breves como «un momento» y las confirmaciones. Responde en español aunque el cliente escriba o hable en otro idioma, y sin importar en qué idioma esté escrito este mensaje.",
  fr: "Parlez toujours français — toute la conversation, y compris les phrases courtes comme « un instant » et les confirmations. Répondez en français même si le client écrit ou parle une autre langue, quelle que soit la langue de ce message.",
  pt: "Fale sempre português — toda a conversa, incluindo frases curtas como «um momento» e confirmações. Responda em português mesmo que o cliente escreva ou fale outro idioma, independentemente do idioma em que esta mensagem esteja escrita.",
  de: "Sprechen Sie immer Deutsch — das gesamte Gespräch, einschließlich kurzer Einschübe wie „einen Moment“ und Bestätigungen. Antworten Sie auf Deutsch, auch wenn der Kunde in einer anderen Sprache schreibt oder spricht, und unabhängig davon, in welcher Sprache diese Eingabeaufforderung verfasst ist.",
};

export function languageDirective(widgetLanguage: string | null | undefined): string {
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
  return `${systemPrompt}\n\n${languageDirective(widgetLanguage)}`;
}

// What the agent says out loud while a tool runs, and if that tool fails.
// Vapi speaks these itself the moment a tool fires, without waiting for the
// model — and when a tool carries none, it falls back to its own built-in
// English fillers ("hold on a sec", "one moment"), which is how an otherwise
// Danish call ended up with English phrases scattered through it. Every tool
// this platform sends therefore carries these (see lib/vapi/assistants.ts).
const TOOL_WAIT: Record<Locale, string> = {
  da: "Lige et øjeblik.",
  en: "One moment.",
  es: "Un momento.",
  fr: "Un instant.",
  pt: "Um momento.",
  de: "Einen Moment.",
};

export function toolWaitText(widgetLanguage: string | null | undefined): string {
  return TOOL_WAIT[resolveLocale(widgetLanguage)];
}

const TOOL_FAILED: Record<Locale, string> = {
  da: "Det kunne jeg desværre ikke få til at virke lige nu.",
  en: "Sorry, I couldn't get that to work just now.",
  es: "Lo siento, no he podido hacerlo funcionar en este momento.",
  fr: "Désolé, je n'ai pas réussi à le faire maintenant.",
  pt: "Desculpe, não consegui fazer isso funcionar agora.",
  de: "Entschuldigung, das hat gerade nicht funktioniert.",
};

export function toolFailedText(widgetLanguage: string | null | undefined): string {
  return TOOL_FAILED[resolveLocale(widgetLanguage)];
}

// What the agent is told when it has no booking tools at all.
//
// A customer's prompt describes the job ("du hjælper kunder med at bestille
// tider"), and the tools decide what the agent can actually do. Those two
// come apart the moment a calendar is not connected: the assistant is built
// with no booking tools, nothing in the prompt says so, and the agent plays
// the part the prompt gave it. A real test call confirmed a haircut for
// 14:00, read the caller's number back, wished them well — and booked
// nothing, because there was nowhere to book it. The caller would have
// turned up to a salon with no appointment.
//
// The same reasoning is already applied to webshop tools in lib/vapi/sync.ts
// ("giving the assistant a tool it can't fulfil would just teach it to
// promise things"); this is the other direction — a promise in the prompt
// with no tool behind it.
const NO_BOOKING_DIRECTIVE: Record<Locale, string> = {
  da: "### Du kan ikke booke\nDu har ikke adgang til en kalender, så du kan hverken se ledige tider eller oprette, flytte eller aflyse en aftale — uanset hvad der ellers står i denne prompt. Beder kunden om en tid, så sig det ligeud: du kan ikke booke selv, men du kan notere navn og telefonnummer, så en medarbejder ringer tilbage og bekræfter. Bekræft aldrig et tidspunkt, og sig aldrig at du har booket, noteret eller reserveret noget i kalenderen.",
  en: "### You cannot book\nYou have no calendar access, so you can neither see available times nor create, move or cancel an appointment — whatever else this prompt says. If the customer asks for a time, say so plainly: you cannot book yourself, but you can take their name and phone number so a colleague calls back to confirm. Never confirm a time, and never say you have booked, noted or reserved anything in the calendar.",
  es: "### No puedes reservar\nNo tienes acceso a un calendario, así que no puedes ver horas disponibles ni crear, cambiar o cancelar una cita, diga lo que diga el resto de este mensaje. Si el cliente pide una hora, dilo claramente: tú no puedes reservar, pero puedes anotar su nombre y teléfono para que un compañero le llame y lo confirme. Nunca confirmes una hora ni digas que has reservado o anotado algo en el calendario.",
  fr: "### Vous ne pouvez pas réserver\nVous n'avez aucun accès à un agenda : vous ne pouvez ni voir les disponibilités ni créer, déplacer ou annuler un rendez-vous, quoi que dise le reste de ce message. Si le client demande un créneau, dites-le clairement : vous ne pouvez pas réserver, mais vous pouvez noter son nom et son numéro pour qu'un collègue rappelle et confirme. Ne confirmez jamais un horaire et ne dites jamais que vous avez réservé ou noté quelque chose dans l'agenda.",
  pt: "### Não podes marcar\nNão tens acesso a um calendário, por isso não podes ver horários disponíveis nem criar, alterar ou cancelar uma marcação — independentemente do que diga o resto desta mensagem. Se o cliente pedir uma hora, diz isso claramente: não podes marcar, mas podes anotar o nome e o telefone para que um colega ligue de volta a confirmar. Nunca confirmes um horário nem digas que marcaste ou anotaste algo no calendário.",
  de: "### Sie können nicht buchen\nSie haben keinen Kalenderzugriff und können daher weder freie Zeiten sehen noch einen Termin anlegen, verschieben oder absagen — unabhängig davon, was sonst in dieser Eingabeaufforderung steht. Fragt der Kunde nach einem Termin, sagen Sie es offen: Sie können nicht selbst buchen, aber Sie können Name und Telefonnummer notieren, damit ein Kollege zurückruft und bestätigt. Bestätigen Sie niemals eine Uhrzeit und sagen Sie nie, Sie hätten etwas im Kalender gebucht, notiert oder reserviert.",
};

// Appended to the system prompt of an agent whose booking tools are absent.
export function withNoBookingDirective(systemPrompt: string, widgetLanguage: string | null | undefined): string {
  return `${systemPrompt}\n\n${NO_BOOKING_DIRECTIVE[resolveLocale(widgetLanguage)]}`;
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
