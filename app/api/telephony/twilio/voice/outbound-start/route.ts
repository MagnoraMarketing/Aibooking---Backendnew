import { NextResponse } from "next/server";
import { getWidgetBundleById } from "@/lib/widgets";
import { checkAndRefillIfNeeded } from "@/lib/credits";
import { validateTwilioSignature, formDataToParams } from "@/lib/twilio";
import { resolveTwilioDirectNumber } from "@/lib/telephony/resolve";
import { startOrResumePhoneCallSession } from "@/lib/telephony/session";
import { twilioWebhookUrls, toTwilioLanguage } from "@/lib/telephony/urls";
import { buildGatherResponse, buildSayAndHangupResponse, twimlResponseHeaders } from "@/lib/telephony/twiml";

export const dynamic = "force-dynamic";

function xml(body: string, status = 200) {
  return new NextResponse(body, { status, headers: twimlResponseHeaders() });
}

// Twilio fetches this the moment an outbound call (placed via
// lib/twilio/calls.ts's createTwilioOutboundCall, from the outbound
// campaigns launch route) is answered — the mirror image of
// app/api/telephony/twilio/voice/inbound: same conversation/usage-session
// setup, just framed as "we called them" rather than "they called us", so
// the number is resolved from `From` (ours) instead of `To` (theirs).
export async function POST(request: Request): Promise<NextResponse> {
  const formData = await request.formData().catch(() => null);
  if (!formData) return xml(buildSayAndHangupResponse({ sayText: "Der opstod en fejl. Farvel." }));

  const formParams = formDataToParams(formData);
  const from = formParams.From;
  const callSid = formParams.CallSid;
  if (!from || !callSid) return xml(buildSayAndHangupResponse({ sayText: "Der opstod en fejl. Farvel." }));

  const numberContext = await resolveTwilioDirectNumber(from);
  if (!numberContext) return xml(buildSayAndHangupResponse({ sayText: "Der opstod en fejl. Farvel." }));

  const urls = twilioWebhookUrls();
  const signatureValid = validateTwilioSignature({
    url: urls.outboundStart,
    formParams,
    signatureHeader: request.headers.get("x-twilio-signature"),
    authToken: numberContext.credentials.authToken,
  });
  if (!signatureValid) return new NextResponse("Invalid signature", { status: 403 });

  const bundle = await getWidgetBundleById(numberContext.widgetId);
  if (!bundle || !bundle.llmModel || !bundle.voiceModel) {
    return xml(buildSayAndHangupResponse({ sayText: "Denne agent er ikke tilgængelig lige nu. Farvel." }));
  }

  const refill = await checkAndRefillIfNeeded(bundle.customer.id);
  if (refill.balanceSeconds <= 0) {
    return xml(
      buildSayAndHangupResponse({
        sayText: "Der er desværre ikke flere minutter tilgængelige lige nu. Farvel.",
        language: toTwilioLanguage(bundle.widget.language),
      })
    );
  }

  // Same CallSid-idempotent setup the inbound handler uses — a retried
  // answer webhook resumes the call instead of colliding with its own
  // first attempt (see lib/telephony/session.ts).
  const session = await startOrResumePhoneCallSession({
    callSid,
    widgetId: bundle.widget.id,
    customerId: bundle.customer.id,
  });

  if (!session) {
    return xml(buildSayAndHangupResponse({ sayText: "Der opstod en teknisk fejl. Farvel." }));
  }

  const language = toTwilioLanguage(bundle.widget.language);
  const opening = bundle.widget.opening_message ?? "Hej! Hvordan kan jeg hjælpe dig i dag?";

  return xml(buildGatherResponse({ sayText: opening, gatherActionUrl: urls.turn, language }));
}
