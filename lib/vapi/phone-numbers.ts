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
