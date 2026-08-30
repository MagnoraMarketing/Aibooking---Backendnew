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
});

// ---------------------------------------------------------------------------
// Public: self-service signup
// ---------------------------------------------------------------------------
export const signupSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
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

export const createWidgetSchema = widgetUpdateSchema.extend({
  name: z.string().trim().min(1).max(200).default("Main widget"),
});

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
    // Which admin-configured Vapi voice template ("Mand"/"Dame") the
    // widget's own assistant clones its voice from — see
    // resolveVoiceConfig in lib/vapi/assistants.ts. The raw template ids
    // themselves are never sent to the customer-facing UI.
    voiceGender: z.enum(["male", "female"]).nullable(),
  })
  .partial();

// ---------------------------------------------------------------------------
// Admin: Vapi voice templates ("Mand"/"Dame") — see
// lib/settings/platform.ts's getVapiVoiceTemplateAssistantId.
// ---------------------------------------------------------------------------
export const vapiVoiceTemplatesInputSchema = z.object({
  maleAssistantId: z.string().trim().min(1).max(200).nullable().optional(),
  femaleAssistantId: z.string().trim().min(1).max(200).nullable().optional(),
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
export const outboundCampaignInputSchema = z.object({
  widgetId: z.string().uuid(),
  phoneNumberId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  contacts: z
    .array(
      z.object({
        phoneNumber: z.string().trim().regex(E164_REGEX, "Skal være i E.164-format, fx +4512345678"),
        name: z.string().trim().max(200).optional(),
      })
    )
    .min(1)
    .max(100),
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

export const calcomConnectInputSchema = z.object({
  widgetId: z.string().uuid(),
  apiKey: z.string().trim().min(1).max(500),
  eventTypeId: z.number().int().positive().optional(),
});

// Switching which Event Type an already-connected Cal.com account books
// against — see app/api/customer/calendar/[id]/route.ts's PATCH.
export const calcomUpdateEventTypeSchema = z.object({
  eventTypeId: z.number().int().positive(),
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

export const leadUpdateSchema = z.object({
  status: z.enum(["pending", "calling", "called"]).optional(),
  disposition: z
    .enum(["booked", "interested", "not_interested", "no_answer", "voicemail", "wrong_number", "call_back"])
    .nullable()
    .optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  callSid: z.string().trim().max(100).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------
export const checkoutRequestSchema = z.object({
  packageId: z.string().uuid().optional(),
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
