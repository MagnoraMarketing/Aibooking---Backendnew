import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMasterAdminForPage } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { CustomerWidgetList } from "@/components/admin/customer-detail";
import type { Customer, Package, Subscription, Widget } from "@/types/database";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";
import { translate } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

export default async function AdminCustomerDetailPage({ params }: { params: { id: string } }) {
  const ctx = await requireMasterAdminForPage();
  const locale = isLocale(ctx.profile.language) ? ctx.profile.language : DEFAULT_LOCALE;
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
          {translate(locale, "adminPages.customerDetail.backToPortal")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{customer.name}</h1>
        <p className="mt-1 text-sm text-slate-500">{customer.email}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">{translate(locale, "adminPages.shared.statusLabel")}</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {customer.status === "active"
              ? translate(locale, "adminPages.shared.active")
              : translate(locale, "adminPages.shared.inactive")}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">{translate(locale, "adminPages.customerDetail.package")}</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {subscription?.packages?.package_name ?? translate(locale, "common.none")}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">{translate(locale, "adminPages.shared.creditsRemaining")}</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {minutesRemaining.toFixed(0)} {translate(locale, "adminPages.shared.minutesUnit")}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          {translate(locale, "adminPages.customerDetail.agentsHeading")}
        </h2>
        <CustomerWidgetList initialWidgets={widgets ?? []} />
      </div>
    </div>
  );
}
