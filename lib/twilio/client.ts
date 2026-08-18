import "server-only";

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

// The platform's own Twilio master account — used to search for and buy
// Danish numbers on a customer's behalf ("buy a number through us"), as
// opposed to lib/vapi/phone-numbers.ts's BYO-Twilio import path, which uses
// credentials the customer pastes in for their own Twilio account.
function getCredentials(): { accountSid: string; authToken: string } {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("Missing required environment variables: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN");
  }
  return { accountSid, authToken };
}

export function getPlatformTwilioAccountSid(): string {
  return getCredentials().accountSid;
}

// Used by the "buy a number through us" flow to hand the platform's own
// Twilio credentials to lib/vapi's importTwilioPhoneNumber — same import
// call the BYO-Twilio path uses, just with our credentials instead of a
// customer-pasted SID/token.
export function getPlatformTwilioCredentials(): { accountSid: string; authToken: string } {
  return getCredentials();
}

export async function twilioFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { accountSid, authToken } = getCredentials();
  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const response = await fetch(`${TWILIO_API_BASE}/Accounts/${accountSid}${path}`, {
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
