import "server-only";
import { ApiError } from "@/types/errors";

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

// The platform's own Twilio master account — used only to create/manage
// per-customer subaccounts (see lib/twilio/subaccounts.ts). Actual number
// search/purchase/release runs under a customer's subaccount credentials,
// not these, so a given customer's Twilio activity is fully isolated from
// every other customer's.
export function getPlatformTwilioCredentials(): TwilioCredentials {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw ApiError.internal(
      "Twilio er ikke konfigureret på platformen endnu (mangler TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN i miljøvariablerne)."
    );
  }
  return { accountSid, authToken };
}

// `path` is everything after /Accounts/{accountSid} — e.g.
// "/IncomingPhoneNumbers.json". Always authenticates and scopes the request
// to the given credentials' own account (subaccount or master).
export async function twilioFetch(path: string, credentials: TwilioCredentials, init: RequestInit = {}): Promise<Response> {
  const basicAuth = Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64");

  const response = await fetch(`${TWILIO_API_BASE}/Accounts/${credentials.accountSid}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${basicAuth}`,
      ...init.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Twilio API request failed: ${response.status} ${errorBody}`);
  }

  return response;
}
