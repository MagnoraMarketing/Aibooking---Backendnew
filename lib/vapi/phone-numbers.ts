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

export async function createVapiManagedNumber(params: CreateVapiNumberParams): Promise<VapiPhoneNumber> {
  const response = await vapiFetch("/phone-number", {
    method: "POST",
    body: JSON.stringify({
      provider: "vapi",
      assistantId: params.assistantId,
      ...(params.name ? { name: params.name } : {}),
      ...(params.areaCode ? { numberDesiredAreaCode: params.areaCode } : {}),
    }),
  });

  const data = (await response.json()) as { id: string; number?: string };
  // The number itself can take a moment to be allotted; the id is what we
  // need to hold onto either way, and the row is refreshed on the next read.
  return { id: data.id, number: data.number ?? "" };
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
