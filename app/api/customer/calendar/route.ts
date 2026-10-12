import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling } from "@/lib/security";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Lists every connected calendar across all of the customer's agents. Never
// returns access_token/refresh_token/calcom_api_key — those stay
// server-side only (used from lib/calendar, never rendered to the browser).
//
// The owning agent's name and type come along because a calendar is only
// identifiable by the agent it sits on: "Frisørstuen (telefon)" is what the
// Booking tab offers when a second agent should book into the same calendar.
export const GET = withErrorHandling(async () => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("calendar_connections")
    .select(
      // calcom_timezone is read by the Settings tab's read-only booking
      // summary, which was showing a blank because the field was never
      // selected here.
      "id, widget_id, provider, status, external_account_email, calendar_id, calcom_event_type_id, calcom_timezone, created_at, widgets(name, agent_type)"
    )
    .eq("customer_id", ctx.profile.customer_id!)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const connections = (data ?? []).map(({ widgets, ...connection }) => {
    // PostgREST types a to-one embed as an array; the FK on widget_id is
    // NOT NULL, so there is exactly one row behind it.
    const owner = (Array.isArray(widgets) ? widgets[0] : widgets) as
      | { name: string | null; agent_type: string | null }
      | null
      | undefined;
    return {
      ...connection,
      widget_name: owner?.name ?? null,
      widget_agent_type: owner?.agent_type ?? null,
    };
  });

  return NextResponse.json({ connections });
});
