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
   - `OPENAI_API_KEY` ("Expert model" — OpenAI Realtime API over WebRTC)
   - `VAPI_PUBLIC_KEY`, `VAPI_WEBHOOK_SECRET`, `VAPI_PRIVATE_KEY` ("Claude"
     agents — Vapi Web SDK, assistants auto-provisioned via the Vapi API)
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (optional — platform Twilio
     master account used to sell DK numbers through Inbound, included free
     in a paid package; the BYO-Twilio import path works without these)
   - `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and
     `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET` (optional — Google
     Calendar and Outlook/Microsoft 365 connect buttons under Integrations;
     Cal.com needs no platform credentials, it's API-key based)
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
   - `NEXT_PUBLIC_APP_URL`
3. Update the seeded `voice_models` rows with real ElevenLabs voice IDs
   (`provider_voice_id`), and the seeded `packages` row with a real
   `stripe_price_id`, via the admin API once you're up and running (or
   directly in Supabase for the very first setup). New agents provision
   their own Vapi assistant automatically (see
   `app/api/customer/widgets/route.ts` and `lib/vapi/assistants.ts`); set
   `widget_settings.extra.vapiAssistantId` manually only to point a widget
   at a different, hand-configured assistant.
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

Also implemented: a step-by-step "Kom i gang" wizard
(`/dashboard/getting-started`) tying the whole setup together; inbound
calling via a Vapi phone number, either bought through the platform (see
"Phone number marketplace" below) or a customer's own BYO-Twilio number
(existing import route), plus in-app call-forwarding instructions
(`components/dashboard/call-forwarding-instructions.tsx`) for diverting an
existing DK number to it; and calendar connect/disconnect for Google
Calendar, Outlook/Microsoft 365 (OAuth, `lib/calendar`), and Cal.com (API
key) at `/dashboard/integrations`, storing connections in
`calendar_connections` (0014_calendar_integrations.sql).

### Trial and billing

New self-signups get a 5-minute free trial for 7 days (`lib/billing/trial.ts`)
— voice and widget usage draw from the same shared credit pool, so there's
no separate "widget minutes" vs. "voice minutes" to reconcile. The trial
ends the moment either limit is hit (7 days pass, or the 5 minutes are
used), at which point generating the embed code requires an active
subscription. Packages (`packages` table, updated in
0018_package_pricing_update.sql) match aibooking.dk's pricing: Starter
(999 DKK/md, 200 min, 1998 DKK setup), Professional (2499 DKK/md, 600 min,
4998 DKK setup), Enterprise (5999 DKK/md, 2000 min, 11998 DKK setup) — the
"Demo" tier on the marketing site is the trial above, not a purchasable
package row. Checkout (`lib/billing/checkout.ts`) bills the one-time setup
fee alongside the first invoice (no pre-created Stripe Price needed for
that part) and pins the recurring charge to the 1st of the month via
`billing_cycle_anchor`. Unused minutes roll over, capped at 3 months' worth
of the package's included minutes — the excess is expired on each renewal
(`grantCreditsForPaidInvoice`) rather than accumulating indefinitely.
`/dashboard/billing` (previously missing entirely, despite checkout's
`success_url` already pointing at it) shows the current plan, balance, and
trial countdown, and is where "Administrer betaling / opsig abonnement"
opens the Stripe billing portal.

**Intro offer (499 kr / 30 days, then 999 kr/md)**: `/dashboard/inbound/free-trial`
pitches a real, paid Stripe subscription rather than a free-access bypass —
`POST /api/billing/intro-offer` checks out the default package with a
one-time 50%-off coupon on the first invoice (`getOrCreateIntroOfferCoupon`
in `lib/billing/checkout.ts`, a get-or-create against a fixed Stripe coupon
id so it's only ever created once). Gated to genuinely new customers: 409s
if `customers.intro_offer_used_at` is already set, or if the customer has
any `subscriptions` row at all. On successful checkout, `success_url`
redirects to `/dashboard/inbound?openTrial=1`, which auto-opens the
BYO-Twilio connect popup (`components/dashboard/inbound-manager.tsx`) so
the customer lands straight in "now forward your number" instead of back
on a generic billing page. `intro_offer_used_at` itself is stamped by the
Stripe webhook (`syncSubscriptionFromStripe` in
`lib/billing/subscription-sync.ts`), keyed off a
`aibooking_intro_offer: 'true'` subscription metadata flag — not at
checkout-session-creation time, so an abandoned checkout doesn't burn the
customer's one shot at the offer. Once redeemed, access comes from the
real subscription's `active` status like any other paid customer — no
separate trial-access bypass in `hasEmbedCodeAccess` needed.

### Twilio-direct voice (Claude, no Vapi)

A second voice/phone architecture alongside Vapi, for the `provider='anthropic'`
model (create-flow label "Claude (Twilio telefon + widget)") — reuses the
existing Claude + ElevenLabs pipeline (`lib/conversation/handle-turn.ts`,
already what the web widget's text mode runs) for **both** channels:

- **Web widget**: unchanged — already "text" mode, Claude generates the
  reply, ElevenLabs speaks it. The one addition is a mic button
  (`public/widget.js`'s `buildMicButton`) using the browser's own
  `SpeechRecognition` API to dictate instead of type — no new backend, no
  new provider dependency, and it degrades to "no mic button" wherever the
  browser doesn't support it (Firefox, notably).
- **Phone (inbound/outbound)**: turn-based over Twilio's built-in speech
  recognition and TwiML, **not** real-time Media Streams — deliberately:
  streaming would need a persistent WebSocket server, which doesn't run on
  serverless/Vercel and is a materially bigger project (that's effectively
  what Vapi already does as a service). The tradeoff is latency (a couple
  of seconds per turn, Twilio transcribes → we call Claude → ElevenLabs
  synthesizes → Twilio plays it) in exchange for staying entirely within
  the existing serverless architecture. See `lib/telephony/` and
  `app/api/telephony/twilio/voice/{inbound,turn,outbound-start,status}` —
  a phone call is created as a `conversations` row
  (`channel='phone'`, `twilio_call_sid`) and a `usage_sessions` row exactly
  like a widget session, so it bills through the same credit ledger with no
  separate accounting path.

BYO-Twilio numbers work for this model too (0021_byo_twilio_direct.sql):
platform-purchased numbers validate against the customer's Twilio subaccount
(`lib/twilio/subaccounts.ts`) same as before, but a BYO number has no
subaccount to fall back to, so its own customer-supplied credentials are
stored directly on the `phone_numbers` row instead
(`twilio_account_sid`/`twilio_auth_token`) — `lib/telephony/resolve.ts`
branches on `source` to pick the right ones. `findIncomingPhoneNumberSid`
(`lib/twilio/numbers.ts`) looks up the number's Twilio SID at import time,
since `configureDirectVoiceWebhook` needs that, not the E.164 string.

**Known limitations**: `<Play>` audio URLs are protected only by an
unguessable message UUID, not a Twilio-signed fetch (Twilio doesn't sign
media fetches). No dedicated call-log row is created yet for these calls
(the existing Conversations list already shows them; Vapi calls
additionally get a `phone_calls` row via the Vapi webhook, this path
doesn't yet).

### Agent type: Voice Widget vs Telefon (Inbound/Outbound)

Creating an agent (`agent-creation-wizard.tsx`) no longer asks the customer
to pick a "model" — it asks what the agent is *for*, and assigns the right
model automatically: **Voice Widget** → the Vapi model (real-time voice in
the browser, `provider='vapi'`); **Telefon (Inbound/Outbound)** → the
Twilio-direct model (`provider='anthropic'`, see above). This is a
one-time choice baked into `llm_model_id` at creation — there's no
"agent type" column of its own, every downstream check (phone import,
Configure Agent's tabs) just reads the provider off the widget's model.

The wizard's final step and Configure Agent's tab bar
(`agent-configurator.tsx`) both branch on it: a Widget agent gets
"Customise Widget" + "Embed Code" same as before; a Telefon agent gets
neither (no website embed to speak of) and a "Telefonnummer" tab instead
(`wizard-phone-step.tsx`, shared by both the wizard and Configure Agent),
which hands off to the Inbound page — where the BYO/purchase flow above
takes over — rather than duplicating that flow a third time.

### Cal.com integration and AI booking

Cal.com connects with a pasted API key (`lib/calendar/calcom.ts`,
`app/api/customer/calendar/calcom/route.ts`) — no OAuth round-trip.
Connecting now runs the full setup the spec calls for: `fetchCalcomMe`
doubles as the "test authentication" step, `fetchCalcomEventTypes` lists
Event Types so the customer picks which one the agent books against, and
the key itself is AES-256-GCM encrypted before it's ever written to
`calendar_connections.calcom_api_key` (`lib/security/crypto.ts`,
`CALENDAR_CREDENTIALS_ENCRYPTION_KEY` — required, not optional, to connect
Cal.com at all). Nothing selects that ciphertext column back into a
client-facing response anywhere; every server-side caller decrypts it
just-in-time for one Cal.com API call. The dashboard's connected-state card
(`calendar-integrations-manager.tsx`) shows status/account/timezone and a
"Test forbindelse" button (`POST /api/customer/calendar/[id]/test`,
re-runs `fetchCalcomMe`), and a dropdown to change the Event Type
(`PATCH /api/customer/calendar/[id]`) without disconnecting. Setting up
Cal.com is also a step in the agent creation wizard now
(`wizard-calendar-step.tsx`), not only reachable from the separate
Integrations page.

**AI booking loop**: a connected, `status='connected'` Cal.com calendar
makes the AI's replies run through a tool-use loop instead of a plain
completion (`lib/conversation/calendar-tools.ts`,
`generateReplyWithCalendarTools`) — two tools, `check_availability` and
`book_meeting`, backed by `fetchCalcomAvailability`/`createCalcomBooking`.
`handle-turn.ts` looks the connection up per turn and only takes this path
for `provider='anthropic'` widgets (tool-use is called directly against the
Anthropic SDK, not through the generic `LLMProvider` interface — see that
file's module comment for why); a successful or failed `book_meeting` call
writes a row to `appointments` (`status: 'booked' | 'failed'`), matching
the diagrammed flow: AI → backend → Cal.com API → availability → lead picks
a time → Cal.com API → booking created → booking id → Supabase → AI
confirms. Token usage across every call in the loop is summed and recorded
once, so billing in `handle-turn.ts` needed no changes.

**Known limitation / please verify**: the Cal.com v1 API's `/slots` and
`/bookings` request/response shapes in `lib/calendar/calcom.ts` are
implemented from documented API knowledge, not tested against a live
Cal.com account — this sandbox has no way to call out to Cal.com. Test
`check_availability`/`book_meeting` against a real Cal.com event type
before relying on this in production; `/me` and `/event-types` (used by
the connect/test flow) are more likely correct since they're simpler and
more stable endpoints.

### Phone number marketplace ("buy a number through us")

A customer never touches Twilio Console. The flow:

1. **Subaccount** (`lib/twilio/subaccounts.ts`, `twilio_subaccounts` table,
   0016_twilio_subaccounts.sql): the first time a customer searches or buys
   a number, we lazily create a Twilio *subaccount* for them under the
   platform's master account (`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`).
   Every subsequent search/purchase/release for that customer runs under
   their own subaccount credentials — full blast-radius isolation between
   customers, and a natural place to suspend/close one customer's telephony
   without touching anyone else's. Idempotent and race-safe (see
   `getOrCreateSubaccount` and its test in `tests/twilio-subaccounts.test.ts`).
2. **Search**: `GET /api/customer/phone-numbers/search` — Danish
   voice-enabled local numbers via Twilio's `AvailablePhoneNumbers` API,
   rate-limited.
3. **Purchase**: numbers bought through us are included free in a paid
   package (no per-number Stripe charge) — `POST
   /api/customer/phone-numbers/purchase` requires an active subscription,
   then provisions synchronously: buys the number from Twilio (under the
   customer's subaccount) and either imports it into Vapi or points it at
   our own Twilio-direct webhooks (see "Twilio-direct voice" above),
   depending on the agent's model, ending at `active` or `failed` (with
   `failure_reason` recorded).
4. **Retry/release**: `POST /api/customer/phone-numbers/[id]/retry`
   re-attempts a `failed` provisioning (no new charge); `DELETE
   .../[id]` releases an active number back to Twilio and marks it
   `released` (kept, not deleted, so history survives). Master admin has the
   same actions at `/admin/phone-numbers` for support use, plus a
   cross-customer view.
5. **Direction**: every number (bought or BYO) has `direction` —
   `inbound`, `outbound`, or `both` — enforced when launching an outbound
   campaign against it (`app/api/customer/outbound-campaigns/*`).

**Known limitations / follow-ups**, called out explicitly rather than
silently:
- No cap yet on how many free numbers a customer can buy — the number
  itself is free to the customer, but Twilio still rents it to us, so an
  unbounded quantity is a real cost-abuse surface. Worth a per-package
  included-quantity limit before this goes to production traffic.
- A failed retry re-attempts buying the *same* number the customer
  originally picked; if it's gone (sniped by another buyer in the
  meantime), retry fails again with a clear reason and the customer needs
  to start a fresh purchase for a different number — there's no
  automatic "pick another available number" fallback yet.
- Danish numbers bought through Twilio are subject to Twilio's regulatory
  requirements for the destination country (which can include address/
  identity or a Regulatory Bundle depending on number type). This isn't
  currently surfaced in the UI or enforced before purchase — a purchase
  that fails for a compliance reason on Twilio's side lands in
  `purchase_status='failed'` with Twilio's error as `failure_reason`, same
  as any other provisioning failure. Building a proper "this number needs
  extra documentation" flow (regulatory bundle collection tied to the
  customer/subaccount) is a deliberate follow-up, not attempted here.
- Reassigning a purchased number to a different agent, and inbound call
  routing based on `direction`/`assigned` agent, both already exist
  structurally (`widget_id` on `phone_numbers`, Vapi assistant per widget)
  but there's no dedicated "reassign" UI yet — editing requires releasing
  and re-buying.

**Deliberately deferred** (per spec section 33 — MVP scope, and because this
task is backend-only): the admin dashboard UI beyond what's listed above,
real end-user speech-to-text in the widget (the widget currently takes
typed input and plays back synthesized voice replies — swapping in the
browser's `SpeechRecognition` API or a hosted STT provider is a
frontend-only change against the existing `/api/widget/message` contract),
CRM integrations, a knowledge-base/RAG layer, and actually reading/writing
calendar events during a live call — the calendar connections above are
wired for that (tokens + event type stored) but nothing in the conversation
pipeline calls out to Google/Outlook/Cal.com yet, same "connected but not
consumed" status the `appointments` table has had since
0010_appointments.sql. `widget_settings.extra` (jsonb) exists specifically
so further additions like this can land without a schema migration.

**Known follow-up**: Next.js is pinned to the latest 14.2.x patch; a major
version upgrade (15/16) was intentionally left out of this change to avoid
scope creep, but should be scheduled separately.
