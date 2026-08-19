import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/database/admin";
import { getWidgetBundleById } from "@/lib/widgets";
import { createUsageSession } from "@/lib/usage";
import { checkAndRefillIfNeeded } from "@/lib/credits";
import { validateTwilioSignature, formDataToParams } from "@/lib/twilio";
import { resolveTwilioDirectNumber } from "@/lib/telephony/resolve";
import { twilioWebhookUrls, toTwilioLanguage } from "@/lib/telephony/urls";
import { buildGatherResponse, buildSayAndHangupResponse, twimlResponseHeaders } from "@/lib/telephony/twiml";
import { defaultGreeting, noSpeechHeardText } from "@/lib/i18n/agent-content";

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

  const supabase = getAdminClient();
  const { data: conversation, error } = await supabase
    .from("conversations")
    .insert({
      widget_id: bundle.widget.id,
      customer_id: bundle.customer.id,
      status: "active",
      channel: "phone",
      twilio_call_sid: callSid,
    })
    .select("*")
    .single();

  if (error || !conversation) {
    console.error("Failed to create outbound phone conversation:", error);
    return xml(buildSayAndHangupResponse({ sayText: "Der opstod en teknisk fejl. Farvel." }));
  }

  await createUsageSession({
    customerId: bundle.customer.id,
    widgetId: bundle.widget.id,
    conversationId: conversation.id,
  });

  const language = toTwilioLanguage(bundle.widget.language);
  const opening = bundle.widget.opening_message ?? defaultGreeting(bundle.widget.language);

  return xml(
    buildGatherResponse({
      sayText: opening,
      gatherActionUrl: urls.turn,
      language,
      noInputText: noSpeechHeardText(bundle.widget.language),
    })
  );
}
