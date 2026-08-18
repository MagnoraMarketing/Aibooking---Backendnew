import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, requireParam, decryptSecret, rateLimit, getClientIp } from "@/lib/security";
import { fetchCalcomMe } from "@/lib/calendar";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// The dashboard's "Test forbindelse" button — re-verifies a stored Cal.com
// key still works (re-hits /me, the same call the initial connect made) and
// refreshes the account/timezone shown, without ever returning the key
// itself to the browser. Also flips status back to 'connected' if a
// previous test had marked it 'error'.
export const POST = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const connectionId = requireParam(params, "id");
  const customerId = ctx.profile.customer_id!;

  const rateLimitResult = rateLimit(`calendar-test:${getClientIp(request.headers)}`, { limit: 10, windowMs: 60_000 });
  if (!rateLimitResult.allowed) throw ApiError.tooManyRequests("For mange forsøg — prøv igen om lidt.");

  const { data: connection, error: lookupError } = await supabase
    .from("calendar_connections")
    .select("id, customer_id, provider, calcom_api_key")
    .eq("id", connectionId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!connection || connection.customer_id !== customerId) throw ApiError.notFound("Calendar connection not found");
  if (connection.provider !== "calcom" || !connection.calcom_api_key) {
    throw ApiError.badRequest("Denne forbindelse kan ikke testes her.");
  }

  try {
    const apiKey = decryptSecret(connection.calcom_api_key);
    const account = await fetchCalcomMe(apiKey);

    const { data: updated, error } = await supabase
      .from("calendar_connections")
      .update({
        status: "connected",
        external_account_email: account.email ?? account.username,
        calcom_timezone: account.timezone,
      })
      .eq("id", connectionId)
      .select("id, widget_id, provider, status, external_account_email, calcom_event_type_id, calcom_timezone, created_at")
      .single();
    if (error) throw error;

    return NextResponse.json({ connection: updated, ok: true });
  } catch (err) {
    await supabase.from("calendar_connections").update({ status: "error" }).eq("id", connectionId);
    const message = err instanceof ApiError ? err.message : "Kunne ikke forbinde til Cal.com. Tjek jeres API-nøgle.";
    throw ApiError.badRequest(message);
  }
});
