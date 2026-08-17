import type { Widget, WidgetMode } from "@/types/database";

// Configurable agent capabilities (Agent Studio > Voice Agent tab). Stored
// in widget_settings.extra.capabilities (jsonb) — the same
// migration-free extension point the rest of widget_settings.extra already
// uses — because only "answerQuestions" is actually implemented today.
// Every other flag is a customer-facing toggle for *future* functionality;
// none of them currently changes what the assistant can do. Do not wire a
// flag to real behavior in lib/vapi/mapping.ts until the feature behind it
// actually exists — flip capabilities on capability, not on hope.
export interface AgentCapabilities {
  answerQuestions: boolean;
  collectContactInfo: boolean;
  bookAppointments: boolean;
  cancelAppointments: boolean;
  rescheduleAppointments: boolean;
  sendEmail: boolean;
  transferToHuman: boolean;
  captureLeads: boolean;
}

export const DEFAULT_AGENT_CAPABILITIES: AgentCapabilities = {
  answerQuestions: true,
  collectContactInfo: false,
  bookAppointments: false,
  cancelAppointments: false,
  rescheduleAppointments: false,
  sendEmail: false,
  transferToHuman: false,
  captureLeads: false,
};

// Only these capabilities are backed by real behavior today. Everything
// else in AgentCapabilities is a "coming soon" toggle the UI should label
// as such (see components/dashboard/coming-soon-field.tsx) rather than a
// working feature.
export const IMPLEMENTED_CAPABILITIES: ReadonlySet<keyof AgentCapabilities> = new Set(["answerQuestions"]);

// Normalized, provider-independent view of a widget's Vapi configuration —
// what lib/vapi/mapping.ts turns into a Vapi CreateAssistantDto/UpdateAssistantDto.
export interface VapiAssistantConfig {
  name: string;
  systemPrompt: string;
  firstMessage: string;
  languageCode: string;
  llmProvider: string;
  llmModel: string;
  voiceProvider: string;
  voiceId: string;
  widgetMode: WidgetMode;
  serverUrl: string | null;
  serverSecret: string | null;
  metadata: { aibookingWidgetId: string; aibookingCustomerId: string };
}

// Body of POST /api/customer/widgets/[id]/vapi — creates the Vapi assistant
// on first call, updates the existing one (by stored vapi_assistant_id) on
// every call after that. See lib/security/schemas.ts#vapiSyncSchema.
export interface CreateAgentRequest {
  businessDescription?: string | null;
  businessPhone?: string | null;
  businessEmail?: string | null;
  websiteUrl?: string | null;
  voiceProvider?: string | null;
  voiceId?: string | null;
  llmProvider?: string | null;
  llmModel?: string | null;
  widgetMode?: WidgetMode;
  capabilities?: Partial<AgentCapabilities>;
}

export type UpdateAgentRequest = CreateAgentRequest;

export interface VapiSyncResult {
  widget: Widget;
  vapiAssistantId: string;
  created: boolean;
}

// Safe-for-the-browser embed configuration for the Vapi widget — never
// includes VAPI_API_KEY, only the public key + the customer's own assistant id.
export interface VapiWidgetEmbedConfig {
  publicKey: string;
  assistantId: string;
  mode: "voice" | "chat" | "hybrid";
  theme: "light" | "dark";
  position: string;
  accentColor: string;
  title: string;
  startButtonText: string;
  endButtonText: string;
}
