import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/database/admin";
import { validateTwilioSignature, formDataToParams, getOrCreateSubaccount } from "@/lib/twilio";
import { twilioWebhookUrls } from "@/lib/telephony/urls";

export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = ["completed", "busy", "failed", "no-answer", "canceled"];

// Twilio's status callback for the <Number> leg dialed out of
// dialer-start's TwiML — updates the matching lead with the call outcome
// and duration as a backstop. The dialer UI already updates the lead from
// the browser side (disposition form shown right after hangup); this
// covers the case where that never runs (tab closed mid-call, browser
// crash, etc). Never overwrites a lead the browser side already marked
// "called" — that means a disposition may already be saved and this
// shouldn't clobber it.
export async function POST(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  const leadId = url.searchParams.get("leadId");
  if (!customerId) return NextResponse.json({ error: "missing customerId" }, { status: 400 });

  const formData = await request.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const formParams = formDataToParams(formData);

  const credentials = await getOrCreateSubaccount(customerId);
  const qs = `customerId=${encodeURIComponent(customerId)}${leadId ? `&leadId=${encodeURIComponent(leadId)}` : ""}`;
  const signatureValid = validateTwilioSignature({
    url: `${twilioWebhookUrls().dialerStatus}?${qs}`,
    formParams,
    signatureHeader: request.headers.get("x-twilio-signature"),
    authToken: credentials.authToken,
  });
  if (!signatureValid) return new NextResponse("Invalid signature", { status: 403 });

  const callStatus = formParams.CallStatus;
  if (leadId && callStatus && TERMINAL_STATUSES.includes(callStatus)) {
    const supabase = getAdminClient();
    await supabase
      .from("leads")
      .update({
        status: "called",
        call_sid: formParams.CallSid ?? null,
        duration_seconds: formParams.CallDuration ? parseInt(formParams.CallDuration, 10) : null,
      })
      .eq("id", leadId)
      .eq("customer_id", customerId)
      .eq("status", "calling");
  }

  return NextResponse.json({ received: true });
}
