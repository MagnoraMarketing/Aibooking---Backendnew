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

// First contact for an inbound call to a Twilio-direct number (see
// 0019_twilio_direct_voice.sql / lib/twilio/numbers.ts's
// configureDirectVoiceWebhook): Twilio POSTs here before it has spoken a
// word to the caller. Starts a conversation exactly like a web-widget
// session does (same usage_sessions/credit pipeline), then hands off to
// <Gather> for the first turn.
export async function POST(request: Request): Promise<NextResponse> {
  const formData = await request.formData().catch(() => null);
  if (!formData) return xml(buildSayAndHangupResponse({ sayText: "Der opstod en fejl. Farvel." }));

  const formParams = formDataToParams(formData);
  const to = formParams.To;
  const callSid = formParams.CallSid;
  if (!to || !callSid) {
    return xml(buildSayAndHangupResponse({ sayText: "Der opstod en fejl. Farvel." }));
  }

  const numberContext = await resolveTwilioDirectNumber(to);
  if (!numberContext) {
    return xml(buildSayAndHangupResponse({ sayText: "Dette nummer er ikke i brug længere. Farvel." }));
  }

  const urls = twilioWebhookUrls();
  const signatureValid = validateTwilioSignature({
    url: urls.inbound,
    formParams,
    signatureHeader: request.headers.get("x-twilio-signature"),
    authToken: numberContext.credentials.authToken,
  });
  if (!signatureValid) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const bundle = await getWidgetBundleById(numberContext.widgetId);
  if (!bundle || !bundle.llmModel || !bundle.voiceModel || bundle.widget.status !== "active") {
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

  // Idempotent on CallSid — Twilio retries this webhook, and a retry must
  // continue the same call rather than collide with the row the first
  // attempt already wrote (see lib/telephony/session.ts).
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
