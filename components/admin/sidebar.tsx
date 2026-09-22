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

interface NavSection {
  /** Section header label key, or null for the top-level, ungrouped items. */
  labelKey: string | null;
  items: NavItem[];
}

// Grouped so the two customer-facing agent types (Widgets, Inbound) read as
// one family, while the Wapi Agents cache — a technical, admin-only mirror
// of the underlying Vapi assistants — sits in its own section and can't be
// mistaken for a third kind of customer agent.
const NAV_SECTIONS: NavSection[] = [
  {
    labelKey: null,
    items: [{ href: "/admin", labelKey: "adminShell.nav.dashboard" }],
  },
  {
    labelKey: "adminShell.nav.groupAgents",
    items: [
      { href: "/admin/widgets", labelKey: "adminShell.nav.widgets" },
      { href: "/admin/inbound", labelKey: "adminShell.nav.inbound" },
    ],
  },
  {
    labelKey: "adminShell.nav.groupVapi",
    items: [{ href: "/admin/wapi-agents", labelKey: "adminShell.nav.wapiAgents" }],
  },
  {
    labelKey: "adminShell.nav.groupAdmin",
    items: [
      { href: "/admin/phone-numbers", labelKey: "adminShell.nav.phoneNumbers" },
      { href: "/admin/customers", labelKey: "adminShell.nav.customers" },
      { href: "/admin/integrations", labelKey: "adminShell.nav.integrations" },
      { href: "/admin/settings", labelKey: "adminShell.nav.settings" },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { t } = useTranslation();
  return (
    <nav className="flex flex-col gap-4">
      {NAV_SECTIONS.map((section, index) => (
        <div key={section.labelKey ?? `section-${index}`} className="flex flex-col gap-1">
          {section.labelKey ? (
            <span className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {t(section.labelKey)}
            </span>
          ) : null}
          {section.items.map((item) => {
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
        </div>
      ))}
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
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white md:sticky md:top-0 md:flex md:h-screen md:flex-col">
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
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white md:hidden">
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
          <div className="max-h-[calc(100vh-3.5rem)] overflow-y-auto border-t border-slate-200 p-3">
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
