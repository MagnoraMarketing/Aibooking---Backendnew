"use client";

import Link from "next/link";
import { LogoutButton } from "@/components/dashboard/logout-button";
import { useTranslation } from "@/components/i18n/language-provider";

export function AdminHeader({ userLabel }: { userLabel: string }) {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-brand-700">AIbooking.dk</span>
          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
            {t("adminShell.badge")}
          </span>
          <nav className="flex items-center gap-4 text-sm font-medium text-slate-500">
            <Link href="/admin" className="hover:text-slate-900">
              {t("adminShell.nav.customers")}
            </Link>
            <Link href="/admin/phone-numbers" className="hover:text-slate-900">
              {t("adminShell.nav.phoneNumbers")}
            </Link>
            <Link href="/admin/settings" className="hover:text-slate-900">
              {t("adminShell.nav.settings")}
            </Link>
            <Link href="/admin/settings" className="hover:text-slate-900">
              Indstillinger
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/admin/profile" className="text-sm text-slate-600 hover:text-slate-900">
            {userLabel}
          </Link>
          <div className="w-32">
            <LogoutButton />
          </div>
        </div>
      </div>
    </header>
  );
}
