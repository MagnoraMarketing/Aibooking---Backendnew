"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogoutButton } from "./logout-button";
import { useTranslation } from "@/components/i18n/language-provider";

const LEADING_NAV_ITEMS = [
  { key: "dashboardShell.nav.gettingStarted", href: "/dashboard/getting-started" },
  { key: "dashboardShell.nav.dashboard", href: "/dashboard" },
] as const;

// The four agent types (chat widget, inbound/outbound calls, dialer) grouped
// under one "Agenter" menu instead of sitting flat in the nav bar, so they
// read as one family rather than four unrelated items.
const AGENT_NAV_ITEMS = [
  { key: "dashboardShell.nav.widgetAgents", href: "/dashboard/agent" },
  { key: "dashboardShell.nav.inbound", href: "/dashboard/inbound" },
  { key: "dashboardShell.nav.outbound", href: "/dashboard/outbound" },
  { key: "dashboardShell.nav.dialer", href: "/dashboard/dialer" },
] as const;

const TRAILING_NAV_ITEMS = [
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
  const [agentsMenuOpen, setAgentsMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const agentsMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Only one menu open at a time, and every menu closes on navigation, on a
  // click outside it and on Escape — otherwise the Agenter dropdown and the
  // profile menu could sit open on top of each other and the page content.
  useEffect(() => {
    setAgentsMenuOpen(false);
    setMenuOpen(false);
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!agentsMenuOpen && !menuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (agentsMenuRef.current && !agentsMenuRef.current.contains(target)) setAgentsMenuOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(target)) setMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAgentsMenuOpen(false);
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [agentsMenuOpen, menuOpen]);

  const initials = userLabel
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  function isActiveItem(href: string): boolean {
    return href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
  }

  const isAgentsGroupActive = AGENT_NAV_ITEMS.some((item) => isActiveItem(item.href));

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-6">
          <button
            type="button"
            aria-label={t("dashboardShell.openMenu")}
            aria-expanded={mobileNavOpen}
            onClick={() => {
              setMenuOpen(false);
              setMobileNavOpen((open) => !open);
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 xl:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
            </svg>
          </button>

          <Link href="/dashboard" className="min-w-0 truncate text-sm font-semibold text-brand-700">
            {customerName}
          </Link>

          {/* The full nav needs ~1200px next to the credits/profile controls;
              below that it wraps into the controls, so it collapses into the
              menu button instead. */}
          <nav className="hidden items-center gap-1 xl:flex">
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

            <div className="relative" ref={agentsMenuRef}>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setAgentsMenuOpen((open) => !open);
                }}
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
                <div className="absolute left-0 z-30 mt-2 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
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

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="whitespace-nowrap rounded-full bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700">
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

          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              aria-expanded={menuOpen}
              onClick={() => {
                setAgentsMenuOpen(false);
                setMobileNavOpen(false);
                setMenuOpen((open) => !open);
              }}
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-slate-100"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
                {initials || "?"}
              </span>
              <span className="hidden max-w-[12rem] truncate text-sm font-medium text-slate-700 2xl:inline">{userLabel}</span>
            </button>

            {menuOpen ? (
              <div className="absolute right-0 z-30 mt-2 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
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
        <nav className="flex max-h-[calc(100vh-3.5rem)] flex-col gap-1 overflow-y-auto border-t border-slate-200 px-4 py-2 xl:hidden">
          {LEADING_NAV_ITEMS.map((item) => (
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

          <span className="mt-2 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {t("dashboardShell.nav.agentsGroup")}
          </span>
          {AGENT_NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileNavOpen(false)}
              className={`ml-2 rounded-md px-3 py-2 text-sm font-medium transition ${
                isActiveItem(item.href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t(item.key)}
            </Link>
          ))}

          <div className="mt-2 border-t border-slate-100 pt-2">
            {TRAILING_NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileNavOpen(false)}
                className={`block rounded-md px-3 py-2 text-sm font-medium transition ${
                  isActiveItem(item.href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t(item.key)}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
    </header>
  );
}
