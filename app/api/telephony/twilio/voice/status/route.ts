import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/database/admin";
import { finalizeUsageSession } from "@/lib/usage";
import { validateTwilioSignature, formDataToParams } from "@/lib/twilio";
import { resolveTwilioCallCredentials } from "@/lib/telephony/resolve";
import { twilioWebhookUrls } from "@/lib/telephony/urls";
import { settleCampaignContact } from "@/lib/outbound/settle";

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

  // Not every status callback is for a conversation we started. A campaign
  // call placed through the customer's subaccount only becomes a
  // conversation once someone answers (outbound-start) — busy, no-answer
  // and failed calls arrive here with nothing but their CallSid. Those used
  // to be dropped, leaving the contact "calling" forever: never retried, and
  // the campaign never finished. They're settled from the contact instead.
  if (!conversation) {
    if (TERMINAL_STATUSES.includes(callStatus)) await settleUnansweredCampaignCall(request, formParams);
    return NextResponse.json({ received: true });
  }

  // A BYO number signs its callbacks with the customer's own auth token,
  // not with the subaccount token this route used to assume — against the
  // wrong token every BYO call's status callback failed the signature check
  // and returned 403, so its usage session was never finalized: the call
  // stayed "open" and its minutes were never billed. Resolving from the
  // call's own number (ours is To on an inbound call, From on an outbound
  // one) picks the right token for both kinds of number.
  const credentials = await resolveTwilioCallCredentials({
    customerId: conversation.customer_id,
    candidateNumbers: [formParams.To, formParams.From],
  });
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
    // column Vapi's call id uses (see lib/outbound/dialer.ts) —
    // provider-agnostic despite the historical name.
    const { data: contact } = await supabase
      .from("outbound_campaign_contacts")
      .select("id")
      .eq("vapi_call_id", callSid)
      .maybeSingle();
    if (contact) {
      await settleCampaignContact(supabase, contact.id, {
        answered: callStatus === "completed",
        reason: callStatus === "completed" ? "" : `Twilio: ${callStatus}`,
      });
    }
  }

  return NextResponse.json({ received: true });
}

// A terminal status for a campaign call that never reached outbound-start.
// Validated against the credentials of the campaign's own customer — the
// same number-first resolution as above — before anything is written.
async function settleUnansweredCampaignCall(request: Request, formParams: Record<string, string>): Promise<void> {
  const supabase = getAdminClient();
  const { data: contact } = await supabase
    .from("outbound_campaign_contacts")
    .select("id, campaign_id")
    .eq("vapi_call_id", formParams.CallSid)
    .maybeSingle();
  if (!contact) return;

  const { data: campaign } = await supabase
    .from("outbound_campaigns")
    .select("customer_id")
    .eq("id", contact.campaign_id)
    .maybeSingle();
  if (!campaign) return;

  const credentials = await resolveTwilioCallCredentials({
    customerId: campaign.customer_id,
    candidateNumbers: [formParams.From, formParams.To],
  });
  const signatureValid = validateTwilioSignature({
    url: twilioWebhookUrls().status,
    formParams,
    signatureHeader: request.headers.get("x-twilio-signature"),
    authToken: credentials.authToken,
  });
  if (!signatureValid) return;

  // "completed" with no conversation means Twilio connected but our answer
  // webhook never ran (e.g. it refused the call) — nobody spoke to the
  // agent, so it's retried like any other unanswered attempt.
  await settleCampaignContact(supabase, contact.id, {
    answered: false,
    reason: `Twilio: ${formParams.CallStatus}`,
  });
}
