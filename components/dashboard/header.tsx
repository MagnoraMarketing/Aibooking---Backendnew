"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogoutButton } from "./logout-button";
import { useTranslation } from "@/components/i18n/language-provider";

const NAV_ITEMS = [
  { key: "dashboardShell.nav.gettingStarted", href: "/dashboard/getting-started" },
  { key: "dashboardShell.nav.dashboard", href: "/dashboard" },
  { key: "dashboardShell.nav.widgetAgents", href: "/dashboard/agent" },
  { key: "dashboardShell.nav.inbound", href: "/dashboard/inbound" },
  { key: "dashboardShell.nav.outbound", href: "/dashboard/outbound" },
  { key: "dashboardShell.nav.dialer", href: "/dashboard/dialer" },
  { key: "dashboardShell.nav.knowledgeBase", href: "/dashboard/knowledge-base" },
  { key: "dashboardShell.nav.analytics", href: "/dashboard/analytics" },
  { key: "dashboardShell.nav.integrations", href: "/dashboard/integrations" },
  { key: "dashboardShell.nav.billing", href: "/dashboard/billing" },
  { key: "dashboardShell.nav.agency", href: "/dashboard/agency" },
] as const;

interface HeaderProps {
  customerName: string;
  userLabel: string;
  minutesRemaining: number;
}

export function Header({ customerName, userLabel, minutesRemaining }: HeaderProps) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const initials = userLabel
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  function isActiveItem(href: string): boolean {
    return href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-6">
          <button
            type="button"
            aria-label={t("dashboardShell.openMenu")}
            onClick={() => setMobileNavOpen((open) => !open)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 sm:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
            </svg>
          </button>

          <Link href="/dashboard" className="shrink-0 truncate text-sm font-semibold text-brand-700">
            {customerName}
          </Link>

          <nav className="hidden items-center gap-1 sm:flex">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition ${
                  isActiveItem(item.href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t(item.key)}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="rounded-full bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700">
            {t("dashboardShell.credits")}: {minutesRemaining.toFixed(2)}
          </div>

          <button
            type="button"
            aria-label={t("dashboardShell.notifications")}
            className="hidden h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 sm:flex"
          >
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} stroke="currentColor" className="h-5 w-5">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
              />
            </svg>
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-slate-100"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
                {initials || "?"}
              </span>
              <span className="hidden text-sm font-medium text-slate-700 sm:inline">{userLabel}</span>
            </button>

            {menuOpen ? (
              <div className="absolute right-0 mt-2 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                <Link
                  href="/dashboard/profile"
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                >
                  {t("dashboardShell.profile")}
                </Link>
                <LogoutButton />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {mobileNavOpen ? (
        <nav className="flex flex-col gap-1 border-t border-slate-200 px-4 py-2 sm:hidden">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileNavOpen(false)}
              className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                isActiveItem(item.href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t(item.key)}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}
