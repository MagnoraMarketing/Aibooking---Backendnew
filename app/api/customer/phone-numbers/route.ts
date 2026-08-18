import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, importPhoneNumberInputSchema } from "@/lib/security";
import { importTwilioPhoneNumber } from "@/lib/vapi";
import { findIncomingPhoneNumberSid, configureDirectVoiceWebhook } from "@/lib/twilio";
import { twilioWebhookUrls } from "@/lib/telephony/urls";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("phone_numbers")
    .select("*")
    .eq("customer_id", ctx.profile.customer_id!)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return NextResponse.json({ phoneNumbers: data });
});

// Imports a customer-owned Twilio number and attaches it to one of the
// customer's agents. Which pipeline handles it depends on the agent's
// model, chosen once at creation (see agent-creation-wizard.tsx): a
// Vapi-model agent gets the number imported into Vapi, whose existing
// assistant then answers calls; a Twilio-direct (provider='anthropic')
// agent instead points the number straight at our own TwiML webhooks, with
// the customer's credentials stored on the row itself so a later call's
// signature can be validated against something — there's no subaccount to
// fall back to for a BYO number the way there is for a platform-purchased
// one (see 0021_byo_twilio_direct.sql and lib/telephony/resolve.ts).
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, importPhoneNumberInputSchema);
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const { data: widget, error: widgetError } = await supabase
    .from("widgets")
    .select("id, name, customer_id, llm_model_id")
    .eq("id", body.widgetId)
    .maybeSingle();
  if (widgetError) throw widgetError;
  if (!widget || widget.customer_id !== customerId) throw ApiError.notFound("Widget not found");

  const { data: llmModel } = widget.llm_model_id
    ? await supabase.from("llm_models").select("provider").eq("id", widget.llm_model_id).maybeSingle()
    : { data: null };
  const isTwilioDirect = llmModel?.provider === "anthropic";

  const credentials = { accountSid: body.twilioAccountSid, authToken: body.twilioAuthToken };

  const insertRow: Record<string, unknown> = {
    customer_id: customerId,
    widget_id: widget.id,
    source: "byo_twilio",
    label: body.label ?? null,
    direction: body.direction,
    purchase_status: "active",
  };

  if (isTwilioDirect) {
    const sid = await findIncomingPhoneNumberSid(credentials, body.twilioPhoneNumber);
    if (!sid) throw ApiError.badRequest("Nummeret blev ikke fundet på denne Twilio-konto.");

    const urls = twilioWebhookUrls();
    await configureDirectVoiceWebhook(credentials, sid, {
      voiceUrl: urls.inbound,
      statusCallbackUrl: urls.status,
    });

    Object.assign(insertRow, {
      phone_number: body.twilioPhoneNumber,
      twilio_sid: sid,
      twilio_account_sid: body.twilioAccountSid,
      twilio_auth_token: body.twilioAuthToken,
    });
  } else {
    const { data: settings } = await supabase
      .from("widget_settings")
      .select("extra")
      .eq("widget_id", widget.id)
      .maybeSingle();
    const assistantId = (settings?.extra as Record<string, unknown> | null)?.vapiAssistantId;
    if (typeof assistantId !== "string") {
      throw ApiError.badRequest("Denne agent har ikke en Vapi-assistent endnu");
    }

    const imported = await importTwilioPhoneNumber({
      twilioAccountSid: body.twilioAccountSid,
      twilioAuthToken: body.twilioAuthToken,
      twilioPhoneNumber: body.twilioPhoneNumber,
      assistantId,
      name: body.label ?? widget.name,
    });

    Object.assign(insertRow, { vapi_phone_number_id: imported.id, phone_number: imported.number });
  }

  const { data: phoneNumber, error } = await supabase.from("phone_numbers").insert(insertRow).select("*").single();

  if (error) throw error;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "phone_number.imported",
    entityType: "phone_number",
    entityId: phoneNumber.id,
    metadata: { widgetId: widget.id, phoneNumber: phoneNumber.phone_number },
  });

  return NextResponse.json({ phoneNumber }, { status: 201 });
});
