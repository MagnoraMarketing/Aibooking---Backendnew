import "server-only";
import { twilioFetch, type TwilioCredentials } from "./client";

export interface CreateTwilioOutboundCallParams {
  to: string;
  from: string;
  voiceUrl: string;
  statusCallbackUrl: string;
}

// Places an outbound call directly via Twilio (the "Twilio-direct"
// pipeline's counterpart to lib/vapi/calls.ts's createOutboundCall) —
// Twilio fetches `voiceUrl` for TwiML the moment the callee answers, same
// shape as app/api/telephony/twilio/voice/inbound but framed as "we called
// them" rather than "they called us".
export async function createTwilioOutboundCall(
  credentials: TwilioCredentials,
  params: CreateTwilioOutboundCallParams
): Promise<{ sid: string }> {
  const response = await twilioFetch("/Calls.json", credentials, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      To: params.to,
      From: params.from,
      Url: params.voiceUrl,
      StatusCallback: params.statusCallbackUrl,
      StatusCallbackMethod: "POST",
    }),
  });
  const data = (await response.json()) as { sid: string };
  return { sid: data.sid };
}
