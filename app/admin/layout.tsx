import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireAuthForPage } from "@/lib/auth";
import { AdminSidebar } from "@/components/admin/sidebar";
import { LanguageProvider } from "@/components/i18n/language-provider";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAuthForPage();

  if (ctx.profile.role !== "MASTER_ADMIN") {
    redirect(ctx.profile.role === "CUSTOMER_ADMIN" ? "/dashboard" : "/login");
  }

  const userLabel = ctx.profile.full_name || ctx.email || "Admin";
  const locale = isLocale(ctx.profile.language) ? ctx.profile.language : DEFAULT_LOCALE;

  return (
    <LanguageProvider initialLocale={locale}>
      <div className="flex min-h-screen flex-col bg-slate-50 md:flex-row">
        <AdminSidebar userLabel={userLabel} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      </div>
    </LanguageProvider>
  );
}
