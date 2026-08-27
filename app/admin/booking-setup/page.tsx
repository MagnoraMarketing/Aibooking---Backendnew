import { requireMasterAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { AdminBookingSetupTable, type AdminBookingSetupRow } from "@/components/admin/booking-setup-table";

export const dynamic = "force-dynamic";

export default async function AdminBookingSetupPage() {
  await requireMasterAdminForPage();
  const supabase = getAdminClient();

  const { data } = await supabase
    .from("booking_setup_requests")
    .select("*, customers(name, email), widgets(name, booking_enabled)")
    .order("created_at", { ascending: false });

  const requests = data ?? [];

  // Whether each widget has a working Cal.com connection — the table uses it
  // to block "Færdig" on a setup that would switch booking on for an agent
  // with no calendar behind it.
  const widgetIds = requests.map((row) => row.widget_id);
  const { data: connections } = widgetIds.length
    ? await supabase
        .from("calendar_connections")
        .select("widget_id")
        .eq("provider", "calcom")
        .eq("status", "connected")
        .in("widget_id", widgetIds)
    : { data: [] };

  const connected = new Set((connections ?? []).map((row) => row.widget_id));

  const rows: AdminBookingSetupRow[] = requests.map((row) => ({
    id: row.id,
    status: row.status,
    notes: row.notes,
    requestNotes:
      typeof (row.request_details as { notes?: unknown } | null)?.notes === "string"
        ? ((row.request_details as { notes: string }).notes)
        : null,
    customerName: row.customers?.name ?? "Ukendt kunde",
    customerEmail: row.customers?.email ?? "",
    widgetName: row.widgets?.name ?? "Ukendt agent",
    bookingEnabled: row.widgets?.booking_enabled ?? false,
    calendarConnected: connected.has(row.widget_id),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  }));

  return <AdminBookingSetupTable initialRows={rows} />;
}
