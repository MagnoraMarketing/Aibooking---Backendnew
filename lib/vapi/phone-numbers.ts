import "server-only";
import { vapiFetch } from "./client";

// Vapi's free numbers are US-only (see docs.vapi.ai/free-telephony), so a
// Danish (or any non-US) business needs to import a number they already own
// through a supported provider — Twilio is the one this wires up, since
// it's the most common. The customer brings their own Twilio account (SID +
// auth token + the number itself); we never provision Twilio numbers
// ourselves.
export interface ImportTwilioNumberParams {
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioPhoneNumber: string;
  assistantId: string;
  name?: string;
}

export interface VapiPhoneNumber {
  id: string;
  number: string;
}

export async function importTwilioPhoneNumber(params: ImportTwilioNumberParams): Promise<VapiPhoneNumber> {
  const response = await vapiFetch("/phone-numbers/import", {
    method: "POST",
    body: JSON.stringify({
      provider: "twilio",
      number: params.twilioPhoneNumber,
      twilioAccountSid: params.twilioAccountSid,
      twilioAuthToken: params.twilioAuthToken,
      assistantId: params.assistantId,
      name: params.name,
    }),
  });
  const data = (await response.json()) as { id: string; number: string };
  return { id: data.id, number: data.number };
}

// A number Vapi itself hands out, wired to the agent's assistant the moment
// it exists. This is how inbound works on this platform: the customer keeps
// their own number and forwards it here, so nobody has to own a Twilio
// account or move their existing line.
//
// Two limits worth knowing, both Vapi's: the numbers are US-only, and an
// account gets at most 10 of them (docs.vapi.ai/free-telephony). The second
// is a ceiling on how many customers can be served this way — the error Vapi
// returns when it is reached is passed through verbatim rather than
// translated, because "you have used all 10" is exactly what the admin
// reading it needs to know.
export interface CreateVapiNumberParams {
  assistantId: string;
  name?: string;
  /** US area code, e.g. "415". Vapi picks one itself when omitted. */
  areaCode?: string;
}

// Vapi refuses a request without one ("At least one of
// numberDesiredAreaCode, sipUri must be provided"), so there is no such
// thing as letting it choose. Rather than making a Danish salon guess at US
// area codes, one is picked here when the customer names none — and a second
// and third are tried, because an area code Vapi has run dry of is a dead end
// the customer can neither see nor fix.
const FALLBACK_AREA_CODES = ["415", "212", "305", "646", "702"];

async function requestNumber(params: CreateVapiNumberParams, areaCode: string): Promise<VapiPhoneNumber> {
  const response = await vapiFetch("/phone-number", {
    method: "POST",
    body: JSON.stringify({
      provider: "vapi",
      assistantId: params.assistantId,
      numberDesiredAreaCode: areaCode,
      ...(params.name ? { name: params.name } : {}),
    }),
  });

  const data = (await response.json()) as { id: string; number?: string };
  // The number itself can take a moment to be allotted; the id is what we
  // need to hold onto either way, and the row is refreshed on the next read.
  return { id: data.id, number: data.number ?? "" };
}

// Only one kind of failure is worth trying another area code for: that area
// code having no numbers left. A missing payment method, a bad key or a
// rate limit fails identically five times over, and retrying turns one clear
// rejection into five wasted calls and a five-fold slower error.
function isAreaCodeExhausted(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /no .*numbers? (are )?available|out of numbers|no matching numbers/i.test(message);
}

export async function createVapiManagedNumber(params: CreateVapiNumberParams): Promise<VapiPhoneNumber> {
  // A code the customer typed is theirs: they get that one or the real
  // reason it failed, never a number in a different city than they asked for.
  if (params.areaCode) return requestNumber(params, params.areaCode);

  let lastError: unknown;
  for (const areaCode of FALLBACK_AREA_CODES) {
    try {
      return await requestNumber(params, areaCode);
    } catch (err) {
      if (!isAreaCodeExhausted(err)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

// Vapi refuses to hand out a number when the platform's own Vapi account has
// no payment method on file — its free allowance is one number, and every
// one after that is billed. That is a fact about OUR account, not about the
// customer clicking the button, so it must not reach them as their mistake
// or leak which vendor sits behind the agent. The real message goes to the
// log, where whoever can actually add the card will read it.
export function isVapiBillingRefusal(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /credit card|payment method|billing/i.test(message);
}

// Points an existing Vapi number at a different assistant — used when an
// agent's assistant is recreated, so the number does not keep ringing an
// assistant nobody edits any more.
export async function attachAssistantToVapiNumber(phoneNumberId: string, assistantId: string): Promise<void> {
  await vapiFetch(`/phone-number/${encodeURIComponent(phoneNumberId)}`, {
    method: "PATCH",
    body: JSON.stringify({ assistantId }),
  });
}

// The numbers already sitting in the platform's Vapi account — bought there,
// or handed out before. Listing them is what makes "use the one we already
// have" possible, which matters because Vapi's free allowance is one number
// and everything after it needs a card on file.
export interface VapiAccountNumber {
  id: string;
  number: string;
  name: string | null;
  assistantId: string | null;
}

export async function listVapiPhoneNumbers(): Promise<VapiAccountNumber[]> {
  const response = await vapiFetch("/phone-number", { method: "GET" });
  const data = (await response.json()) as Array<{
    id?: string;
    number?: string;
    name?: string;
    assistantId?: string;
  }>;

  if (!Array.isArray(data)) return [];

  return data
    .filter((row): row is { id: string; number?: string; name?: string; assistantId?: string } => typeof row?.id === "string")
    .map((row) => ({
      id: row.id,
      number: row.number ?? "",
      name: row.name ?? null,
      assistantId: row.assistantId ?? null,
    }));
}
