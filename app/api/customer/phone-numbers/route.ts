import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, importPhoneNumberInputSchema } from "@/lib/security";
import { importTwilioPhoneNumber } from "@/lib/vapi";
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

// Imports a customer-owned Twilio number into Vapi and attaches it to one
// of the customer's agents — that agent's existing Vapi assistant then
// answers calls to this number. We never provision Twilio numbers
// ourselves; the customer brings their own Twilio account.
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, importPhoneNumberInputSchema);
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

  const imported = await importTwilioPhoneNumber({
    twilioAccountSid: body.twilioAccountSid,
    twilioAuthToken: body.twilioAuthToken,
    twilioPhoneNumber: body.twilioPhoneNumber,
    assistantId,
    name: body.label ?? widget.name,
  });

  const { data: phoneNumber, error } = await supabase
    .from("phone_numbers")
    .insert({
      customer_id: customerId,
      widget_id: widget.id,
      vapi_phone_number_id: imported.id,
      phone_number: imported.number,
      label: body.label ?? null,
      direction: body.direction,
      purchase_status: "active",
    })
    .select("*")
    .single();

  if (error) throw error;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "phone_number.imported",
    entityType: "phone_number",
    entityId: phoneNumber.id,
    metadata: { widgetId: widget.id, phoneNumber: imported.number },
  });

  return NextResponse.json({ phoneNumber }, { status: 201 });
});
