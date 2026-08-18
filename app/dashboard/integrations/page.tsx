import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { CalendarIntegrationsManager } from "@/components/dashboard/calendar-integrations-manager";
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
  created_at: string;
}

export default async function IntegrationsPage() {
  const ctx = await requireCustomerAdminForPage();
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const [{ data: widgets }, { data: connections }] = await Promise.all([
    supabase
      .from("widgets")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .returns<Widget[]>(),
    supabase
      .from("calendar_connections")
      .select("id, widget_id, provider, status, external_account_email, calendar_id, calcom_event_type_id, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .returns<CalendarConnectionSummary[]>(),
  ]);

  return (
    <CalendarIntegrationsManager widgets={widgets ?? []} initialConnections={connections ?? []} />
  );
}
