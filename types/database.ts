// Hand-written types mirroring supabase/migrations/*.sql.
// If the schema changes, update this file in the same commit.

export type UserRole = "MASTER_ADMIN" | "CUSTOMER_ADMIN";
export type CustomerStatus = "active" | "inactive" | "deleted";
export type WidgetStatus = "active" | "paused";
export type ConversationStatus = "active" | "ended";
export type MessageRole = "system" | "user" | "assistant";
export type CreditTransactionType =
  | "subscription_credit"
  | "usage"
  | "manual_adjustment"
  | "refund"
  | "expiration";
export type RenewalType = "automatic" | "manual";

export interface Profile {
  id: string;
  role: UserRole;
  customer_id: string | null;
  full_name: string | null;
  language: string;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  status: CustomerStatus;
  stripe_customer_id: string | null;
  intro_offer_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Package {
  id: string;
  package_name: string;
  monthly_price: number;
  currency: string;
  included_minutes: number;
  overage_price_per_minute: number;
  setup_fee: number | null;
  renewal_type: RenewalType;
  stripe_price_id: string | null;
  active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  customer_id: string;
  package_id: string;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreditAccount {
  id: string;
  customer_id: string;
  balance_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface CreditTransaction {
  id: string;
  customer_id: string;
  credit_account_id: string;
  amount_seconds: number;
  type: CreditTransactionType;
  description: string | null;
  usage_session_id: string | null;
  stripe_event_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface LLMModel {
  id: string;
  provider: string;
  model_name: string;
  display_name: string;
  input_price_per_million: number;
  output_price_per_million: number;
  max_tokens: number;
  active: boolean;
  is_default: boolean;
  show_in_create_flow: boolean;
  created_at: string;
  updated_at: string;
}

export interface VoiceModel {
  id: string;
  provider: string;
  provider_voice_id: string;
  name: string;
  language: string;
  gender: string | null;
  active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface Widget {
  id: string;
  customer_id: string;
  public_id: string;
  name: string;
  status: WidgetStatus;
  business_name: string | null;
  llm_model_id: string | null;
  voice_model_id: string | null;
  language: string;
  system_prompt: string | null;
  welcome_message: string | null;
  opening_message: string | null;
  primary_color: string;
  secondary_color: string;
  logo_url: string | null;
  avatar_url: string | null;
  position: string;
  widget_size: string;
  show_branding: boolean;
  max_response_chars: number;
  booking_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface WidgetSettings {
  widget_id: string;
  extra: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type ConversationChannel = "widget" | "phone";

export interface Conversation {
  id: string;
  widget_id: string;
  customer_id: string;
  status: ConversationStatus;
  channel: ConversationChannel;
  twilio_call_sid: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  token_count: number | null;
  audio_base64: string | null;
  created_at: string;
}

export interface ConversationSummary {
  id: string;
  conversation_id: string;
  summary: string;
  summarized_through_message_id: string | null;
  created_at: string;
}

export type AppointmentStatus = "booked" | "failed" | "rescheduled" | "cancelled";

export interface Appointment {
  id: string;
  customer_id: string;
  widget_id: string | null;
  conversation_id: string | null;
  customer_name: string | null;
  appointment_time: string;
  status: AppointmentStatus;
  calcom_booking_uid: string | null;
  calcom_booking_id: number | null;
  calendar_provider: CalendarProvider | null;
  external_event_id: string | null;
  created_at: string;
}

export interface UsageSession {
  id: string;
  customer_id: string;
  widget_id: string;
  conversation_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  billed_duration_seconds: number;
  llm_model: string | null;
  tts_provider: string | null;
  voice_model: string | null;
  estimated_llm_cost: number;
  estimated_tts_cost: number;
  credit_cost_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface ApiUsage {
  id: string;
  customer_id: string;
  widget_id: string | null;
  conversation_id: string | null;
  usage_session_id: string | null;
  provider: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  characters_used: number | null;
  estimated_cost: number;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  actor_role: string | null;
  customer_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type PhoneNumberSource = "byo_twilio" | "platform_twilio";
export type PhoneNumberPurchaseStatus =
  | "pending_payment"
  | "payment_confirmed"
  | "provisioning"
  | "active"
  | "failed"
  | "released";
export type PhoneNumberDirection = "inbound" | "outbound" | "both";

export interface PhoneNumber {
  id: string;
  customer_id: string;
  widget_id: string;
  vapi_phone_number_id: string;
  phone_number: string;
  label: string | null;
  source: PhoneNumberSource;
  twilio_sid: string | null;
  monthly_price_dkk: number | null;
  purchase_status: PhoneNumberPurchaseStatus;
  direction: PhoneNumberDirection;
  stripe_checkout_session_id: string | null;
  stripe_subscription_id: string | null;
  failure_reason: string | null;
  released_at: string | null;
  created_at: string;
}

export type TwilioSubaccountStatus = "active" | "suspended" | "closed";

export interface TwilioSubaccount {
  id: string;
  customer_id: string;
  twilio_subaccount_sid: string;
  twilio_subaccount_auth_token: string;
  status: TwilioSubaccountStatus;
  created_at: string;
  updated_at: string;
}

export type CalendarProvider = "google" | "outlook" | "calcom";
export type CalendarConnectionStatus = "connected" | "error";

export interface CalendarConnection {
  id: string;
  customer_id: string;
  widget_id: string;
  provider: CalendarProvider;
  status: CalendarConnectionStatus;
  external_account_email: string | null;
  calendar_id: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  calcom_api_key: string | null;
  calcom_event_type_id: string | null;
  calcom_timezone: string | null;
  default_duration_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface StripeEventRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  processed_at: string;
}

// Manual dialer (see 0029_manual_dialer.sql, lib/twilio/dialer.ts) — a
// customer-uploaded lead list they call through one-by-one from the
// browser, as themselves.
export interface LeadList {
  id: string;
  customer_id: string;
  name: string;
  created_at: string;
}

export type LeadStatus = "pending" | "calling" | "called";
export type LeadDisposition =
  | "booked"
  | "interested"
  | "not_interested"
  | "no_answer"
  | "voicemail"
  | "wrong_number"
  | "call_back";

export interface Lead {
  id: string;
  list_id: string;
  customer_id: string;
  phone_number: string;
  contact_name: string | null;
  company: string | null;
  notes: string | null;
  status: LeadStatus;
  disposition: LeadDisposition | null;
  call_sid: string | null;
  duration_seconds: number | null;
  called_at: string | null;
  created_at: string;
}

export type BookingSetupRequestStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface BookingSetupRequest {
  id: string;
  customer_id: string;
  widget_id: string;
  status: BookingSetupRequestStatus;
  request_details: Record<string, unknown> | null;
  created_by: string | null;
  assigned_to: string | null;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalcomConnection {
  id: string;
  customer_id: string;
  calcom_user_id: string;
  calcom_username: string;
  calcom_email: string;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  scope: string | null;
  calcom_event_type_id: string | null;
  calcom_event_type_name: string | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalcomOAuthState {
  state_hash: string;
  customer_id: string;
  expires_at: string;
  created_at: string;
}
