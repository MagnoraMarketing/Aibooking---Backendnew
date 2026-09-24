import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/database/admin";
import { validateTwilioSignature, formDataToParams, getOrCreateSubaccount } from "@/lib/twilio";
import { twilioWebhookUrls } from "@/lib/telephony/urls";
import { buildDialResponse, buildSayAndHangupResponse, twimlResponseHeaders } from "@/lib/telephony/twiml";
import { isSuppressed } from "@/lib/outbound/suppression";

export const dynamic = "force-dynamic";

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

function xml(body: string, status = 200) {
  return new NextResponse(body, { status, headers: twimlResponseHeaders() });
}

// Twilio fetches this the moment the browser's Twilio Voice SDK places an
// outgoing call against a customer's dialer TwiML Application (see
// lib/twilio/dialer.ts's getOrCreateDialerApp, which configures this exact
// URL — with `?customerId=` appended — as that app's Voice Request URL).
// Bridges the browser leg straight to the lead's number via <Dial>, using
// the caller ID the agent picked in the dialer UI
// (components/dashboard/dialer-manager.tsx). No AI/ConversationRelay
// involved — the human on the browser end IS the conversation.
export async function POST(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  if (!customerId) return xml(buildSayAndHangupResponse({ sayText: "Der opstod en fejl. Farvel." }));

  const formData = await request.formData().catch(() => null);
  if (!formData) return xml(buildSayAndHangupResponse({ sayText: "Der opstod en fejl. Farvel." }));
  const formParams = formDataToParams(formData);

  const credentials = await getOrCreateSubaccount(customerId);
  const signatureValid = validateTwilioSignature({
    url: `${twilioWebhookUrls().dialerStart}?customerId=${encodeURIComponent(customerId)}`,
    formParams,
    signatureHeader: request.headers.get("x-twilio-signature"),
    authToken: credentials.authToken,
  });
  if (!signatureValid) return new NextResponse("Invalid signature", { status: 403 });

  const to = formParams.To;
  const callerId = formParams.CallerId;
  const leadId = formParams.LeadId || null;
  if (!to || !E164_REGEX.test(to) || !callerId) {
    return xml(buildSayAndHangupResponse({ sayText: "Ugyldigt nummer. Farvel." }));
  }

  const supabase = getAdminClient();

  // The caller ID must be a number this customer actually owns and can
  // dial out from — otherwise the connect() params (fully client-supplied)
  // would let a browser call spoof any number as its caller ID.
  const { data: phoneNumber } = await supabase
    .from("phone_numbers")
    .select("id")
    .eq("customer_id", customerId)
    .eq("phone_number", callerId)
    .eq("source", "platform_twilio")
    .eq("purchase_status", "active")
    .neq("direction", "inbound")
    .maybeSingle();
  if (!phoneNumber) {
    return xml(buildSayAndHangupResponse({ sayText: "Dette nummer kan ikke bruges til udgående opkald. Farvel." }));
  }

  // Never ring a number on the customer's do-not-call list, or a lead marked
  // as such — whatever the browser asked for.
  if (await isSuppressed(customerId, to)) {
    return xml(buildSayAndHangupResponse({ sayText: "Nummeret står på spærrelisten og kan ikke ringes op. Farvel." }));
  }

  let listId: string | null = null;
  if (leadId) {
    const { data: lead } = await supabase
      .from("leads")
      .select("id, list_id, status, attempt_count")
      .eq("id", leadId)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (lead?.status === "do_not_call") {
      return xml(buildSayAndHangupResponse({ sayText: "Denne kontakt må ikke ringes op. Farvel." }));
    }
    if (lead) {
      listId = lead.list_id;
      await supabase
        .from("leads")
        .update({
          status: "calling",
          called_at: new Date().toISOString(),
          call_sid: formParams.CallSid ?? null,
          attempt_count: (lead.attempt_count ?? 0) + 1,
        })
        .eq("id", leadId)
        .eq("customer_id", customerId);
    }
  }

  // The call's own record — its history, outcome and recording hang off
  // this row. Keyed on the browser leg's CallSid, which the dialled leg
  // reports back as ParentCallSid; a redelivered request is a no-op.
  const callSid = formParams.CallSid;
  if (callSid) {
    const identity = (formParams.From ?? "").replace(/^client:/, "");
    const userId = identity.startsWith("dialer-") ? identity.slice("dialer-".length) : null;
    const { error: callError } = await supabase.from("dialer_calls").upsert(
      {
        customer_id: customerId,
        lead_id: leadId,
        list_id: listId,
        user_id: userId && /^[0-9a-f-]{36}$/i.test(userId) ? userId : null,
        twilio_call_sid: callSid,
        from_number: callerId,
        to_number: to,
        status: "initiated",
      },
      { onConflict: "twilio_call_sid", ignoreDuplicates: true }
    );
    if (callError) console.error("[dialer-start] could not record call:", callError.message);
  }

  const statusQs = `customerId=${encodeURIComponent(customerId)}${leadId ? `&leadId=${encodeURIComponent(leadId)}` : ""}`;
  const statusCallbackUrl = `${twilioWebhookUrls().dialerStatus}?${statusQs}`;

  // Recording is opt-in per call (the "Optag samtalen" switch in the
  // dialer), never the default.
  const recordingStatusCallbackUrl =
    formParams.Record === "true" && callSid
      ? `${twilioWebhookUrls().dialerRecording}?customerId=${encodeURIComponent(customerId)}&callSid=${encodeURIComponent(callSid)}`
      : undefined;

  return xml(buildDialResponse({ to, callerId, statusCallbackUrl, recordingStatusCallbackUrl }));
}
