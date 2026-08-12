import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { AdminHeader } from "@/components/admin/header";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAuth();

  if (ctx.profile.role !== "MASTER_ADMIN") {
    redirect(ctx.profile.role === "CUSTOMER_ADMIN" ? "/dashboard" : "/login");
  }

  const userLabel = ctx.profile.full_name || ctx.email || "Admin";

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader userLabel={userLabel} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
