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
