import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/database/admin";
import { getWidgetBundleById } from "@/lib/widgets";
import { finalizeUsageSession } from "@/lib/usage";
import { checkAndRefillIfNeeded } from "@/lib/credits";
import { handleConversationTurn } from "@/lib/conversation/handle-turn";
import { validateTwilioSignature, formDataToParams } from "@/lib/twilio";
import { resolveTwilioDirectNumber } from "@/lib/telephony/resolve";
import { twilioWebhookUrls, toTwilioLanguage } from "@/lib/telephony/urls";
import { buildGatherResponse, buildSayAndHangupResponse, twimlResponseHeaders } from "@/lib/telephony/twiml";
import type { KnowledgeBaseSource } from "@/lib/knowledge-base/types";

export const dynamic = "force-dynamic";

function xml(body: string, status = 200) {
  return new NextResponse(body, { status, headers: twimlResponseHeaders() });
}

// Every subsequent turn of an ongoing Twilio-direct call: Twilio has just
// transcribed what the caller said (its own built-in speech recognition,
// <Gather input="speech"> in the previous response — see
// app/api/telephony/twilio/voice/inbound) and POSTs the transcript here.
// Runs it through the exact same handleConversationTurn Claude+ElevenLabs
// pipeline the web widget uses, then hands back to <Gather> for the next
// turn — a phone call is just another channel into the same conversation.
export async function POST(request: Request): Promise<NextResponse> {
  const formData = await request.formData().catch(() => null);
  if (!formData) return xml(buildSayAndHangupResponse({ sayText: "Der opstod en fejl. Farvel." }));

  const formParams = formDataToParams(formData);
  const to = formParams.To;
  const callSid = formParams.CallSid;
  const speechResult = formParams.SpeechResult;

  if (!to || !callSid) return xml(buildSayAndHangupResponse({ sayText: "Der opstod en fejl. Farvel." }));

  const numberContext = await resolveTwilioDirectNumber(to);
  if (!numberContext) return xml(buildSayAndHangupResponse({ sayText: "Der opstod en fejl. Farvel." }));

  const urls = twilioWebhookUrls();
  const signatureValid = validateTwilioSignature({
    url: urls.turn,
    formParams,
    signatureHeader: request.headers.get("x-twilio-signature"),
    authToken: numberContext.credentials.authToken,
  });
  if (!signatureValid) return new NextResponse("Invalid signature", { status: 403 });

  const supabase = getAdminClient();
  const { data: conversation } = await supabase
    .from("conversations")
    .select("*")
    .eq("twilio_call_sid", callSid)
    .maybeSingle();

  if (!conversation) return xml(buildSayAndHangupResponse({ sayText: "Samtalen blev ikke fundet. Farvel." }));

  const { data: usageSession } = await supabase
    .from("usage_sessions")
    .select("id")
    .eq("conversation_id", conversation.id)
    .is("ended_at", null)
    .maybeSingle();

  if (!usageSession) return xml(buildSayAndHangupResponse({ sayText: "Samtalen er allerede afsluttet. Farvel." }));

  const bundle = await getWidgetBundleById(conversation.widget_id);
  const language = toTwilioLanguage(bundle?.widget.language ?? "da");

  if (!bundle || !bundle.llmModel || !bundle.voiceModel) {
    await finalizeUsageSession(usageSession.id);
    return xml(buildSayAndHangupResponse({ sayText: "Denne agent er ikke tilgængelig lige nu. Farvel.", language }));
  }

  if (!speechResult || !speechResult.trim()) {
    return xml(
      buildGatherResponse({
        sayText: "Jeg hørte desværre ikke noget. Kan du sige det igen?",
        gatherActionUrl: urls.turn,
        language,
      })
    );
  }

  const refill = await checkAndRefillIfNeeded(conversation.customer_id);
  if (refill.balanceSeconds <= 0) {
    await finalizeUsageSession(usageSession.id);
    return xml(buildSayAndHangupResponse({ sayText: "Der er ikke flere minutter tilbage lige nu. Farvel.", language }));
  }

  let result;
  try {
    result = await handleConversationTurn({
      widget: bundle.widget,
      llmModel: bundle.llmModel,
      voiceModel: bundle.voiceModel,
      usageSessionId: usageSession.id,
      conversationId: conversation.id,
      customerId: conversation.customer_id,
      userMessage: speechResult,
      knowledgeBase: (bundle.extra.knowledgeBase as KnowledgeBaseSource[] | undefined) ?? [],
    });
  } catch (err) {
    console.error("Twilio-direct turn failed:", err);
    return xml(buildSayAndHangupResponse({ sayText: "Der opstod en teknisk fejl. Farvel.", language }));
  }

  // handleConversationTurn already inserted the assistant's message — find
  // it so <Play> has a stable URL to fetch its audio from (see
  // app/api/telephony/twilio/audio/[messageId]).
  const { data: lastMessage } = await supabase
    .from("conversation_messages")
    .select("id")
    .eq("conversation_id", conversation.id)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let playUrl: string | null = null;
  if (lastMessage) {
    await supabase.from("conversation_messages").update({ audio_base64: result.audioBase64 }).eq("id", lastMessage.id);
    playUrl = `${urls.audioBase}/${lastMessage.id}`;
  }

  return xml(
    buildGatherResponse({
      sayText: result.replyText,
      playUrl,
      gatherActionUrl: urls.turn,
      language,
    })
  );
}
