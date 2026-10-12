import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { grantCredits } from "@/lib/credits/ledger";
import { generatePublicWidgetId } from "@/lib/widgets/public-id";
import { getDefaultSystemPrompt, getTrialMinutes, trialGrantDescription } from "@/lib/settings/platform";
import { createVapiAssistant } from "@/lib/vapi";
import { defaultGreeting, withLanguageDirective } from "@/lib/i18n/agent-content";
import { getDefaultOrSpecified } from "./onboarding";
import type { Customer, LLMModel, Package, VoiceModel, Widget } from "@/types/database";
import { ApiError } from "@/types/errors";

// Mirrors app/api/customer/widgets/route.ts — the voice the wizard's
// Stemme step starts from until the customer picks explicitly.
const DEFAULT_VOICE_GENDER = "female";

export interface SelfSignupParams {
  companyName: string;
  email: string;
  phone?: string;
  language: string;
  // Either a password for a brand-new login, or the id of a login that
  // already exists in the shared auth project (e.g. someone who signed up
  // for Nordcall first) and now gets its own, separate AIbooking account.
  password?: string;
  existingUserId?: string;
}

export interface SelfSignupResult {
  customer: Customer;
  widget: Widget;
  userId: string;
}

// The "Main widget" a new customer lands on should be the same kind of agent
// the create-agent flow would give them — the Vapi voice agent (see
// 0012_vapi_default_model.sql). getDefaultOrSpecified would instead pick
// llm_models.is_default, which is the OpenAI Realtime row: a different
// engine, needing a different API key, with no Vapi assistant behind it. New
// customers were landing on a first agent unlike every later one they create.
//
// is_default stays the fallback rather than the choice: it still means "the
// system default" for everything that reads it independently of the create
// flow, and it keeps signup working if nobody has marked a model
// show_in_create_flow yet.
async function resolveSignupLLMModel(): Promise<LLMModel> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("llm_models")
    .select("*")
    .eq("active", true)
    .eq("show_in_create_flow", true)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle<LLMModel>();

  return data ?? (await getDefaultOrSpecified<LLMModel>("llm_models", undefined));
}

// Public counterpart to lib/customers/onboarding.ts's admin-triggered
// onboardCustomer(): same customer/subscription/credit/widget setup, but
// the account is created with the password the person chose on /signup
// (auth.admin.createUser, email pre-confirmed) instead of an invitation
// email, since there's no admin on the other end to send one from.
export async function selfSignupCustomer(params: SelfSignupParams): Promise<SelfSignupResult> {
  const supabase = getAdminClient();

  if (params.existingUserId) {
    const { data: existing } = await supabase.from("profiles").select("id").eq("id", params.existingUserId).maybeSingle();
    if (existing) throw ApiError.badRequest("Der findes allerede en AIbooking-konto til dette login");
  } else {
    if (!params.password) throw ApiError.badRequest("Adgangskode mangler");
    // The auth project is shared with Nordcall, so the email may already have
    // a login there. That login can still get its own AIbooking account: it
    // just has to sign in first (see app/account-incomplete).
    const { data: existingProfile } = await supabase.auth.admin.listUsers();
    if (existingProfile.users.some((u) => u.email?.toLowerCase() === params.email.toLowerCase())) {
      throw ApiError.badRequest(
        "Denne e-mail har allerede et login (fx til Nordcall). Log ind med samme e-mail og adgangskode, så kan du oprette din AIbooking-konto."
      );
    }
  }

  const pkg = await getDefaultOrSpecified<Package>("packages", undefined);
  const llmModel = await resolveSignupLLMModel();
  const voiceModel = await getDefaultOrSpecified<VoiceModel>("voice_models", undefined);

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .insert({ name: params.companyName, email: params.email, phone: params.phone ?? null, status: "active" })
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

  // Self-signup starts with the free trial allowance, not the paid
  // package's full minutes — those only apply once a subscription is
  // actually active (see lib/billing/trial.ts's hasEmbedCodeAccess).
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

  // Same provisioning the create-agent route does (see
  // app/api/customer/widgets/route.ts): a Vapi widget with no assistant
  // can't take a call at all. Best-effort here, unlike there — a Vapi
  // outage must not cost someone their signup, and the widget PATCH route
  // self-heals a missing assistant the next time the customer saves.
  const extra: Record<string, unknown> = { voiceGender: DEFAULT_VOICE_GENDER };

  if (llmModel.provider === "vapi") {
    try {
      const assistant = await createVapiAssistant({
        name: widget.name,
        systemPrompt: withLanguageDirective(defaultSystemPrompt, widget.language),
        firstMessage: widget.opening_message ?? defaultGreeting(widget.language),
        voiceGender: DEFAULT_VOICE_GENDER,
        language: widget.language,
      });
      extra.vapiAssistantId = assistant.id;
    } catch (err) {
      console.error(`Failed to provision Vapi assistant for new customer ${customer.id}:`, err);
    }
  }

  await supabase.from("widget_settings").insert({ widget_id: widget.id, extra });

  let userId = params.existingUserId;
  if (!userId) {
    const { data: created, error: authError } = await supabase.auth.admin.createUser({
      email: params.email,
      password: params.password,
      email_confirm: true,
      user_metadata: { full_name: params.companyName },
    });

    if (authError || !created?.user) {
      throw new Error(`Failed to create account: ${authError?.message}`);
    }
    userId = created.user.id;
  }

  const { error: profileError } = await supabase.from("profiles").insert({
    id: userId,
    role: "CUSTOMER_ADMIN",
    customer_id: customer.id,
    full_name: params.companyName,
    language: params.language,
  });

  if (profileError) {
    throw new Error(`Failed to create profile: ${profileError.message}`);
  }

  return { customer: customer as Customer, widget: widget as Widget, userId };
}
