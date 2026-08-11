import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { grantCredits } from "@/lib/credits/ledger";
import { generatePublicWidgetId } from "@/lib/widgets/public-id";
import { getDefaultSystemPrompt } from "@/lib/settings/platform";
import type { Customer, LLMModel, Package, VoiceModel, Widget } from "@/types/database";

export interface OnboardCustomerParams {
  name: string;
  email: string;
  packageId?: string;
  llmModelId?: string;
  voiceModelId?: string;
  businessName?: string;
  sendInvitation?: boolean;
}

export interface OnboardCustomerResult {
  customer: Customer;
  widget: Widget;
  invitationSent: boolean;
}

async function getDefaultOrSpecified<T extends { id: string; active: boolean; is_default: boolean }>(
  table: "packages" | "llm_models" | "voice_models",
  specifiedId: string | undefined
): Promise<T> {
  const supabase = getAdminClient();

  if (specifiedId) {
    const { data, error } = await supabase.from(table).select("*").eq("id", specifiedId).single();
    if (error || !data) throw new Error(`${table} ${specifiedId} not found`);
    return data as T;
  }

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("active", true)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) throw new Error(`No active default row found in ${table}`);
  return data as T;
}

// Admin creates a customer -> subscription placeholder -> credit account
// (seeded with one included allocation so the widget works immediately) ->
// default widget -> default voice -> default Claude model, then optionally
// invites the customer to set their own password. See spec sections 29-30.
export async function onboardCustomer(params: OnboardCustomerParams): Promise<OnboardCustomerResult> {
  const supabase = getAdminClient();

  const pkg = await getDefaultOrSpecified<Package>("packages", params.packageId);
  const llmModel = await getDefaultOrSpecified<LLMModel>("llm_models", params.llmModelId);
  const voiceModel = await getDefaultOrSpecified<VoiceModel>("voice_models", params.voiceModelId);

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .insert({ name: params.name, email: params.email, status: "active" })
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
      business_name: params.businessName ?? params.name,
      llm_model_id: llmModel.id,
      voice_model_id: voiceModel.id,
      language: "da",
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

  let invitationSent = false;
  if (params.sendInvitation !== false) {
    const { data: invite, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
      params.email,
      { data: { full_name: params.name } }
    );

    if (inviteError || !invite?.user) {
      console.error("Failed to send customer invitation:", inviteError?.message);
    } else {
      await supabase.from("profiles").insert({
        id: invite.user.id,
        role: "CUSTOMER_ADMIN",
        customer_id: customer.id,
        full_name: params.name,
      });
      invitationSent = true;
    }
  }

  return { customer: customer as Customer, widget: widget as Widget, invitationSent };
}
