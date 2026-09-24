"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogoutButton } from "./logout-button";
import { useTranslation } from "@/components/i18n/language-provider";
import { AGENT_NAV_ITEMS, LEADING_NAV_ITEMS, TRAILING_NAV_ITEMS, isActiveNavItem } from "./nav-items";

interface HeaderProps {
  customerName: string;
  userLabel: string;
  minutesRemaining: number;
}

export function Header({ customerName, userLabel, minutesRemaining }: HeaderProps) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [agentsMenuOpen, setAgentsMenuOpen] = useState(false);

  const initials = userLabel
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  function isActiveItem(href: string): boolean {
    return isActiveNavItem(pathname, href);
  }

  const isAgentsGroupActive = AGENT_NAV_ITEMS.some((item) => isActiveItem(item.href));

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-6">
          <Link href="/dashboard" className="shrink-0 truncate text-sm font-semibold text-brand-700">
            {customerName}
          </Link>

          <nav className="hidden items-center gap-1 sm:flex">
            {LEADING_NAV_ITEMS.map((item) => (
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

            <div className="relative">
              <button
                type="button"
                onClick={() => setAgentsMenuOpen((open) => !open)}
                aria-expanded={agentsMenuOpen}
                className={`flex items-center gap-1 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition ${
                  isAgentsGroupActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t("dashboardShell.nav.agentsGroup")}
                <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor" className="h-3.5 w-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              {agentsMenuOpen ? (
                <div className="absolute left-0 mt-2 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                  {AGENT_NAV_ITEMS.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setAgentsMenuOpen(false)}
                      className={`block rounded-md px-3 py-2 text-sm font-medium transition ${
                        isActiveItem(item.href) ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {t(item.key)}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>

            {TRAILING_NAV_ITEMS.map((item) => (
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

    </header>
  );
}
