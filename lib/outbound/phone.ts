// Turns whatever a customer typed or exported into an E.164 number, or says
// exactly why it could not.
//
// Shared by the browser (the import preview) and the server (which checks
// every row again — the preview is a convenience, never the gate). No
// dependencies, so it runs the same in both.
//
// Deliberately small: a handful of countries this platform actually calls,
// each with the one rule that matters — how long a national number is and
// whether it carries a trunk "0". Anything outside that has to arrive with
// its own +country code, and is then only checked for E.164 shape.

export const E164_REGEX = /^\+[1-9]\d{6,14}$/;

interface CountryRule {
  code: string;
  // Digits after the country code, trunk 0 already removed.
  nationalLengths: number[];
  // Whether numbers are written nationally with a leading 0 (DE "030…").
  trunkZero: boolean;
}

export const PHONE_COUNTRIES: Record<string, CountryRule> = {
  DK: { code: "45", nationalLengths: [8], trunkZero: false },
  NO: { code: "47", nationalLengths: [8], trunkZero: false },
  SE: { code: "46", nationalLengths: [7, 8, 9], trunkZero: true },
  DE: { code: "49", nationalLengths: [6, 7, 8, 9, 10, 11], trunkZero: true },
  GB: { code: "44", nationalLengths: [9, 10], trunkZero: true },
  US: { code: "1", nationalLengths: [10], trunkZero: false },
};

export type PhoneCountry = keyof typeof PHONE_COUNTRIES;

export type PhoneResult =
  | { ok: true; e164: string; ambiguous: boolean }
  | { ok: false; reason: "missing" | "invalid" };

export function normalizePhone(raw: string | null | undefined, defaultCountry: PhoneCountry = "DK"): PhoneResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, reason: "missing" };

  // Letters mean this is not a number at all ("ring efter kl 12"), not a
  // number with some decoration around it.
  if (/[a-z]/i.test(trimmed)) return { ok: false, reason: "invalid" };

  let digits = trimmed.replace(/[\s\-().\/]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (!/^\+?\d+$/.test(digits)) return { ok: false, reason: "invalid" };

  // Already international: trust the country code, check the length where
  // we know the country.
  if (digits.startsWith("+")) {
    if (!E164_REGEX.test(digits)) return { ok: false, reason: "invalid" };
    for (const rule of Object.values(PHONE_COUNTRIES)) {
      if (!digits.startsWith(`+${rule.code}`)) continue;
      const national = digits.slice(rule.code.length + 1);
      if (rule.code === "1" && digits.length !== 12) continue;
      return rule.nationalLengths.includes(national.length)
        ? { ok: true, e164: digits, ambiguous: false }
        : { ok: false, reason: "invalid" };
    }
    return { ok: true, e164: digits, ambiguous: false };
  }

  const rule = PHONE_COUNTRIES[defaultCountry];
  if (!rule) return { ok: false, reason: "invalid" };

  let national = digits;
  if (rule.trunkZero && national.startsWith("0")) national = national.slice(1);
  if (rule.nationalLengths.includes(national.length)) {
    const e164 = `+${rule.code}${national}`;
    return E164_REGEX.test(e164) ? { ok: true, e164, ambiguous: false } : { ok: false, reason: "invalid" };
  }

  // "4512345678": the country code without the plus. Accepted, but flagged —
  // it is also what a mistyped number could look like, and the customer
  // should see which rows were guessed at.
  if (national.startsWith(rule.code)) {
    const rest = national.slice(rule.code.length);
    if (rule.nationalLengths.includes(rest.length)) {
      return { ok: true, e164: `+${rule.code}${rest}`, ambiguous: true };
    }
  }

  return { ok: false, reason: "invalid" };
}
