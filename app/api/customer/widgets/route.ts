import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, createWidgetSchema } from "@/lib/security";
import { generatePublicWidgetId, buildShareUrl, buildEmbedSnippet } from "@/lib/widgets";
import { getDefaultSystemPrompt } from "@/lib/settings/platform";
import { createVapiAssistant, deleteVapiAssistant } from "@/lib/vapi";
import { DEFAULT_VOICE_GENDER } from "@/lib/vapi/voice-gender";
import { defaultGreeting, withLanguageDirective } from "@/lib/i18n/agent-content";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";
import { ApiError } from "@/types/errors";
import type { Widget } from "@/types/database";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("widgets")
    .select("*")
    .eq("customer_id", ctx.profile.customer_id!)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const widgets = (data ?? []).map((w) => ({
    ...w,
    shareUrl: buildShareUrl(w.public_id),
    embedSnippet: buildEmbedSnippet(w.public_id),
  }));

  return NextResponse.json({ widgets });
});

export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, createWidgetSchema);
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const systemPrompt = body.systemPrompt ?? (await getDefaultSystemPrompt());
  // New widgets default to their creator's own Dashboard language rather
  // than a hardcoded "da" — a Spanish-speaking customer's first agent
  // should speak Spanish out of the box, not require an extra step.
  const language = body.language ?? (isLocale(ctx.profile.language) ? ctx.profile.language : DEFAULT_LOCALE);

  // Agents are created exclusively on the Vapi model (see
  // 0012_vapi_default_model.sql), and every one gets an assistant of its own
  // in Vapi — never a shared or pre-existing one (see
  // lib/vapi/assistant-owner.ts). It is created BEFORE the agent is saved,
  // so an agent never exists, not even for a moment, looking active while it
  // has no assistant to take its calls: if Vapi is down, nothing is saved,
  // the customer gets an error, and trying again is the retry.
  const { data: llmModel } = body.llmModelId
    ? await supabase.from("llm_models").select("provider").eq("id", body.llmModelId).maybeSingle()
    : { data: null };

  // Widgets on the Vapi model default to the "Dame" voice template until the
  // customer picks explicitly in the wizard's Stemme step — see
  // WizardVoiceStep and resolveVoiceConfig in lib/vapi/assistants.ts. The
  // default itself lives in lib/vapi/voice-gender.ts so the UI, this route
  // and the assistant sync can't drift apart.
  const extra: Record<string, unknown> = { voiceGender: DEFAULT_VOICE_GENDER };

  if (llmModel?.provider === "vapi") {
    try {
      const assistant = await createVapiAssistant({
        name: body.name ?? "Main widget",
        systemPrompt: withLanguageDirective(systemPrompt, language),
        firstMessage: body.openingMessage ?? defaultGreeting(language),
        voiceGender: DEFAULT_VOICE_GENDER,
        language,
      });
      extra.vapiAssistantId = assistant.id;
    } catch (err) {
      console.error(`[vapi] Could not create an assistant for a new agent (customer ${customerId}):`, err);
      throw new ApiError(
        502,
        "vapi_provisioning_failed",
        "Agenten kunne ikke oprettes, fordi stemmeassistenten ikke kunne oprettes hos vores stemmeudbyder. Intet er gemt — prøv igen om lidt."
      );
    }
  }

  const vapiAssistantId = typeof extra.vapiAssistantId === "string" ? extra.vapiAssistantId : null;

  let widget: Widget;
  try {
    const { data, error } = await supabase
      .from("widgets")
      .insert({
        customer_id: customerId,
        public_id: generatePublicWidgetId(),
        name: body.name,
        agent_type: body.agentType,
        business_name: body.businessName,
        llm_model_id: body.llmModelId,
        voice_model_id: body.voiceModelId,
        language,
        system_prompt: systemPrompt,
        welcome_message: body.welcomeMessage,
        opening_message: body.openingMessage,
      })
      .select("*")
      .single();
    if (error) throw error;
    widget = data as Widget;

    // widget_settings cascades on delete (see 0001_init_schema.sql), so
    // removing the agent below also removes this row.
    const { error: settingsError } = await supabase.from("widget_settings").insert({ widget_id: widget.id, extra });
    if (settingsError) {
      await supabase.from("widgets").delete().eq("id", widget.id);
      throw settingsError;
    }
  } catch (err) {
    // The agent was not saved, so the assistant made for it belongs to
    // nobody — remove it rather than leave an orphan in Vapi.
    if (vapiAssistantId) {
      await deleteVapiAssistant(vapiAssistantId).catch((cleanupErr) =>
        console.error(`[vapi] Could not remove orphaned assistant ${vapiAssistantId}:`, cleanupErr)
      );
    }
    throw err;
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "widget.created",
    entityType: "widget",
    entityId: widget.id,
  });

  return NextResponse.json(
    { widget: { ...widget, shareUrl: buildShareUrl(widget.public_id), embedSnippet: buildEmbedSnippet(widget.public_id) } },
    { status: 201 }
  );
});
