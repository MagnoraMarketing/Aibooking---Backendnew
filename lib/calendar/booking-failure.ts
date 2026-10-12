// Why a booking was refused, in words the agent can act on.
//
// A test call ended in "der er desværre sket en teknisk fejl". Nothing
// technical had failed: the caller said "mail@magnoramarketing.dk", the
// speech-to-text heard "mail@magnora.marketing.dk", and Cal.com refused an
// address at a domain that cannot receive mail. The agent was told only that
// the booking failed and that it should offer another time — so it offered
// another time, which was never the problem, and the caller left without an
// appointment that the calendar had free all along.
//
// A refusal the caller can fix in one sentence must not be relayed as a
// breakdown. What differs per reason is the next move, so that is what this
// works out.

export type BookingFailureKind = "email" | "slot" | "credentials" | "unknown";

// Cal.com answers in English, with the reason both as a code and as a
// sentence; either may change wording, so both are matched loosely.
const EMAIL_REFUSAL = /email_domain_cannot_receive_mail|cannot receive mail|invalid email|valid email|email.*not valid/i;
const SLOT_REFUSAL =
  /no_available_users_found|already.*booked|booking_seats_full|slot.*(taken|unavailable|not available)|not available/i;
const CREDENTIAL_REFUSAL = /Ugyldig Cal\.com API-nøgle|unauthorized|invalid_token|forbidden/i;

export function bookingFailureKind(err: unknown): BookingFailureKind {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (EMAIL_REFUSAL.test(message)) return "email";
  if (SLOT_REFUSAL.test(message)) return "slot";
  if (CREDENTIAL_REFUSAL.test(message)) return "credentials";
  return "unknown";
}

// Spoken back by the agent, so: no codes, no stack traces, and above all
// never a confirmation. Every one of these says the booking did not happen —
// the model must not be able to read a failure as a booked appointment.
const ADVICE: Record<BookingFailureKind, string> = {
  email:
    "Bookingen blev IKKE gennemført, fordi e-mailadressen blev afvist — den kan ikke modtage post, så den er sandsynligvis hørt forkert. " +
    "Tiden er stadig ledig. Bed kunden om at gentage e-mailadressen langsomt eller stave den, læs den op til godkendelse, og book derefter igen med den rettede adresse.",
  slot:
    "Bookingen blev IKKE gennemført — tiden blev optaget, mens I talte. Sig det ærligt til kunden, find en anden ledig tid og book den i stedet.",
  credentials:
    "Bookingen blev IKKE gennemført, fordi kalenderen ikke kunne kontaktes. Det er ikke noget kunden kan rette. Sig undskyld, tag imod kundens kontaktoplysninger og lov, at der bliver vendt tilbage.",
  unknown:
    "Bookingen kunne IKKE gennemføres — tiden er ikke reserveret. Sig det ærligt til kunden og tilbyd at finde en anden tid.",
};

export function bookingFailureAdvice(err: unknown): string {
  return ADVICE[bookingFailureKind(err)];
}

// An address the caller cannot have meant — a space in the middle, no @, a
// domain with no dot. Caught before Cal.com is asked, because there is
// nothing to ask: the answer would be the same refusal, one round-trip and
// one failed booking record later.
export const MALFORMED_EMAIL_ADVICE =
  "Bookingen blev IKKE gennemført, fordi e-mailadressen ikke ser ud som en e-mailadresse — den er sandsynligvis hørt forkert. " +
  "Tiden er stadig ledig. Bed kunden stave e-mailadressen, læs den op til godkendelse, og book derefter igen.";

// Deliberately loose: it only has to catch what cannot possibly be an
// address. Whether a real domain can receive mail is Cal.com's answer to
// give, not a regex's.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Speech-to-text puts spaces where a caller paused ("mail @ magnora .dk").
// A space is never part of an address, so removing them loses nothing.
export function normalizeDictatedEmail(raw: string): string {
  return raw.replace(/\s+/g, "");
}

export function looksLikeEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value);
}

// What every booking needs before Cal.com is asked: a time, the customer's
// real name, and an email address the customer has heard read back and said
// yes to — that address is where the confirmation goes, so a wrong one means
// a booking the customer never hears about. Checked here, server-side,
// rather than left to the prompt alone: a model in a hurry fills in
// "Kunden" as the name or books on an address it never read back, and the
// calendar takes it either way.
//
// Each refusal names the one thing missing, so the agent asks for exactly
// that and books again, instead of starting the conversation over.
export interface BookingDetailsInput {
  start_time?: string;
  customer_name?: string;
  customer_email?: string;
  // Some models send a JSON boolean as the string "true".
  email_confirmed?: boolean | string;
}

export type BookingDetailsCheck =
  | { ok: true; startTime: string; customerName: string; customerEmail: string }
  | { ok: false; advice: string };

export const MISSING_TIME_ADVICE =
  "Bookingen blev IKKE gennemført, fordi tidspunktet mangler. Tjek ledige tider, lad kunden vælge en, og book derefter igen.";

export const MISSING_NAME_ADVICE =
  "Bookingen blev IKKE gennemført, fordi kundens navn mangler. Spørg kunden om deres fulde navn, og book derefter igen.";

export const MISSING_EMAIL_ADVICE =
  "Bookingen blev IKKE gennemført, fordi e-mailadressen mangler — det er dertil bekræftelsen sendes. " +
  "Spørg kunden om deres e-mailadresse, læs den op stavet tydeligt til godkendelse, og book derefter igen.";

export const UNCONFIRMED_EMAIL_ADVICE =
  "Bookingen blev IKKE gennemført, fordi kunden ikke har bekræftet e-mailadressen. Tiden er stadig ledig. " +
  "Læs e-mailadressen op stavet tydeligt, spørg „Er det korrekt?“, og book igen med email_confirmed sat til true, når kunden har sagt ja.";

// Words a model writes in the name field when it never asked for one.
const PLACEHOLDER_NAMES = new Set([
  "kunde",
  "kunden",
  "ukendt",
  "ukendt kunde",
  "navn",
  "anonym",
  "customer",
  "the customer",
  "caller",
  "unknown",
  "name",
  "anonymous",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
]);

// A name has at least two letters, isn't an email address that ended up in
// the wrong field, and isn't a stand-in for "I didn't ask".
export function looksLikeName(value: string): boolean {
  const name = value.trim();
  if (name.includes("@")) return false;
  if ((name.match(/\p{L}/gu) ?? []).length < 2) return false;
  return !PLACEHOLDER_NAMES.has(name.toLowerCase());
}

export function checkBookingDetails(input: BookingDetailsInput): BookingDetailsCheck {
  const startTime = input.start_time?.trim();
  if (!startTime) return { ok: false, advice: MISSING_TIME_ADVICE };

  const customerName = input.customer_name?.trim().replace(/\s+/g, " ") ?? "";
  if (!looksLikeName(customerName)) return { ok: false, advice: MISSING_NAME_ADVICE };

  const customerEmail = input.customer_email ? normalizeDictatedEmail(input.customer_email) : "";
  if (!customerEmail) return { ok: false, advice: MISSING_EMAIL_ADVICE };
  if (!looksLikeEmail(customerEmail)) return { ok: false, advice: MALFORMED_EMAIL_ADVICE };

  if (input.email_confirmed !== true && input.email_confirmed !== "true") return { ok: false, advice: UNCONFIRMED_EMAIL_ADVICE };

  return { ok: true, startTime, customerName, customerEmail };
}
