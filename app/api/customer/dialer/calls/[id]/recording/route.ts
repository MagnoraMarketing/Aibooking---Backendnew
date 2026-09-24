import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, requireParam } from "@/lib/security";
import { getOrCreateSubaccount } from "@/lib/twilio";
import { twilioFetch } from "@/lib/twilio/client";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// Streams a manual dialer call's recording to the signed-in customer.
//
// The audio stays in the customer's Twilio subaccount; the browser never
// gets a Twilio URL or credential, only this route — which checks the call
// belongs to the caller's own customer before fetching anything.
export const GET = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;
  const callId = requireParam(params, "id");

  const { data: call, error } = await getAdminClient()
    .from("dialer_calls")
    .select("customer_id, recording_sid, recording_status")
    .eq("id", callId)
    .maybeSingle();
  if (error) throw error;
  if (!call || call.customer_id !== customerId) throw ApiError.notFound("Call not found");
  if (!call.recording_sid || call.recording_status !== "completed") {
    throw ApiError.notFound("Optagelsen er ikke klar endnu.");
  }

  const credentials = await getOrCreateSubaccount(customerId);
  const audio = await twilioFetch(`/Recordings/${encodeURIComponent(call.recording_sid)}.mp3`, credentials);

  return new NextResponse(audio.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, no-store",
    },
  });
});
