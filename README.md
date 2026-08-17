# AIbooking.dk — Backend SaaS Platform

Multi-tenant SaaS backend for AI voice widgets, built with Next.js (App Router,
API routes only), TypeScript, Supabase (Postgres + Auth + RLS), Anthropic
Claude, ElevenLabs, and Stripe. Optimized throughout for the lowest viable
infrastructure cost: no separate backend server, no Redis, no queues, no
containers — a modular monolith of serverless API routes.

This repository is the **backend**. It is ready to be consumed by a separate
admin dashboard, customer dashboard, and the production voice widget UI.

## Architecture

```
Master Admin
  └─ Customers
       └─ Widgets (LLM + voice configuration)
            └─ Conversations
                 └─ Usage sessions / Credit ledger
```

- **Tenant isolation** is enforced twice: Postgres Row Level Security (every
  table, keyed off `profiles.customer_id`) as the database-level guarantee,
  and explicit `customer_id` scoping in every `lib/*` query as
  defense-in-depth for the service-role code paths that intentionally bypass
  RLS (webhooks, widget/public routes, admin routes).
- **Credits are an append-only ledger** (`credit_transactions`), never a
  mutable counter. Balance = `SUM(amount_seconds)`, cached on
  `credit_accounts` and only ever updated atomically inside the
  `record_credit_transaction()` Postgres function (service-role only).
- **LLM and TTS are behind provider abstractions** (`lib/llm`, `lib/tts`) so
  Anthropic/ElevenLabs are swappable later without touching call sites.
  Available models/voices live in the `llm_models` / `voice_models` tables —
  nothing is hardcoded in the frontend.
- **Any widget can optionally be backed by a real Vapi assistant** instead
  of (or in addition to) the custom pipeline above — see "Vapi voice
  agents" below. This is additive: a widget only calls into Vapi once its
  `vapi_assistant_id` is set, so every widget created before this existed
  keeps working through the original pipeline unchanged.
- **Cost control is architectural, not an afterthought**: conversation
  context sent to Claude is capped to a rolling window of recent messages
  plus a running summary (`lib/llm/context-builder.ts`), response length is
  capped per-widget, and TTS input is hard-capped in `lib/tts` regardless of
  what the LLM produced.
- **Pricing is fully admin-configurable** (`packages` table) — the 999
  DKK / 150 minute plan is seed data, not a hardcoded constant.

## Code layout

```
app/api/admin/*      Master admin endpoints (customers, widgets, usage, settings, credits, stats)
app/api/customer/*    Customer-facing endpoints, scoped to the caller's own customer_id
app/api/customer/widgets/[id]/vapi  Create/update/delete the widget's Vapi assistant (see below)
app/api/widget/*      Public, unauthenticated endpoints the embedded widget calls
app/api/billing/*     Stripe checkout / billing portal
app/api/webhooks/*    Stripe webhook + Vapi webhook (both idempotent)
app/widget/[publicId] Server-rendered share page for a widget's public link
public/widget.js      The embeddable <script> loader (no API keys, ever)

lib/database   Supabase clients (admin/service-role, server/RLS-bound, browser)
lib/auth       Session resolution + role guards (requireMasterAdmin, requireCustomerAccess, ...)
lib/llm        LLMProvider abstraction, Anthropic implementation, context/summary builder, cost estimation
lib/tts        TTSProvider abstraction, ElevenLabs implementation, cost estimation
lib/vapi       Vapi assistant create/update/delete, prompt templates, webhook handling, embed snippet builder
lib/credits    Append-only ledger, balance reads, automatic overage refill
lib/billing    Stripe client, checkout/portal sessions, subscription sync from webhooks
lib/usage      Usage session tracking (second-level precision) + per-request api_usage cost tracking
lib/widgets    Public ID generation, embed snippet, public-safe config projection, supported languages
lib/customers  Admin "create customer" onboarding orchestration
lib/analytics  Per-customer economics + system-wide admin dashboard stats
lib/security   Rate limiting, zod schemas, request size limits, audit logging, error handling
lib/settings   Admin-configurable platform defaults (e.g. default system prompt)
lib/conversation  Orchestrates one voice-widget turn: LLM → TTS → usage/cost recording

types/database.ts  Hand-written row types mirroring supabase/migrations/*.sql
types/errors.ts    Typed ApiError with status/code, used by every route

supabase/migrations/*.sql  Schema, RLS policies, Postgres functions, seed data
scripts/create-master-admin.mjs  One-time, non-HTTP MASTER_ADMIN bootstrap
tests/  Vitest unit tests (credit ledger math, tenant isolation guards, Stripe/Vapi webhook handling, input validation, cost/context-window logic)
```

## Vapi voice agents

Every "AI Agent" in the dashboard is a `widgets` row. A widget can
optionally be backed by a real [Vapi](https://vapi.ai) assistant — this is
what powers the Agent Studio's **Voice Agent** tab, the in-dashboard **Test
Agent** voice test, and the Vapi embed snippet on the **Embed Code** tab.
It's entirely additive: a widget only talks to Vapi once it has a
`vapi_assistant_id`; every widget without one keeps using the original
custom Anthropic+ElevenLabs pipeline described above, unchanged.

**1. Create a Vapi account and get your keys**

1. Sign up at [vapi.ai](https://vapi.ai) and open your dashboard.
2. Go to **API Keys**. Copy the **Private Key** into `VAPI_API_KEY` — this
   must only ever live server-side (Vercel project env vars), never in
   client code or git.
3. Copy the **Public Key** into `VAPI_PUBLIC_KEY` — this one is safe to
   reach the browser (it's what the embeddable widget and the in-dashboard
   test call use) but is still only read server-side in this app and
   threaded down as a prop/response field, never inlined into a bundle via
   a `NEXT_PUBLIC_` var.
4. Optionally set `VAPI_WEBHOOK_SECRET` to any random string. Vapi's
   assistant config has no built-in signature/secret field, so this app
   verifies webhook deliveries itself: it automatically appends
   `?secret=...` to the webhook URL it registers on each assistant it
   creates/updates (`lib/vapi/mapping.ts`), and `POST /api/webhooks/vapi`
   checks it on the way in. Leaving it blank accepts deliveries
   unverified — fine for local development, set it in production.

**2. Webhook URL** — nothing to configure manually. This app sets
`assistant.server.url` to `{NEXT_PUBLIC_APP_URL}/api/webhooks/vapi[?secret=...]`
automatically every time an assistant is created or updated from the Voice
Agent tab, so `NEXT_PUBLIC_APP_URL` must be your real deployed URL (not
`localhost`) once you're ready to receive live call events.

**3. Using it** — from the Agent Studio's **Voice Agent** tab: fill in the
business info, pick a model and voice, and click "Create voice agent" (or
"Update voice agent" once one exists — this always updates the same Vapi
assistant by its stored `vapi_assistant_id`, never creates a second one).
Then:
- **Test Agent** tab: place a real voice call to it from the browser via
  the official `@vapi-ai/web` SDK.
- **Embed Code** tab: copy the ready-made `<vapi-widget>` snippet
  (`@vapi-ai/client-sdk-react`'s widget bundle) — it only ever contains the
  public key and your own assistant id, never `VAPI_API_KEY`.

Call metadata (status, duration, cost, transcript, summary, recording URL)
reported by Vapi's webhooks is stored in the `vapi_calls` table, scoped by
RLS the same way every other table in this app is.

## Getting started

1. Create a Supabase project and run the migrations in
   `supabase/migrations/` in order (via the Supabase SQL editor, or
   `supabase db push` if you use the Supabase CLI).
2. Copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
   - `VAPI_API_KEY`, `VAPI_PUBLIC_KEY`, `VAPI_WEBHOOK_SECRET` (optional —
     see "Vapi voice agents" below)
   - `NEXT_PUBLIC_APP_URL`
3. Update the seeded `voice_models` rows with real ElevenLabs voice IDs
   (`provider_voice_id`), and the seeded `packages` row with a real
   `stripe_price_id`, via the admin API once you're up and running (or
   directly in Supabase for the very first setup).
4. Bootstrap the first Master Admin (there is deliberately no HTTP endpoint
   for this — see spec section 28):
   ```
   MASTER_ADMIN_EMAIL=you@aibooking.dk MASTER_ADMIN_PASSWORD=... npm run create-master-admin
   ```
5. `npm install && npm run dev`

## Scripts

- `npm run dev` / `npm run build` / `npm run start`
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint
- `npm test` — Vitest (unit tests, no live services required)
- `npm run create-master-admin` — one-time admin bootstrap (see above)

## What's implemented vs. deferred

**Implemented**: the full data model + RLS, admin and customer APIs for
everything in the acceptance criteria (create customer → widget → pick
Claude model → pick Danish voice → set system prompt → invite customer →
customer edits widget/voice/prompt/design → conversations/usage/billing →
embed code), the end-to-end voice-widget turn (Claude reply → ElevenLabs
audio → usage/cost recorded → credits deducted), the credit ledger with
automatic overage refill, Stripe subscription sync + webhook idempotency,
and a working (text-input, audio-output) embeddable widget.

Also implemented: optional Vapi-backed voice/chat agents per widget (create/
update/delete a real Vapi assistant, in-dashboard voice test via
`@vapi-ai/web`, an official `<vapi-widget>` embed snippet, and a Vapi
webhook that records call metadata into `vapi_calls`) — see "Vapi voice
agents" above.

**Deliberately deferred** (per spec section 33 — MVP scope, and because this
task is backend-only): the admin/customer dashboard UIs, real end-user
speech-to-text in the custom-pipeline widget (it currently takes typed
input and plays back synthesized voice replies — swapping in the browser's
`SpeechRecognition` API or a hosted STT provider is a frontend-only change
against the existing `/api/widget/message` contract; Vapi-backed agents
don't have this limitation, since Vapi handles STT itself), and real
booking/calendar/CRM/email/lead-capture/human-transfer behavior — the
Voice Agent tab's capability toggles for these are wired up and persisted
so they can be switched on without further UI work once the underlying
integrations exist, but none of them changes assistant behavior yet (see
`lib/vapi/types.ts#IMPLEMENTED_CAPABILITIES`). `widget_settings.extra`
(jsonb) exists specifically so features like this can be added later
without a schema migration.

**Known follow-up**: Next.js is pinned to the latest 14.2.x patch; a major
version upgrade (15/16) was intentionally left out of this change to avoid
scope creep, but should be scheduled separately.
