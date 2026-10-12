import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { grantCredits } from "@/lib/credits/ledger";
import { generatePublicWidgetId } from "@/lib/widgets/public-id";
import { getDefaultSystemPrompt, getTrialMinutes, trialGrantDescription } from "@/lib/settings/platform";
import { sendCustomerInviteEmail } from "@/lib/email/invite";
import { isNotBilled } from "./customer-type";
import type { Customer, CustomerType, LLMModel, Package, VoiceModel, Widget } from "@/types/database";

export interface OnboardCustomerParams {
  name: string;
  email: string;
  packageId?: string;
  llmModelId?: string;
  voiceModelId?: string;
  businessName?: string;
  sendInvitation?: boolean;
  // Who sold this customer, e.g. a salesperson's name — see
  // supabase/migrations/0045_customer_reference.sql.
  reference?: string;
  // "samarbejde" = partnership/demo customer, never billed (see
  // lib/customers/customer-type.ts). Defaults to "standard".
  customerType?: CustomerType;
}

export interface OnboardCustomerResult {
  customer: Customer;
  widget: Widget;
  invitationSent: boolean;
}

export async function getDefaultOrSpecified<T extends { id: string; active: boolean; is_default: boolean }>(
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
// (seeded with the same free-trial allowance self-signup gets, not the
// paid package's full minutes — those are only granted once a real Stripe
// invoice is paid, see grantCreditsForPaidInvoice in
// lib/billing/subscription-sync.ts) -> default widget -> default voice ->
// default Claude model, then optionally invites the customer to set their
// own password. See spec sections 29-30.
export async function onboardCustomer(params: OnboardCustomerParams): Promise<OnboardCustomerResult> {
  const supabase = getAdminClient();

  const customerType: CustomerType = params.customerType ?? "standard";
  const notBilled = isNotBilled({ customer_type: customerType });
  const pkg = await getDefaultOrSpecified<Package>("packages", params.packageId);
  const llmModel = await getDefaultOrSpecified<LLMModel>("llm_models", params.llmModelId);
  const voiceModel = await getDefaultOrSpecified<VoiceModel>("voice_models", params.voiceModelId);

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .insert({
      name: params.name,
      email: params.email,
      status: "active",
      reference: params.reference?.trim() || null,
      customer_type: customerType,
    })
    .select("*")
    .single();

  if (customerError || !customer) {
    throw new Error(`Failed to create customer: ${customerError?.message}`);
  }

  // Samarbejde (partnership) customers are never billed: no subscription
  // placeholder for Stripe to pick up and no trial minutes to run down.
  if (!notBilled) {
    await supabase.from("subscriptions").insert({
      customer_id: customer.id,
      package_id: pkg.id,
      status: "incomplete",
    });

    // Same free-trial allowance as self-signup (lib/customers/self-signup.ts)
    // — the package's full included_minutes only get granted once this
    // customer's subscription actually has a paid Stripe invoice behind it.
    // How many minutes is set by the master admin (Indstillinger → Gratis
    // prøveperiode); zero means new customers start without free minutes.
    const trialMinutes = await getTrialMinutes();
    if (trialMinutes > 0) {
      await grantCredits({
        customerId: customer.id,
        seconds: trialMinutes * 60,
        description: trialGrantDescription(trialMinutes),
      });
    }
  }

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
    const invite = await sendCustomerInviteEmail({
      supabase,
      email: params.email,
      recipientName: params.name,
      companyName: params.businessName ?? params.name,
    });

    if (invite) {
      await supabase.from("profiles").insert({
        id: invite.userId,
        role: "CUSTOMER_ADMIN",
        customer_id: customer.id,
        full_name: params.name,
      });
      invitationSent = true;
    }
  }

  return { customer: customer as Customer, widget: widget as Widget, invitationSent };
}
