import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { decryptSecret } from "@/lib/security";
import { fetchCalcomEventTypes, type CalcomEventType } from "@/lib/calendar";
import { CalendarIntegrationsManager } from "@/components/dashboard/calendar-integrations-manager";
import { IntegrationsHero, IntegrationCategories } from "@/components/dashboard/integrations-showcase";
import type { Widget } from "@/types/database";

export const dynamic = "force-dynamic";

export interface CalendarConnectionSummary {
  id: string;
  widget_id: string;
  provider: "google" | "outlook" | "calcom";
  status: "connected" | "error";
  external_account_email: string | null;
  calendar_id: string | null;
  calcom_event_type_id: string | null;
  calcom_timezone: string | null;
  created_at: string;
}

export default async function IntegrationsPage() {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const [{ data: widgets }, { data: connectionRows }] = await Promise.all([
    supabase
      .from("widgets")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .returns<Widget[]>(),
    supabase
      .from("calendar_connections")
      .select(
        "id, widget_id, provider, status, external_account_email, calendar_id, calcom_event_type_id, calcom_timezone, calcom_api_key, created_at"
      )
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false }),
  ]);

  // The dashboard's Event Type dropdown needs real titles, not just the
  // stored id — fetched here server-side (decrypting the key just for this
  // one call) so the client component never needs its own round-trip, and
  // the key itself never leaves this request. A connection whose key has
  // gone bad just gets an empty list — the "Test forbindelse" button surfaces
  // that clearly instead.
  const eventTypesByConnection: Record<string, CalcomEventType[]> = {};
  await Promise.all(
    (connectionRows ?? [])
      .filter((row) => row.provider === "calcom" && row.calcom_api_key)
      .map(async (row) => {
        try {
          eventTypesByConnection[row.id] = await fetchCalcomEventTypes(decryptSecret(row.calcom_api_key as string));
        } catch {
          eventTypesByConnection[row.id] = [];
        }
      })
  );

  const connections: CalendarConnectionSummary[] = (connectionRows ?? []).map((row) => ({
    id: row.id,
    widget_id: row.widget_id,
    provider: row.provider,
    status: row.status,
    external_account_email: row.external_account_email,
    calendar_id: row.calendar_id,
    calcom_event_type_id: row.calcom_event_type_id,
    calcom_timezone: row.calcom_timezone,
    created_at: row.created_at,
  }));

  return (
    <div className="space-y-16">
      <IntegrationsHero />
      <IntegrationCategories />
      <CalendarIntegrationsManager
        widgets={widgets ?? []}
        initialConnections={connections}
        eventTypesByConnection={eventTypesByConnection}
      />
    </div>
  );
}
