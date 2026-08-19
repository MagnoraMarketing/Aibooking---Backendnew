import type { ReactNode } from "react";
import { translate } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";

// Static, server-renderable marketing content for /dashboard/integrations —
// mirrors the sales pitch on aibooking.dk/integrationer (hero, category
// grid) so the in-app page reads the same way prospects already saw it
// before signing up. No client state needed here; the interactive part
// (actually connecting a calendar) lives in CalendarIntegrationsManager,
// rendered below this in the page.

function IconBadge({ children, tint }: { children: ReactNode; tint: string }) {
  return (
    <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${tint}`}>{children}</div>
  );
}

// Minimal inline stroke icons — no icon library in this project, and these
// are simple enough not to warrant adding one.
const ICONS = {
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  bolt: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5M16 8.2a3 3 0 1 1 3.6 4.9M20.5 20c0-2.7-1.7-4.6-3.8-5.3" strokeLinecap="round" />
    </svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <path d="M4 5.5h16v11H9l-4 3.5v-3.5H4v-11Z" strokeLinejoin="round" />
    </svg>
  ),
  document: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <path d="M6 3.5h8l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
      <path d="M14 3.5V8h4M8 12.5h8M8 16h5" strokeLinecap="round" />
    </svg>
  ),
  cart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <path d="M3.5 4.5h2.2l1 12.2a1.5 1.5 0 0 0 1.5 1.4h9.6a1.5 1.5 0 0 0 1.5-1.3l1.2-7.4H6.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9.5" cy="20.5" r="1.3" />
      <circle cx="17" cy="20.5" r="1.3" />
    </svg>
  ),
  wrench: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
      <path d="m14.5 6.5 3 3-8 8-3-3 8-8Z" strokeLinejoin="round" />
      <path d="M17.5 3.5a4 4 0 0 1 3 3l-2 2-3-3 2-2ZM5.5 15.5l-2 2a2.3 2.3 0 0 0 3 3l2-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
} as const;

const HERO_FEATURES = [
  {
    icon: ICONS.clock,
    tint: "bg-brand-50 text-brand-600",
    title: "Spar Timer Dagligt",
    description: "Automatiser ind- og udgående opkald, SMS og emails mens AI'en synkroniserer med jeres systemer.",
  },
  {
    icon: ICONS.bolt,
    tint: "bg-brand-50 text-brand-600",
    title: "Hurtig Opsætning",
    description: "Ingen kompliceret installation. Forbind jeres eksisterende værktøjer på minutter.",
  },
  {
    icon: ICONS.check,
    tint: "bg-brand-50 text-brand-600",
    title: "Altid Synkroniseret",
    description: "Real-time opdateringer på tværs af alle jeres platforme. Ingen dobbeltarbejde.",
  },
];

const CATEGORIES = [
  { icon: ICONS.calendar, tint: "bg-blue-50 text-blue-600", title: "Kalender & Planlægning", tools: "Google Calendar, Outlook, Cal.com" },
  { icon: ICONS.users, tint: "bg-emerald-50 text-emerald-600", title: "CRM & Kunder", tools: "HubSpot, Salesforce, Pipedrive" },
  { icon: ICONS.chat, tint: "bg-sky-50 text-sky-600", title: "Kommunikation", tools: "WhatsApp, Slack, Discord, Messenger" },
  { icon: ICONS.document, tint: "bg-amber-50 text-amber-600", title: "Dokumenter", tools: "Notion, WordPress, Google Docs" },
  { icon: ICONS.cart, tint: "bg-rose-50 text-rose-600", title: "E-handel", tools: "Shopify, WooCommerce, Stripe" },
  { icon: ICONS.wrench, tint: "bg-violet-50 text-violet-600", title: "Automatisering", tools: "Zapier, Make, Webhooks, API" },
];

export function IntegrationsHero() {
  return (
    <div className="space-y-8 text-center">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-600">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3">
          <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Problemfri Integration
      </span>

      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Forbind med dine <span className="text-brand-600">eksisterende værktøjer</span>
        </h1>
        <p className="mx-auto max-w-2xl text-sm text-slate-600 sm:text-base">
          Vores AI-løsning automatiserer administration, opkald, SMS og email ved at arbejde sammen med de systemer I
          allerede bruger. Spar tid, bliv mere professionel, og lad AI&apos;en håndtere ombookinger, opfølgning og
          mødebekræftigelser automatisk.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 text-left sm:grid-cols-3">
        {HERO_FEATURES.map((feature) => (
          <div key={feature.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <IconBadge tint={feature.tint}>{feature.icon}</IconBadge>
            <p className="mt-3 text-sm font-semibold text-slate-900">{feature.title}</p>
            <p className="mt-1 text-xs text-slate-500">{feature.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function IntegrationCategories() {
  return (
    <div className="space-y-6 text-center">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Integration Kategorier</h2>
        <p className="mt-1 text-sm text-slate-500">Vores AI-løsning forbinder med de værktøjer I allerede bruger hver dag</p>
      </div>
      <div className="grid grid-cols-1 gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
        {CATEGORIES.map((category) => (
          <div key={category.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <IconBadge tint={category.tint}>{category.icon}</IconBadge>
            <p className="mt-3 text-sm font-semibold text-slate-900">{category.title}</p>
            <p className="mt-1 text-xs text-slate-500">{category.tools}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
