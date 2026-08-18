import { NextResponse } from "next/server";
import { getWidgetBundleByPublicId } from "@/lib/widgets";
import { getPlatformTwilioCredentials, validateTwilioSignature, formDataToParams } from "@/lib/twilio";
import { twilioWebhookUrls, toTwilioLanguage, conversationRelayWebSocketUrl } from "@/lib/telephony/urls";
import { buildConversationRelayResponse, buildSayAndHangupResponse, twimlResponseHeaders } from "@/lib/telephony/twiml";

export const dynamic = "force-dynamic";

function xml(body: string, status = 200) {
  return new NextResponse(body, { status, headers: twimlResponseHeaders() });
}

// The platform TwiML Application's Voice Request URL (see
// lib/twilio/voice-token.ts) — Twilio calls this the moment the browser
// Voice SDK places its call, carrying the publicId/sessionId/conversationId
// the browser passed to `device.connect({ params })`. Unlike every other
// telephony webhook in this app, this one isn't tied to a customer's Twilio
// subaccount or a real phone number — it's the platform's own TwiML App, so
// signature validation uses the platform account's own auth token.
export async function POST(request: Request): Promise<NextResponse> {
  const formData = await request.formData().catch(() => null);
  if (!formData) return xml(buildSayAndHangupResponse({ sayText: "Der opstod en fejl. Farvel." }));

  const formParams = formDataToParams(formData);
  const { publicId, sessionId, conversationId } = formParams;
  if (!publicId || !sessionId || !conversationId) {
    return xml(buildSayAndHangupResponse({ sayText: "Der opstod en fejl. Farvel." }));
  }

  const urls = twilioWebhookUrls();
  const platformCredentials = getPlatformTwilioCredentials();
  const signatureValid = validateTwilioSignature({
    url: urls.relayStart,
    formParams,
    signatureHeader: request.headers.get("x-twilio-signature"),
    authToken: platformCredentials.authToken,
  });
  if (!signatureValid) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const bundle = await getWidgetBundleByPublicId(publicId);
  if (!bundle || bundle.llmModel?.provider !== "twilio_relay") {
    return xml(buildSayAndHangupResponse({ sayText: "Denne agent er ikke tilgængelig lige nu. Farvel." }));
  }

  const wsUrl = conversationRelayWebSocketUrl();
  if (!wsUrl) {
    return xml(buildSayAndHangupResponse({ sayText: "Voice-forbindelsen er ikke konfigureret endnu. Farvel." }));
  }

  const language = toTwilioLanguage(bundle.widget.language);
  const welcomeGreeting = bundle.widget.opening_message ?? "Hej! Hvordan kan jeg hjælpe dig i dag?";

  return xml(
    buildConversationRelayResponse({
      wsUrl,
      welcomeGreeting,
      language,
      parameters: {
        widgetId: bundle.widget.id,
        customerId: bundle.customer.id,
        sessionId,
        conversationId,
      },
    })
  );
}
