import { requireMasterAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { AdminPhoneNumbersTable, type AdminPhoneNumberRow } from "@/components/admin/phone-numbers-table";

export const dynamic = "force-dynamic";

export default async function AdminPhoneNumbersPage() {
  await requireMasterAdminForPage();
  const supabase = getAdminClient();

  const { data } = await supabase
    .from("phone_numbers")
    .select("*, customers(name, email), widgets(name)")
    .order("created_at", { ascending: false });

  const rows: AdminPhoneNumberRow[] = (data ?? []).map((row) => ({
    id: row.id,
    phoneNumber: row.phone_number,
    label: row.label,
    source: row.source,
    direction: row.direction,
    purchaseStatus: row.purchase_status,
    failureReason: row.failure_reason,
    monthlyPriceDkk: row.monthly_price_dkk,
    customerName: row.customers?.name ?? "Ukendt kunde",
    customerEmail: row.customers?.email ?? "",
    widgetName: row.widgets?.name ?? "Ukendt agent",
    createdAt: row.created_at,
  }));

  return <AdminPhoneNumbersTable initialRows={rows} />;
}
