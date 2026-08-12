import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { CustomerWidgetList } from "@/components/admin/customer-detail";
import type { Customer, Package, Subscription, Widget } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminCustomerDetailPage({ params }: { params: { id: string } }) {
  await requireMasterAdmin();
  const supabase = getAdminClient();

  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", params.id)
    .maybeSingle<Customer>();

  if (!customer) notFound();

  const [{ data: widgets }, { data: subscription }, { data: creditAccount }] = await Promise.all([
    supabase
      .from("widgets")
      .select("*")
      .eq("customer_id", params.id)
      .order("created_at", { ascending: true })
      .returns<Widget[]>(),
    supabase
      .from("subscriptions")
      .select("*, packages(*)")
      .eq("customer_id", params.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<Subscription & { packages: Package | null }>(),
    supabase
      .from("credit_accounts")
      .select("balance_seconds")
      .eq("customer_id", params.id)
      .maybeSingle<{ balance_seconds: number }>(),
  ]);

  const minutesRemaining = Math.round(((creditAccount?.balance_seconds ?? 0) / 60) * 100) / 100;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          ← Tilbage til Client Portal
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{customer.name}</h1>
        <p className="mt-1 text-sm text-slate-500">{customer.email}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Status</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {customer.status === "active" ? "Aktiv" : "Inaktiv"}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Pakke</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {subscription?.packages?.package_name ?? "Ingen"}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Credits tilbage</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{minutesRemaining.toFixed(0)} min</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Agenter</h2>
        <CustomerWidgetList initialWidgets={widgets ?? []} />
      </div>
    </div>
  );
}
