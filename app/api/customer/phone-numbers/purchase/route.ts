import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import {
  readJsonBody,
  withErrorHandling,
  writeAuditLog,
  purchasePhoneNumberInputSchema,
  rateLimit,
  getClientIp,
} from "@/lib/security";
import { provisionPurchasedNumber, PHONE_NUMBER_CLIENT_COLUMNS } from "@/lib/phone-numbers";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// Numbers bought through us are included in the customer's package price —
// no separate charge, so this provisions synchronously instead of routing
// through a Stripe Checkout Session. The gate is simply "does this
// customer have an active paid subscription" (trial customers can build
// and test an agent, but a phone number is a paid-plan feature).
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();

  const rateLimitResult = rateLimit(`phone-number-purchase:${getClientIp(request.headers)}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!rateLimitResult.allowed) throw ApiError.tooManyRequests("For mange forsøg — prøv igen om lidt.");

  const body = await readJsonBody(request, purchasePhoneNumberInputSchema);
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subscription?.status !== "active") {
    throw ApiError.paymentRequired(
      "Telefonnumre er inkluderet i en betalt pakke — bestil en pakke under Betaling for at få adgang."
    );
  }

  const { data: widget, error: widgetError } = await supabase
    .from("widgets")
    .select("id, customer_id, llm_model_id")
    .eq("id", body.widgetId)
    .maybeSingle();
  if (widgetError) throw widgetError;
  if (!widget || widget.customer_id !== customerId) throw ApiError.notFound("Widget not found");

  const { data: llmModel } = widget.llm_model_id
    ? await supabase.from("llm_models").select("provider").eq("id", widget.llm_model_id).maybeSingle()
    : { data: null };

  if (llmModel?.provider === "vapi") {
    const { data: settings } = await supabase
      .from("widget_settings")
      .select("extra")
      .eq("widget_id", widget.id)
      .maybeSingle();
    const assistantId = (settings?.extra as Record<string, unknown> | null)?.vapiAssistantId;
    if (typeof assistantId !== "string") {
      throw ApiError.badRequest("Denne agent har ikke en Vapi-assistent endnu");
    }
  }

  const { data: phoneNumberRow, error } = await supabase
    .from("phone_numbers")
    .insert({
      customer_id: customerId,
      widget_id: widget.id,
      phone_number: body.phoneNumber,
      label: body.label ?? null,
      source: "platform_twilio",
      direction: body.direction,
      purchase_status: "payment_confirmed",
      monthly_price_dkk: null,
    })
    .select("id")
    .single();
  if (error) throw error;

  await provisionPurchasedNumber(phoneNumberRow.id);

  const { data: phoneNumber, error: refetchError } = await supabase
    .from("phone_numbers")
    .select(PHONE_NUMBER_CLIENT_COLUMNS)
    .eq("id", phoneNumberRow.id)
    .single();
  if (refetchError) throw refetchError;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "phone_number.purchased",
    entityType: "phone_number",
    entityId: phoneNumberRow.id,
    metadata: { widgetId: widget.id, phoneNumber: body.phoneNumber },
  });

  return NextResponse.json({ phoneNumber }, { status: 201 });
});
