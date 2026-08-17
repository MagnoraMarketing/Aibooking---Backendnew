import { z } from "zod";

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
  language: z.enum(["da", "en"]).default("da"),
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
  // Business info + Vapi widget-mode/theme — plain widgets columns, shared
  // by the Voice Agent tab and (for widgetMode/widgetTheme) Customize Widget.
  businessDescription: z.string().trim().max(2000).optional().nullable(),
  businessPhone: z.string().trim().max(50).optional().nullable(),
  businessEmail: z.string().trim().email().max(320).optional().nullable(),
  websiteUrl: z.string().trim().url().max(2000).optional().nullable(),
  widgetMode: z.enum(["voice", "chat", "both"]).optional(),
  widgetTheme: z.enum(["light", "dark"]).optional(),
});

export const createWidgetSchema = widgetUpdateSchema.extend({
  name: z.string().trim().min(1).max(200).default("Main widget"),
});

// ---------------------------------------------------------------------------
// Vapi voice agent (Agent Studio > Voice Agent tab)
// ---------------------------------------------------------------------------
export const agentCapabilitiesSchema = z
  .object({
    answerQuestions: z.boolean(),
    collectContactInfo: z.boolean(),
    bookAppointments: z.boolean(),
    cancelAppointments: z.boolean(),
    rescheduleAppointments: z.boolean(),
    sendEmail: z.boolean(),
    transferToHuman: z.boolean(),
    captureLeads: z.boolean(),
  })
  .partial();

// POST /api/customer/widgets/[id]/vapi — creates or syncs the Vapi assistant
// for this widget. Business-info/mode fields are persisted to the widgets
// row (same as a widgetUpdateSchema PATCH) before the Vapi assistant is
// built from the widget's current full config, so this is the single call
// the "Create Agent" / "Update Agent" button makes.
export const vapiSyncSchema = z.object({
  businessDescription: z.string().trim().max(2000).optional().nullable(),
  businessPhone: z.string().trim().max(50).optional().nullable(),
  businessEmail: z.string().trim().email().max(320).optional().nullable(),
  websiteUrl: z.string().trim().url().max(2000).optional().nullable(),
  voiceProvider: z.string().trim().min(1).max(50).optional(),
  voiceId: z.string().trim().min(1).max(200).optional(),
  llmProvider: z.enum(["openai", "anthropic"]).optional(),
  llmModel: z.string().trim().min(1).max(100).optional(),
  widgetMode: z.enum(["voice", "chat", "both"]).optional(),
  capabilities: agentCapabilitiesSchema.optional(),
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
  })
  .partial();

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

export const widgetMessageSchema = z.object({
  sessionId: z.string().uuid(),
  conversationId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000),
  clientDurationSeconds: z.number().nonnegative().max(600).optional(),
});

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------
export const checkoutRequestSchema = z.object({
  packageId: z.string().uuid().optional(),
});
