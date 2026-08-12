import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { Header } from "@/components/dashboard/header";
import type { Customer } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAuth();

  if (ctx.profile.role === "MASTER_ADMIN") {
    redirect("/admin");
  }

  if (ctx.profile.role !== "CUSTOMER_ADMIN" || !ctx.profile.customer_id) {
    redirect("/login");
  }

  const supabase = getAdminClient();
  const [{ data: customer }, { data: creditAccount }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", ctx.profile.customer_id).single<Customer>(),
    supabase
      .from("credit_accounts")
      .select("balance_seconds")
      .eq("customer_id", ctx.profile.customer_id)
      .maybeSingle<{ balance_seconds: number }>(),
  ]);

  const minutesRemaining = Math.round(((creditAccount?.balance_seconds ?? 0) / 60) * 100) / 100;
  const userLabel = ctx.profile.full_name || ctx.email || "Bruger";

  return (
    <div className="min-h-screen bg-slate-50">
      <Header
        customerName={customer?.name ?? "AIbooking.dk"}
        userLabel={userLabel}
        minutesRemaining={minutesRemaining}
      />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
