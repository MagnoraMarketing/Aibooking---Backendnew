import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/database/admin";
import { finalizeUsageSession } from "@/lib/usage";
import { validateTwilioSignature, formDataToParams, getOrCreateSubaccount } from "@/lib/twilio";
import { twilioWebhookUrls } from "@/lib/telephony/urls";

export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = ["completed", "busy", "failed", "no-answer", "canceled"];

// Twilio's call-status webhook — configured as StatusCallback on every
// Twilio-direct number (inbound) and outbound call (see
// lib/twilio/numbers.ts's configureDirectVoiceWebhook and
// lib/twilio/calls.ts's createTwilioOutboundCall). Once the call reaches a
// terminal state, closes out the usage session (billing the accrued
// duration) and, for outbound calls, updates the campaign contact's status.
export async function POST(request: Request): Promise<NextResponse> {
  const formData = await request.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const formParams = formDataToParams(formData);
  const callSid = formParams.CallSid;
  const callStatus = formParams.CallStatus;
  if (!callSid || !callStatus) return NextResponse.json({ error: "missing params" }, { status: 400 });

  const supabase = getAdminClient();
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, customer_id")
    .eq("twilio_call_sid", callSid)
    .maybeSingle();

  // Not every status callback is for a conversation we started (e.g. a
  // call that never reached our inbound handler) — nothing to validate or
  // finalize in that case.
  if (!conversation) return NextResponse.json({ received: true });

  const credentials = await getOrCreateSubaccount(conversation.customer_id);
  const signatureValid = validateTwilioSignature({
    url: twilioWebhookUrls().status,
    formParams,
    signatureHeader: request.headers.get("x-twilio-signature"),
    authToken: credentials.authToken,
  });
  if (!signatureValid) return new NextResponse("Invalid signature", { status: 403 });

  if (TERMINAL_STATUSES.includes(callStatus)) {
    const { data: usageSession } = await supabase
      .from("usage_sessions")
      .select("id")
      .eq("conversation_id", conversation.id)
      .is("ended_at", null)
      .maybeSingle();

    if (usageSession) await finalizeUsageSession(usageSession.id);

    // Outbound campaign contacts store the Twilio call sid in the same
    // column Vapi's call id uses (see the outbound-campaigns launch route)
    // — provider-agnostic despite the historical name.
    await supabase
      .from("outbound_campaign_contacts")
      .update({
        status: callStatus === "completed" ? "completed" : "failed",
        failure_reason: callStatus === "completed" ? null : `Twilio: ${callStatus}`,
      })
      .eq("vapi_call_id", callSid);
  }

  return NextResponse.json({ received: true });
}
