"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "@/components/i18n/language-provider";
import { LogoutButton } from "@/components/dashboard/logout-button";

interface NavItem {
  href: string;
  labelKey: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/admin", labelKey: "adminShell.nav.dashboard" },
  { href: "/admin/widgets", labelKey: "adminShell.nav.widgets" },
  { href: "/admin/inbound", labelKey: "adminShell.nav.inbound" },
  { href: "/admin/wapi-agents", labelKey: "adminShell.nav.wapiAgents" },
  { href: "/admin/phone-numbers", labelKey: "adminShell.nav.phoneNumbers" },
  { href: "/admin/customers", labelKey: "adminShell.nav.customers" },
  { href: "/admin/integrations", labelKey: "adminShell.nav.integrations" },
  { href: "/admin/settings", labelKey: "adminShell.nav.settings" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { t } = useTranslation();
  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              active ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminSidebar({ userLabel }: { userLabel: string }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white md:flex md:flex-col">
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
          <span className="text-sm font-semibold text-brand-700">AIbooking.dk</span>
          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            {t("adminShell.badge")}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavLinks pathname={pathname} />
        </div>
        <div className="border-t border-slate-200 p-3">
          <Link href="/admin/profile" className="block truncate rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            {userLabel}
          </Link>
          <LogoutButton />
        </div>
      </aside>

      {/* Mobile top bar + slide-down nav */}
      <div className="border-b border-slate-200 bg-white md:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-brand-700">AIbooking.dk</span>
            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              {t("adminShell.badge")}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-label={t("adminShell.toggleNav")}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            {mobileOpen ? t("common.close") : t("adminShell.menu")}
          </button>
        </div>
        {mobileOpen ? (
          <div className="border-t border-slate-200 p-3">
            <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            <Link
              href="/admin/profile"
              onClick={() => setMobileOpen(false)}
              className="mt-2 block rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              {userLabel}
            </Link>
            <LogoutButton />
          </div>
        ) : null}
      </div>
    </>
  );
}
