import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/database/admin";
import { validateTwilioSignature, formDataToParams, getOrCreateSubaccount } from "@/lib/twilio";
import { twilioWebhookUrls } from "@/lib/telephony/urls";

export const dynamic = "force-dynamic";

// Twilio's recording status callback for a manual dialer call placed with
// "Optag samtalen" on (see dialer-start's recordingStatusCallbackUrl).
//
// A recording is never assumed to exist when the call ends — it is only
// playable once this reports "completed". "absent" (nothing was recorded,
// e.g. the lead never answered) is stored too, so the page can stop
// waiting for one. Idempotent: a redelivery writes the same values again.
export async function POST(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  const callSid = url.searchParams.get("callSid");
  if (!customerId || !callSid) return NextResponse.json({ error: "missing parameters" }, { status: 400 });

  const formData = await request.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const formParams = formDataToParams(formData);

  const credentials = await getOrCreateSubaccount(customerId);
  const signatureValid = validateTwilioSignature({
    url: `${twilioWebhookUrls().dialerRecording}?customerId=${encodeURIComponent(customerId)}&callSid=${encodeURIComponent(callSid)}`,
    formParams,
    signatureHeader: request.headers.get("x-twilio-signature"),
    authToken: credentials.authToken,
  });
  if (!signatureValid) return new NextResponse("Invalid signature", { status: 403 });

  const { error } = await getAdminClient()
    .from("dialer_calls")
    .update({
      recording_sid: formParams.RecordingSid || null,
      recording_status: formParams.RecordingStatus || null,
      recording_duration_seconds: formParams.RecordingDuration ? parseInt(formParams.RecordingDuration, 10) : null,
    })
    .eq("twilio_call_sid", callSid)
    .eq("customer_id", customerId);
  if (error) console.error("[dialer-recording] could not store recording:", error.message);

  return NextResponse.json({ received: true });
}
