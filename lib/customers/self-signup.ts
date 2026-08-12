import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { grantCredits } from "@/lib/credits/ledger";
import { generatePublicWidgetId } from "@/lib/widgets/public-id";
import { getDefaultSystemPrompt } from "@/lib/settings/platform";
import { getDefaultOrSpecified } from "./onboarding";
import type { Customer, LLMModel, Package, VoiceModel, Widget } from "@/types/database";
import { ApiError } from "@/types/errors";

export interface SelfSignupParams {
  companyName: string;
  email: string;
  password: string;
  language: string;
}

export interface SelfSignupResult {
  customer: Customer;
  widget: Widget;
  userId: string;
}

// Public counterpart to lib/customers/onboarding.ts's admin-triggered
// onboardCustomer(): same customer/subscription/credit/widget setup, but
// the account is created with the password the person chose on /signup
// (auth.admin.createUser, email pre-confirmed) instead of an invitation
// email, since there's no admin on the other end to send one from.
export async function selfSignupCustomer(params: SelfSignupParams): Promise<SelfSignupResult> {
  const supabase = getAdminClient();

  const { data: existingProfile } = await supabase.auth.admin.listUsers();
  if (existingProfile.users.some((u) => u.email?.toLowerCase() === params.email.toLowerCase())) {
    throw ApiError.badRequest("En konto med denne email findes allerede");
  }

  const pkg = await getDefaultOrSpecified<Package>("packages", undefined);
  const llmModel = await getDefaultOrSpecified<LLMModel>("llm_models", undefined);
  const voiceModel = await getDefaultOrSpecified<VoiceModel>("voice_models", undefined);

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .insert({ name: params.companyName, email: params.email, status: "active" })
    .select("*")
    .single();

  if (customerError || !customer) {
    throw new Error(`Failed to create customer: ${customerError?.message}`);
  }

  await supabase.from("subscriptions").insert({
    customer_id: customer.id,
    package_id: pkg.id,
    status: "incomplete",
  });

  await grantCredits({
    customerId: customer.id,
    seconds: pkg.included_minutes * 60,
    description: `Velkomstpakke: ${pkg.package_name} (${pkg.included_minutes} minutter)`,
  });

  const defaultSystemPrompt = await getDefaultSystemPrompt();

  const { data: widget, error: widgetError } = await supabase
    .from("widgets")
    .insert({
      customer_id: customer.id,
      public_id: generatePublicWidgetId(),
      name: "Main widget",
      business_name: params.companyName,
      llm_model_id: llmModel.id,
      voice_model_id: voiceModel.id,
      language: params.language,
      system_prompt: defaultSystemPrompt,
      welcome_message: "Hej! Hvordan kan jeg hjælpe dig i dag?",
      opening_message: "Hej! Hvordan kan jeg hjælpe dig i dag?",
    })
    .select("*")
    .single();

  if (widgetError || !widget) {
    throw new Error(`Failed to create default widget: ${widgetError?.message}`);
  }

  await supabase.from("widget_settings").insert({ widget_id: widget.id, extra: {} });

  const { data: created, error: authError } = await supabase.auth.admin.createUser({
    email: params.email,
    password: params.password,
    email_confirm: true,
    user_metadata: { full_name: params.companyName },
  });

  if (authError || !created?.user) {
    throw new Error(`Failed to create account: ${authError?.message}`);
  }

  await supabase.from("profiles").insert({
    id: created.user.id,
    role: "CUSTOMER_ADMIN",
    customer_id: customer.id,
    full_name: params.companyName,
    language: params.language,
  });

  return { customer: customer as Customer, widget: widget as Widget, userId: created.user.id };
}
