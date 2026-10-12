import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, requireParam, decryptSecret } from "@/lib/security";
import { fetchCalcomEventTypes } from "@/lib/calendar";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// The Event Type dropdown's data for one connection. The Integrations page
// gets the same list server-side (app/dashboard/integrations/page.tsx), but
// the agent's Booking tab connects and then immediately offers the choice
// from the browser, with no page load in between — so it needs this.
// Returns titles and ids only: the API key is decrypted for this one call
// and never leaves the server.
export const GET = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const connectionId = requireParam(params, "id");

  const { data: connection, error } = await supabase
    .from("calendar_connections")
    .select("id, customer_id, provider, calcom_api_key")
    .eq("id", connectionId)
    .maybeSingle();
  if (error) throw error;
  if (!connection || connection.customer_id !== ctx.profile.customer_id) {
    throw ApiError.notFound("Calendar connection not found");
  }
  if (connection.provider !== "calcom" || !connection.calcom_api_key) {
    throw ApiError.badRequest("Denne forbindelse har ikke event-typer.");
  }

  const eventTypes = await fetchCalcomEventTypes(decryptSecret(connection.calcom_api_key));
  return NextResponse.json({ eventTypes });
});
