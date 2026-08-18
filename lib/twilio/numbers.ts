import "server-only";
import { twilioFetch, type TwilioCredentials } from "./client";
import { ApiError } from "@/types/errors";

export interface AvailableTwilioNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string | null;
  region: string | null;
  monthlyPriceDkk: number;
}

// Twilio doesn't return a price in the number-search response — local DK
// number rental is a flat rate on Twilio's public pricing page. Kept as one
// constant rather than calling the separate Pricing API, since it rarely
// changes and this avoids a second round-trip on every search.
export const DK_LOCAL_NUMBER_MONTHLY_PRICE_DKK = 15;

// Twilio requires a country to have local voice-capable numbers available
// for sale; Denmark does. Voice-enabled only — we're buying these to
// receive AI-agent calls, SMS capability isn't relevant here. Runs under
// the caller's own Twilio subaccount credentials (see
// lib/twilio/subaccounts.ts) — every customer's search/purchase is scoped
// to their own subaccount.
export async function searchAvailableDkNumbers(
  credentials: TwilioCredentials,
  areaCode?: string
): Promise<AvailableTwilioNumber[]> {
  const params = new URLSearchParams({ VoiceEnabled: "true", PageSize: "20" });
  if (areaCode) params.set("Contains", areaCode);

  const response = await twilioFetch(`/AvailablePhoneNumbers/DK/Local.json?${params.toString()}`, credentials);
  const data = (await response.json()) as {
    available_phone_numbers: Array<{
      phone_number: string;
      friendly_name: string;
      locality: string | null;
      region: string | null;
    }>;
  };

  return data.available_phone_numbers.map((n) => ({
    phoneNumber: n.phone_number,
    friendlyName: n.friendly_name,
    locality: n.locality,
    region: n.region,
    monthlyPriceDkk: DK_LOCAL_NUMBER_MONTHLY_PRICE_DKK,
  }));
}

export interface PurchasedTwilioNumber {
  sid: string;
  phoneNumber: string;
}

export async function purchaseTwilioNumber(
  credentials: TwilioCredentials,
  phoneNumber: string
): Promise<PurchasedTwilioNumber> {
  const response = await twilioFetch("/IncomingPhoneNumbers.json", credentials, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ PhoneNumber: phoneNumber }),
  }).catch((err) => {
    throw ApiError.badRequest(`Kunne ikke købe nummeret — det er muligvis ikke længere tilgængeligt. (${err.message})`);
  });

  const data = (await response.json()) as { sid: string; phone_number: string };
  return { sid: data.sid, phoneNumber: data.phone_number };
}

// Releases a purchased number back to Twilio — irreversible on Twilio's
// side, called only from the confirmed "Frigiv nummer" flow (see
// app/api/customer/phone-numbers/[id]/route.ts).
export async function releaseTwilioNumber(credentials: TwilioCredentials, twilioSid: string): Promise<void> {
  await twilioFetch(`/IncomingPhoneNumbers/${twilioSid}.json`, credentials, { method: "DELETE" });
}

// Points a number's inbound voice webhook directly at our own TwiML
// endpoints instead of importing it into Vapi — the "Twilio-direct"
// pipeline (see lib/telephony) for widgets on the provider='anthropic'
// model. statusCallbackUrl gets the call's completion event so we can
// finalize billing (app/api/telephony/twilio/voice/status).
export async function configureDirectVoiceWebhook(
  credentials: TwilioCredentials,
  twilioSid: string,
  params: { voiceUrl: string; statusCallbackUrl: string }
): Promise<void> {
  await twilioFetch(`/IncomingPhoneNumbers/${twilioSid}.json`, credentials, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      VoiceUrl: params.voiceUrl,
      VoiceMethod: "POST",
      StatusCallback: params.statusCallbackUrl,
      StatusCallbackMethod: "POST",
    }),
  });
}
