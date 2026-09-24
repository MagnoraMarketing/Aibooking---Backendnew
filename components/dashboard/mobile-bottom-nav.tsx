"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoutButton } from "./logout-button";
import { AGENT_NAV_ITEMS, LEADING_NAV_ITEMS, TRAILING_NAV_ITEMS, isActiveNavItem } from "./nav-items";
import { useTranslation } from "@/components/i18n/language-provider";

// The phone-sized way around the dashboard, modelled on aibooking.dk's own
// bottom bar: the places a customer goes most, one thumb away, with the
// Dashboard itself as the raised circle in the middle. Everything else is
// one tap further, under "Menu". Hidden from sm and up, where the top bar
// has room for all of it.

const PHONE_PATH =
  "M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z";

const ICONS = {
  chat: "M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z",
  inbound: `M14.25 9.75v-4.5m0 4.5h4.5m-4.5 0 6-6 ${PHONE_PATH}`,
  outbound: `M20.25 3.75v4.5m0-4.5h-4.5m4.5 0-6 6 ${PHONE_PATH}`,
  dashboard:
    "M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z",
  menu: "M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5",
} as const;

function Icon({ path, className = "h-6 w-6" }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.6} stroke="currentColor" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

// The four around the circle. Outbound covers the dialer too — both are
// "ringe ud", and the dialer is one tap away in the menu.
const TABS = [
  { key: "dashboardShell.bottomNav.chat", href: "/dashboard/agent", icon: ICONS.chat, match: ["/dashboard/agent"] },
  { key: "dashboardShell.bottomNav.inbound", href: "/dashboard/inbound", icon: ICONS.inbound, match: ["/dashboard/inbound"] },
  {
    key: "dashboardShell.bottomNav.outbound",
    href: "/dashboard/outbound",
    icon: ICONS.outbound,
    match: ["/dashboard/outbound", "/dashboard/dialer"],
  },
] as const;

export function MobileBottomNav() {
  const pathname = usePathname();
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  // A page change closes the menu, whichever link caused it.
  useEffect(() => setMenuOpen(false), [pathname]);

  const tabClass = (active: boolean) =>
    `flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1 text-[11px] font-medium ${
      active ? "text-brand-600" : "text-slate-600"
    }`;
  const isTabActive = (match: readonly string[]) => match.some((href) => pathname.startsWith(href));
  const dashboardActive = pathname === "/dashboard";

  const [chat, inbound, outbound] = TABS;

  return (
    <>
      {menuOpen ? (
        <div className="fixed inset-0 z-[999997] bg-slate-900/40 sm:hidden" onClick={() => setMenuOpen(false)}>
          <nav
            className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-3xl bg-white px-4 pb-28 pt-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            aria-label={t("dashboardShell.bottomNav.menu")}
          >
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200" />
            {[...LEADING_NAV_ITEMS, ...AGENT_NAV_ITEMS, ...TRAILING_NAV_ITEMS].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className={`block rounded-xl px-4 py-3 text-sm font-medium ${
                  isActiveNavItem(pathname, item.href) ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {t(item.key)}
              </Link>
            ))}
            <div className="mt-2 border-t border-slate-100 pt-2">
              <Link
                href="/dashboard/profile"
                onClick={() => setMenuOpen(false)}
                className="block rounded-xl px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {t("dashboardShell.profile")}
              </Link>
              <LogoutButton />
            </div>
          </nav>
        </div>
      ) : null}

      <nav
        className="fixed inset-x-0 bottom-0 z-[999998] border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
        aria-label={t("dashboardShell.bottomNav.label")}
      >
        <div className="relative mx-auto flex h-16 max-w-md items-stretch">
          {[chat, inbound].map((tab) => (
            <Link key={tab.href} href={tab.href} className={tabClass(isTabActive(tab.match))}>
              <Icon path={tab.icon} />
              {t(tab.key)}
            </Link>
          ))}

          {/* The Dashboard, raised out of the bar as a circle. */}
          <div className="flex flex-1 flex-col items-center justify-end pb-1">
            <Link
              href="/dashboard"
              aria-label={t("dashboardShell.nav.dashboard")}
              aria-current={dashboardActive ? "page" : undefined}
              className={`absolute -top-6 left-1/2 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full text-white shadow-lg ring-4 ring-white transition active:scale-95 ${
                dashboardActive ? "bg-brand-700" : "bg-brand-600"
              }`}
            >
              <Icon path={ICONS.dashboard} className="h-7 w-7" />
            </Link>
            <span className={`text-[11px] font-medium ${dashboardActive ? "text-brand-600" : "text-slate-600"}`}>
              {t("dashboardShell.nav.dashboard")}
            </span>
          </div>

          <Link href={outbound.href} className={tabClass(isTabActive(outbound.match))}>
            <Icon path={outbound.icon} />
            {t(outbound.key)}
          </Link>

          <button type="button" onClick={() => setMenuOpen((open) => !open)} className={tabClass(menuOpen)} aria-expanded={menuOpen}>
            <Icon path={ICONS.menu} />
            {t("dashboardShell.bottomNav.menu")}
          </button>
        </div>
      </nav>
    </>
  );
}
