import { requireCustomerAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { listCustomerAgents, loadCustomerPricing } from "@/lib/aibooking-dashboard/customer";
import { AibookingDashboard } from "@/components/admin/aibooking-dashboard";

export const dynamic = "force-dynamic";

// The customer's dashboard: the same view as the Aibooking.dk Dashboard the
// platform uses for its own agents — history with transcripts and
// recordings, bookings and statistics — for this customer's agents, with
// usage priced at their package's minute price. The calls themselves are
// fetched by the client component from /api/customer/call-dashboard.
export default async function DashboardPage() {
  const ctx = await requireCustomerAdminForPage();
  const customerId = ctx.profile.customer_id!;

  const [agents, pricing, { data: customer }] = await Promise.all([
    listCustomerAgents(customerId),
    loadCustomerPricing(customerId),
    getAdminClient().from("customers").select("name").eq("id", customerId).maybeSingle(),
  ]);

  return (
    <AibookingDashboard
      variant="customer"
      initialAgents={agents}
      initialPricing={pricing}
      customerName={(customer as { name?: string } | null)?.name ?? null}
    />
  );
}
