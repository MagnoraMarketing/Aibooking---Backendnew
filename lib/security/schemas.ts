import { z } from "zod";
import { LOCALES } from "@/lib/i18n/locales";

// ---------------------------------------------------------------------------
// Admin: customers
// ---------------------------------------------------------------------------
export const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  packageId: z.string().uuid().optional(),
  llmModelId: z.string().uuid().optional(),
  voiceModelId: z.string().uuid().optional(),
  businessName: z.string().trim().max(200).optional(),
  sendInvitation: z.boolean().optional().default(true),
  // Who sold this customer, e.g. a salesperson's name — shown in the client
  // portal so Master Admin can see who to attribute a customer to.
  reference: z.string().trim().max(200).optional(),
});

// ---------------------------------------------------------------------------
// Public: self-service signup
// ---------------------------------------------------------------------------
export const signupSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  // Optional: it only exists so someone can ring a new customer and welcome
  // them (see lib/email/internal-notifications.ts). Deliberately unvalidated
  // beyond a length cap — country prefixes, spaces and parentheses are all
  // legitimate, and a rejected signup costs far more than a messy number.
  phone: z.string().trim().max(40).optional(),
  password: z.string().min(8).max(200),
  language: z.enum(LOCALES).default("da"),
});

// ---------------------------------------------------------------------------
// Profile: Dashboard/Admin UI language (see lib/i18n) — every signed-in
// user, either role, can change their own.
// ---------------------------------------------------------------------------
export const profileLanguageInputSchema = z.object({
  language: z.enum(LOCALES),
});

export const updateCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().max(320).optional(),
  status: z.enum(["active", "inactive", "deleted"]).optional(),
  reference: z.string().trim().max(200).optional().nullable(),
});

// ---------------------------------------------------------------------------
// Admin: credits
// ---------------------------------------------------------------------------
export const manualCreditAdjustmentSchema = z.object({
  customerId: z.string().uuid(),
  minutes: z.number().finite().refine((v) => v !== 0, "minutes must not be zero"),
  description: z.string().trim().min(1).max(500),
});

// ---------------------------------------------------------------------------
// Admin: pricing / packages
// ---------------------------------------------------------------------------
export const packageInputSchema = z.object({
  packageName: z.string().trim().min(1).max(100),
  monthlyPrice: z.number().nonnegative(),
  currency: z.string().trim().length(3).default("DKK"),
  includedMinutes: z.number().int().positive(),
  overagePricePerMinute: z.number().nonnegative().default(0),
  setupFee: z.number().nonnegative().optional().nullable(),
  renewalType: z.enum(["automatic", "manual"]).default("automatic"),
  stripePriceId: z.string().trim().optional().nullable(),
  active: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

export const packageUpdateSchema = packageInputSchema.partial();

// ---------------------------------------------------------------------------
// Admin: LLM / voice model catalog
// ---------------------------------------------------------------------------
export const llmModelInputSchema = z.object({
  provider: z.string().trim().min(1).max(50).default("anthropic"),
  modelName: z.string().trim().min(1).max(100),
  displayName: z.string().trim().min(1).max(150),
  inputPricePerMillion: z.number().nonnegative(),
  outputPricePerMillion: z.number().nonnegative(),
  maxTokens: z.number().int().positive().max(8192).default(1024),
  active: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  showInCreateFlow: z.boolean().default(false),
});

export const llmModelUpdateSchema = llmModelInputSchema.partial();

export const voiceModelInputSchema = z.object({
  provider: z.string().trim().min(1).max(50).default("elevenlabs"),
  providerVoiceId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  language: z.string().trim().min(2).max(10).default("da"),
  gender: z.string().trim().max(20).optional().nullable(),
  active: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

export const voiceModelUpdateSchema = voiceModelInputSchema.partial();

// ---------------------------------------------------------------------------
// Widgets (shared by admin + customer widget-editing endpoints)
// ---------------------------------------------------------------------------
export const widgetUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["active", "paused"]).optional(),
  businessName: z.string().trim().max(200).optional().nullable(),
  llmModelId: z.string().uuid().optional().nullable(),
  voiceModelId: z.string().uuid().optional().nullable(),
  language: z.string().trim().min(2).max(10).optional(),
  systemPrompt: z.string().trim().max(8000).optional().nullable(),
  welcomeMessage: z.string().trim().max(500).optional().nullable(),
  openingMessage: z.string().trim().max(500).optional().nullable(),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  secondaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  logoUrl: z.string().trim().url().max(2000).optional().nullable(),
  avatarUrl: z.string().trim().url().max(2000).optional().nullable(),
  position: z.enum(["bottom-right", "bottom-left", "top-right", "top-left"]).optional(),
  widgetSize: z.enum(["small", "medium", "large"]).optional(),
  showBranding: z.boolean().optional(),
  maxResponseChars: z.number().int().min(50).max(2000).optional(),
});

// Asking Vapi for an inbound number (app/api/customer/phone-numbers/vapi).
// The area code is optional and US-only — Vapi picks one itself when it is
// left out, which is what the dashboard does.
export const vapiNumberInputSchema = z.object({
  widgetId: z.string().uuid(),
  label: z.string().trim().max(100).optional(),
  areaCode: z
    .string()
    .trim()
    .regex(/^\d{3}$/, "Områdenummeret skal være tre cifre")
    .optional(),
  // A number already in the platform's Vapi account, chosen from
  // /api/customer/phone-numbers/vapi/available. Given one, the route attaches
  // it rather than asking Vapi for a new one — which is the difference
  // between free and needing a card on file.
  vapiPhoneNumberId: z.string().trim().min(1).max(100).optional(),
});

export const createWidgetSchema = widgetUpdateSchema.extend({
  name: z.string().trim().min(1).max(200).default("Main widget"),
  // What the agent is, sent by the creation wizard. Defaults to "widget"
  // because that is what every caller that predates the field creates (see
  // 0036_agent_type.sql).
  agentType: z.enum(["widget", "phone"]).default("widget"),
});

// ---------------------------------------------------------------------------
// Admin Control Center: connecting a widget/inbound agent to a cached Wapi
// (Vapi) agent and/or an existing phone number, and where it's deployed —
// shared by the admin widgets and admin inbound routes (see
// lib/admin/widget-service.ts and 0043_admin_wapi_control_center.sql).
// ---------------------------------------------------------------------------
export const wapiAgentConnectionSchema = z
  .object({
    deploymentType: z.enum(["customer_website", "aibooking_website"]),
    // A row already in the local wapi_agents cache (the searchable
    // dropdown's normal path).
    wapiAgentId: z.string().uuid().nullable(),
    // The manual-entry fallback (spec: "Wapi Agent ID" typed by hand when
    // the agent isn't in the synced list yet) — a raw Vapi assistant id.
    wapiAgentExternalId: z.string().trim().min(1).max(200).nullable(),
    // An existing phone_numbers row (already in the platform's Vapi
    // account, unclaimed) to attach to this agent.
    phoneNumberId: z.string().uuid().nullable(),
    // Connects this agent's calendar straight from the admin creation/edit
    // modal, instead of making the customer paste the key themselves later
    // (see lib/admin/widget-service.ts's connectAdminCalcom). Cal.com shows
    // an API key exactly once, so this is only sent when an admin is
    // actually setting/replacing it — omitted (not null) leaves an existing
    // connection untouched.
    calcomApiKey: z.string().trim().min(1).max(500).nullable(),
    calcomEventTypeId: z.coerce.number().int().positive().nullable(),
  })
  .partial();

// Free-form widget preferences that don't have a dedicated widgets column —
// stored in widget_settings.extra (jsonb) and merged in on PATCH, never
// replaced wholesale, so unrelated keys set by other tabs survive.
export const widgetExtraSettingsSchema = z
  .object({
    tagline: z.string().trim().max(200).nullable(),
    isGlowing: z.boolean(),
    isTransparent: z.boolean(),
    transcriptionEnabled: z.boolean(),
    chatEnabled: z.boolean(),
    autostart: z.boolean(),
    muteOnMinimize: z.boolean(),
    muteOnTabChange: z.boolean(),
    showLeadForm: z.boolean(),
    agentMute: z.boolean(),
    // Vapi assistant id for widgets on the Vapi model (provider='vapi', see
    // 0011_vapi_model.sql) — configured per-widget since each customer's
    // assistant is a separate resource in Vapi, unlike the shared
    // llm_models row that just marks the widget as using Vapi at all.
    vapiAssistantId: z.string().trim().min(1).max(200).nullable(),
    // A second assistant, for outbound campaign calls only. Placing a call
    // is not the same conversation as answering one, so an agent may keep a
    // separate persona for it — written by hand in Vapi's own dashboard and
    // never synced over by us (see lib/vapi/assistant-owner.ts). Unset means
    // campaigns use the assistant that answers the phone.
    vapiOutboundAssistantId: z.string().trim().min(1).max(200).nullable(),
    // Which admin-configured Vapi voice template ("Mand"/"Dame") the
    // widget's own assistant clones its voice from — see
    // resolveVoiceConfig in lib/vapi/assistants.ts. The raw template ids
    // themselves are never sent to the customer-facing UI.
    voiceGender: z.enum(["male", "female"]).nullable(),
    // Call limits handed straight to the Vapi assistant. Bounds are Vapi's
    // own: below them the API rejects the assistant update, so validating
    // here turns a failed background sync into a form error the customer can
    // see and fix.
    silenceTimeoutSeconds: z.number().int().min(10).max(3600).nullable(),
    maxDurationSeconds: z.number().int().min(10).max(43200).nullable(),
    // What the customer typed into Prompt Lab's "om virksomheden" fields,
    // kept so the generated prompt can be regenerated or adjusted later
    // instead of the answers being thrown away the moment the draft lands
    // in the textarea (see agent-tabs/prompt-lab.tsx).
    promptInputs: z
      .object({
        businessDescription: z.string().trim().max(2000),
        keyServices: z.string().trim().max(2000),
        openingHours: z.string().trim().max(2000),
        otherNotes: z.string().trim().max(2000),
      })
      .partial()
      .nullable(),
    // Picked in the wizard's first step ("Navn & type"), before there's
    // anything else to go on — steers how the "Generér prompt" meta-
    // instruction is written (see metaSystemPrompt in
    // app/api/customer/widgets/[id]/generate-prompt/route.ts). Purely
    // advisory for the prompt text: booking/Shopify *tools* are still gated
    // by an actually-connected calendar/webshop (see
    // syncWidgetToVapiAssistant in lib/vapi/sync.ts), not by this choice.
    agentPurposes: z.array(z.enum(["booking", "shopify", "qa"])).nullable(),
    purposeNotes: z.string().trim().max(2000).nullable(),
  })
  .partial();

// .extend({...x.shape}) rather than .merge(x): with the zod version this
// project resolves to, .merge()'s inferred output type widened an
// already-`.default()`-backed required field (name) back to optional —
// .extend() with a plain shape object doesn't go through that path.
export const createAdminWidgetSchema = createWidgetSchema.extend({
  // Required for deploymentType "customer_website"; ignored (and resolved
  // server-side to the reserved internal customer) for "aibooking_website"
  // — see lib/admin/aibooking-customer.ts.
  customerId: z.string().uuid().optional(),
  ...wapiAgentConnectionSchema.shape,
});

export const updateAdminWidgetSchema = widgetUpdateSchema.extend({
  extra: widgetExtraSettingsSchema.optional(),
  ...wapiAgentConnectionSchema.shape,
});

// ---------------------------------------------------------------------------
// Admin: Vapi voice templates ("Mand"/"Dame") — see
// lib/settings/platform.ts's getVapiVoiceTemplateAssistantId.
// ---------------------------------------------------------------------------
export const vapiVoiceTemplatesInputSchema = z.object({
  maleAssistantId: z.string().trim().min(1).max(200).nullable().optional(),
  femaleAssistantId: z.string().trim().min(1).max(200).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Admin: Vapi prompt-drafting fallback assistant — see
// lib/settings/platform.ts's getVapiPromptDraftingAssistantId.
// ---------------------------------------------------------------------------
export const vapiPromptDraftingAssistantInputSchema = z.object({
  assistantId: z.string().trim().min(1).max(200).nullable(),
});

// ---------------------------------------------------------------------------
// Widget (public, end-user facing)
// ---------------------------------------------------------------------------
export const widgetSessionStartSchema = z.object({
  publicId: z.string().trim().min(1).max(64),
});

export const widgetSessionEndSchema = z.object({
  sessionId: z.string().uuid(),
  // Realtime (WebRTC) sessions never touch our server mid-call, so the
  // browser reports how long the call actually lasted when it ends —
  // unlike the text pipeline, where duration accrues turn-by-turn server-side.
  clientMeasuredDurationSeconds: z.number().nonnegative().max(7200).optional(),
});

// Prompt Lab's "Generér prompt" (see app/api/customer/widgets/[id]/generate-prompt) —
// a handful of plain-language business questions used to draft a system
// prompt, rather than requiring the customer to write one from scratch.
export const generatePromptInputSchema = z.object({
  businessDescription: z.string().trim().min(1).max(1000),
  keyServices: z.string().trim().max(1000).optional(),
  openingHours: z.string().trim().max(300).optional(),
  otherNotes: z.string().trim().max(1000).optional(),
});

// Knowledge base ingestion (see lib/knowledge-base) — PDF upload goes
// through multipart/form-data instead (see the knowledge-base route),
// since a base64-encoded file would blow past MAX_REQUEST_BODY_BYTES.
export const knowledgeBaseInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string().trim().min(1).max(50000),
    label: z.string().trim().min(1).max(200).optional(),
  }),
  z.object({
    type: z.literal("url"),
    url: z.string().trim().url().max(2000),
  }),
]);

// Phone calling (inbound + outbound) — see 0013_phone_calling.sql and
// lib/vapi/phone-numbers.ts, lib/vapi/calls.ts.
const E164_REGEX = /^\+[1-9]\d{6,14}$/;

export const listByoPhoneNumbersInputSchema = z.object({
  twilioAccountSid: z.string().trim().min(1).max(200),
  twilioAuthToken: z.string().trim().min(1).max(200),
});

export const importPhoneNumberInputSchema = z.object({
  widgetId: z.string().uuid(),
  twilioAccountSid: z.string().trim().min(1).max(200),
  twilioAuthToken: z.string().trim().min(1).max(200),
  twilioPhoneNumber: z.string().trim().regex(E164_REGEX, "Skal være i E.164-format, fx +4512345678"),
  label: z.string().trim().max(200).optional(),
  direction: z.enum(["inbound", "outbound", "both"]).default("both"),
});

// Capped at 100 contacts per campaign for v1 — launch fires one Vapi call
// per contact concurrently within a single request, and this keeps that
// bounded well under typical serverless function time limits.
// What a campaign may be told to do, beyond who to ring. Bounds match the
// database's own checks (0039_outbound_campaign_settings.sql) so a bad value
// is a form error rather than a constraint violation.
export const outboundCampaignSettingsSchema = z.object({
  // What this campaign is about, added to the agent's prompt for its calls
  // only — the agent that answers the phone is untouched.
  agentInstruction: z.string().trim().max(2000).nullable().optional(),
  callWindowStart: z
    .string()
    .trim()
    .regex(/^\d{2}:\d{2}$/, "Skal være et klokkeslæt, fx 09:00")
    .optional(),
  callWindowEnd: z
    .string()
    .trim()
    .regex(/^\d{2}:\d{2}$/, "Skal være et klokkeslæt, fx 17:00")
    .optional(),
  // ISO weekdays, Monday = 1.
  callDays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  callTimezone: z.string().trim().min(1).max(60).optional(),
  maxConcurrentCalls: z.number().int().min(1).max(10).optional(),
  maxAttempts: z.number().int().min(1).max(5).optional(),
  retryAfterMinutes: z.number().int().min(5).max(1440).optional(),
  // Left on a voicemail instead of a conversation. Empty = the agent's own
  // behaviour.
  voicemailMessage: z.string().trim().max(1000).nullable().optional(),
});

const campaignContactsSchema = z
  .array(
    z.object({
      phoneNumber: z.string().trim().regex(E164_REGEX, "Skal være i E.164-format, fx +4512345678"),
      name: z.string().trim().max(200).optional(),
      // A third column in the pasted list. Most lists will not have one, and
      // the agent never sees it — it is there so whoever reads the results
      // knows who "Jens Jensen" was.
      company: z.string().trim().max(200).optional(),
    })
  )
  .min(1)
  .max(100);

export const outboundCampaignInputSchema = outboundCampaignSettingsSchema
  .extend({
    widgetId: z.string().uuid(),
    phoneNumberId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    contacts: campaignContactsSchema.optional(),
    // Or: take the contacts from one of the customer's lead lists (the
    // dialer's CSV imports), with every extra column kept so the agent can
    // use it as {{variable}}.
    leadListId: z.string().uuid().optional(),
  })
  .refine((body) => Boolean(body.contacts?.length) !== Boolean(body.leadListId), {
    message: "Indsæt kontakter eller vælg en ringeliste.",
  });

// Pausing or resuming a running campaign (see the campaign's status route).
export const campaignStatusActionSchema = z.object({
  action: z.enum(["pause", "resume", "stop"]),
});

// Editing a campaign that has not been launched yet. Everything is optional
// — the form saves what changed — and a contact list, when sent, replaces
// the old one wholesale, which is what "rediger listen" means to the person
// looking at a textarea of numbers.
export const outboundCampaignUpdateSchema = outboundCampaignSettingsSchema.extend({
  widgetId: z.string().uuid().optional(),
  phoneNumberId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  contacts: campaignContactsSchema.optional(),
});

export const widgetMessageSchema = z.object({
  sessionId: z.string().uuid(),
  conversationId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000),
  clientDurationSeconds: z.number().nonnegative().max(600).optional(),
});

// Twilio ConversationRelay — see app/api/widget/relay-token,
// app/api/internal/conversation-relay/turn and /end.
export const widgetRelayTokenSchema = z.object({
  publicId: z.string().trim().min(1).max(64),
});

export const internalConversationRelayTurnSchema = z.object({
  widgetId: z.string().uuid(),
  customerId: z.string().uuid(),
  conversationId: z.string().uuid(),
  usageSessionId: z.string().uuid(),
  userText: z.string().trim().min(1).max(4000),
});

export const internalConversationRelayEndSchema = z.object({
  usageSessionId: z.string().uuid(),
  durationSeconds: z.number().nonnegative().max(7200),
});

// Calendar integrations (see 0014_calendar_integrations.sql and
// lib/calendar) — Google/Outlook connect via OAuth (widgetId passed as a
// query param, not a body), Cal.com connects with a pasted API key instead.
export const calendarOAuthConnectQuerySchema = z.object({
  widgetId: z.string().uuid(),
});

// Either a freshly pasted key, or another of the customer's agents whose
// Cal.com connection this one should share. Cal.com shows an API key exactly
// once, so a customer who connected their widget weeks ago cannot paste the
// same key again for their phone agent — the copy path is the only way to
// put two agents on one calendar without issuing a second key.
export const calcomConnectInputSchema = z
  .object({
    widgetId: z.string().uuid(),
    apiKey: z.string().trim().min(1).max(500).optional(),
    fromConnectionId: z.string().uuid().optional(),
    eventTypeId: z.number().int().positive().optional(),
  })
  .refine((body) => !!body.apiKey !== !!body.fromConnectionId, {
    message: "Angiv enten en API-nøgle eller en kalender at genbruge — ikke begge.",
  });

// Switching which Event Type an already-connected Cal.com account books
// against — see app/api/customer/calendar/[id]/route.ts's PATCH.
export const calcomUpdateEventTypeSchema = z.object({
  eventTypeId: z.number().int().positive(),
});

// Admin Control Center: "Hent event-typer" in the widget/inbound creation
// modal (app/api/admin/calendar/calcom/event-types/route.ts) — proves a
// pasted key works and lists what it can book against, read-only.
export const calcomEventTypesLookupSchema = z.object({
  apiKey: z.string().trim().min(1).max(500),
});

// Cal.com OAuth booking request
export const calcomOAuthBookingSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  startTime: z.string().datetime(),
  eventTypeId: z.coerce.number().int().positive(),
  notes: z.string().trim().max(1000).optional(),
});

// Cal.com availability query
export const calcomAvailabilityQuerySchema = z.object({
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  eventTypeId: z.coerce.number().int().positive().optional(),
});

// ---------------------------------------------------------------------------
// Phone numbers purchased through us (see 0015_platform_phone_numbers.sql
// and lib/twilio) — search available Danish Twilio numbers, then buy one.
// ---------------------------------------------------------------------------
export const searchPhoneNumbersQuerySchema = z.object({
  areaCode: z.string().trim().max(10).optional(),
});

export const phoneNumberDirectionSchema = z.enum(["inbound", "outbound", "both"]).default("both");

export const purchasePhoneNumberInputSchema = z.object({
  widgetId: z.string().uuid(),
  phoneNumber: z.string().trim().regex(E164_REGEX, "Skal være i E.164-format, fx +4512345678"),
  label: z.string().trim().max(200).optional(),
  direction: phoneNumberDirectionSchema,
});

// ---------------------------------------------------------------------------
// Manual dialer (see 0029_manual_dialer.sql, lib/twilio/dialer.ts) — a
// customer calling an uploaded lead list from the browser, as themselves.
// Capped generously higher than outboundCampaignInputSchema's 100: leads
// here are dialed one at a time by a human, not fired concurrently, so
// there's no per-request fan-out to bound — the practical limit is
// MAX_REQUEST_BODY_BYTES.
// ---------------------------------------------------------------------------
export const leadListInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  leads: z
    .array(
      z.object({
        phoneNumber: z.string().trim().regex(E164_REGEX, "Skal være i E.164-format, fx +4512345678"),
        name: z.string().trim().max(200).optional(),
        company: z.string().trim().max(200).optional(),
      })
    )
    .min(1)
    .max(500),
});

const LEAD_DISPOSITIONS = [
  "booked",
  "interested",
  "not_interested",
  "no_answer",
  "busy",
  "voicemail",
  "wrong_number",
  "call_back",
  "do_not_call",
  "other",
] as const;

// The call's result, a callback, a do-not-call, or an edit to the lead
// itself. Status is normally derived from the disposition on the server
// (see the lead route) — sent explicitly only by older clients.
export const leadUpdateSchema = z.object({
  status: z.enum(["pending", "calling", "called", "callback", "do_not_call"]).optional(),
  disposition: z.enum(LEAD_DISPOSITIONS).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  callSid: z.string().trim().max(100).nullable().optional(),
  // When to ring again. Required with a "call_back" disposition.
  callbackAt: z.string().datetime({ offset: true }).nullable().optional(),
  contactName: z.string().trim().max(200).nullable().optional(),
  company: z.string().trim().max(200).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional().or(z.literal("")),
  phoneNumber: z.string().trim().regex(E164_REGEX, "Skal være i E.164-format, fx +4512345678").optional(),
  customData: z.record(z.string().max(100), z.string().max(500)).optional(),
  // Move the lead to another of the customer's lists.
  listId: z.string().uuid().optional(),
});

const importedLeadSchema = z.object({
  // Raw, as typed or exported — normalized on the server with the chosen
  // default country, exactly as the preview did (lib/outbound/phone.ts).
  phone: z.string().trim().min(1).max(40),
  name: z.string().trim().max(200).nullable().optional(),
  company: z.string().trim().max(200).nullable().optional(),
  email: z.string().trim().max(320).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  customData: z.record(z.string().max(100), z.string().max(500)).optional(),
});

const phoneCountrySchema = z.enum(["DK", "NO", "SE", "DE", "GB", "US"]).default("DK");

// One chunk of a lead import (CSV or "add lead manually"). The browser sends
// big files in chunks of a few hundred rows so each request stays under
// MAX_REQUEST_BODY_BYTES; the first chunk may create the list.
export const leadImportSchema = z
  .object({
    listId: z.string().uuid().optional(),
    newListName: z.string().trim().min(1).max(200).optional(),
    defaultCountry: phoneCountrySchema,
    duplicateMode: z.enum(["skip", "import", "update"]).default("skip"),
    leads: z.array(importedLeadSchema).min(1).max(300),
  })
  .refine((body) => Boolean(body.listId) !== Boolean(body.newListName), {
    message: "Vælg en eksisterende liste eller giv den nye liste et navn.",
  });

// The preview's duplicate check against what is already stored.
export const leadDuplicateCheckSchema = z.object({
  listId: z.string().uuid().optional(),
  phones: z.array(z.string().trim().regex(E164_REGEX)).min(1).max(2000),
});

export const doNotCallInputSchema = z.object({
  phone: z.string().trim().min(1).max(40),
  defaultCountry: phoneCountrySchema,
  reason: z.string().trim().max(500).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------
export const checkoutRequestSchema = z.object({
  packageId: z.string().uuid().optional(),
  // Setup/onboarding is an optional one-time add-on (spec: "Der skal være
  // mulighed for at købe en valgfri opsætning") — never included unless the
  // customer explicitly checks it at checkout.
  includeSetup: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// Booking setup (see 0030_optional_booking.sql) — the customer asks for
// booking from the dashboard, our team does the Cal.com/calendar work and
// marks it done, which is what flips widgets.booking_enabled.
// ---------------------------------------------------------------------------
export const bookingSetupRequestInputSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
});

export const bookingSetupStatusSchema = z.enum(["pending", "in_progress", "completed", "cancelled"]);

export const updateBookingSetupRequestSchema = z.object({
  id: z.string().uuid(),
  status: bookingSetupStatusSchema,
  notes: z.string().trim().max(2000).optional(),
  assignedTo: z.string().uuid().nullish(),
});

// ---------------------------------------------------------------------------
// Shopify / webshop integration (see 0035_shopify_integration.sql and
// lib/shopify). One input, and it is not a credential: which shop the customer
// wants to authorize. The access token is never an input — it only ever
// arrives from Shopify's own token endpoint, server-side.
// ---------------------------------------------------------------------------
// Connecting a shop by pasting a custom-app Admin API token, for merchants
// whose platform has no Shopify app configured — the same shape Cal.com uses.
// The token is verified against Shopify before anything is stored, and is
// encrypted at rest; it is never read back out to the browser.
export const shopifyManualConnectSchema = z.object({
  shop: z.string().trim().min(1).max(255),
  accessToken: z.string().trim().min(10).max(500),
});

export const shopifyConnectQuerySchema = z.object({
  widgetId: z.string().uuid(),
  // Validated again as a real *.myshopify.com domain in lib/shopify/domain.ts
  // before it is ever put in a URL or sent a token — this bound is only here
  // to keep an absurd value out of the parser.
  shop: z.string().trim().min(1).max(255),
});
