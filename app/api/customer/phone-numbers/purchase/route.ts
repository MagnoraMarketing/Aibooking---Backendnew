import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, purchasePhoneNumberInputSchema } from "@/lib/security";
import { importTwilioPhoneNumber } from "@/lib/vapi";
import { purchaseTwilioNumber, getPlatformTwilioCredentials, DK_LOCAL_NUMBER_MONTHLY_PRICE_DKK } from "@/lib/twilio";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// Buys a Danish number through the platform's own Twilio account and
// attaches it to one of the customer's agents — the number the customer
// then forwards their existing phone to (see
// components/dashboard/call-forwarding-instructions.tsx). Unlike the
// BYO-Twilio import route, we own the number: it's purchased under our
// Twilio account and its rent is on us to recoup via monthly_price_dkk.
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, purchasePhoneNumberInputSchema);
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const { data: widget, error: widgetError } = await supabase
    .from("widgets")
    .select("id, name, customer_id")
    .eq("id", body.widgetId)
    .maybeSingle();
  if (widgetError) throw widgetError;
  if (!widget || widget.customer_id !== customerId) throw ApiError.notFound("Widget not found");

  const { data: settings } = await supabase
    .from("widget_settings")
    .select("extra")
    .eq("widget_id", widget.id)
    .maybeSingle();
  const assistantId = (settings?.extra as Record<string, unknown> | null)?.vapiAssistantId;
  if (typeof assistantId !== "string") {
    throw ApiError.badRequest("Denne agent har ikke en Vapi-assistent endnu");
  }

  const purchased = await purchaseTwilioNumber(body.phoneNumber);

  let imported;
  try {
    const platformCredentials = getPlatformTwilioCredentials();
    imported = await importTwilioPhoneNumber({
      twilioAccountSid: platformCredentials.accountSid,
      twilioAuthToken: platformCredentials.authToken,
      twilioPhoneNumber: purchased.phoneNumber,
      assistantId,
      name: body.label ?? widget.name,
    });
  } catch (err) {
    // The number is bought at this point but not usable — surface a clear
    // error rather than silently leaving an orphaned Twilio number. Manual
    // cleanup (release the number in Twilio) is a known follow-up; we don't
    // auto-release here since a partial Vapi failure can still be retried
    // by re-running the import against the same Twilio number.
    console.error(`Purchased Twilio number ${purchased.phoneNumber} (${purchased.sid}) but Vapi import failed:`, err);
    throw ApiError.internal(
      "Nummeret blev købt, men kunne ikke tilknyttes agenten. Kontakt support med nummeret " + purchased.phoneNumber
    );
  }

  const { data: phoneNumber, error } = await supabase
    .from("phone_numbers")
    .insert({
      customer_id: customerId,
      widget_id: widget.id,
      vapi_phone_number_id: imported.id,
      phone_number: imported.number,
      label: body.label ?? null,
      source: "platform_twilio",
      twilio_sid: purchased.sid,
      monthly_price_dkk: DK_LOCAL_NUMBER_MONTHLY_PRICE_DKK,
    })
    .select("*")
    .single();

  if (error) throw error;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "phone_number.purchased",
    entityType: "phone_number",
    entityId: phoneNumber.id,
    metadata: { widgetId: widget.id, phoneNumber: imported.number },
  });

  return NextResponse.json({ phoneNumber }, { status: 201 });
});
