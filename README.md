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
app/api/widget/*      Public, unauthenticated endpoints the embedded widget calls
app/api/billing/*     Stripe checkout / billing portal
app/api/webhooks/*    Stripe webhook (idempotent)
app/widget/[publicId] Server-rendered share page for a widget's public link
public/widget.js      The embeddable <script> loader (no API keys, ever)

lib/database   Supabase clients (admin/service-role, server/RLS-bound, browser)
lib/auth       Session resolution + role guards (requireMasterAdmin, requireCustomerAccess, ...)
lib/llm        LLMProvider abstraction, Anthropic implementation, context/summary builder, cost estimation
lib/tts        TTSProvider abstraction, ElevenLabs implementation, cost estimation
lib/credits    Append-only ledger, balance reads, automatic overage refill
lib/billing    Stripe client, checkout/portal sessions, subscription sync from webhooks
lib/usage      Usage session tracking (second-level precision) + per-request api_usage cost tracking
lib/widgets    Public ID generation, embed snippet, public-safe config projection
lib/customers  Admin "create customer" onboarding orchestration
lib/analytics  Per-customer economics + system-wide admin dashboard stats
lib/security   Rate limiting, zod schemas, request size limits, audit logging, error handling
lib/settings   Admin-configurable platform defaults (e.g. default system prompt)
lib/conversation  Orchestrates one voice-widget turn: LLM → TTS → usage/cost recording

types/database.ts  Hand-written row types mirroring supabase/migrations/*.sql
types/errors.ts    Typed ApiError with status/code, used by every route

supabase/migrations/*.sql  Schema, RLS policies, Postgres functions, seed data
scripts/create-master-admin.mjs  One-time, non-HTTP MASTER_ADMIN bootstrap
tests/  Vitest unit tests (credit ledger math, tenant isolation guards, Stripe webhook idempotency, input validation, cost/context-window logic)
```

## Getting started

1. Create a Supabase project and run the migrations in
   `supabase/migrations/` in order (via the Supabase SQL editor, or
   `supabase db push` if you use the Supabase CLI).
2. Copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
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

**Deliberately deferred** (per spec section 33 — MVP scope, and because this
task is backend-only): the admin/customer dashboard UIs, real end-user
speech-to-text in the widget (the widget currently takes typed input and
plays back synthesized voice replies — swapping in the browser's
`SpeechRecognition` API or a hosted STT provider is a frontend-only change
against the existing `/api/widget/message` contract), booking/calendar/CRM
integrations, and a knowledge-base/RAG layer. `widget_settings.extra`
(jsonb) exists specifically so those can be added later without a schema
migration.

**Known follow-up**: Next.js is pinned to the latest 14.2.x patch; a major
version upgrade (15/16) was intentionally left out of this change to avoid
scope creep, but should be scheduled separately.
