import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, vapiNumberInputSchema } from "@/lib/security";
import { createVapiManagedNumber, ensureInboundAssistant, isVapiBillingRefusal } from "@/lib/vapi";
import { PHONE_NUMBER_CLIENT_COLUMNS } from "@/lib/phone-numbers";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Gives an agent an inbound number handed out by Vapi, wired to its assistant
// from the moment it exists. The customer keeps the number their customers
// already call and forwards it here, so nobody has to own a Twilio account or
// move an existing line — see supabase/migrations/0037_vapi_inbound_numbers.sql.
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, vapiNumberInputSchema);
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const { data: widget, error: widgetError } = await supabase
    .from("widgets")
    .select("id, name, customer_id")
    .eq("id", body.widgetId)
    .maybeSingle();
  if (widgetError) throw widgetError;
  if (!widget || widget.customer_id !== customerId) throw ApiError.notFound("Widget not found");

  // One number per agent: a second one would ring the same assistant with
  // nothing to tell the two apart, and Vapi hands out a limited pool of them.
  const { data: existing } = await supabase
    .from("phone_numbers")
    .select("id")
    .eq("widget_id", widget.id)
    .eq("source", "vapi")
    .is("released_at", null)
    .maybeSingle();
  if (existing) {
    throw ApiError.badRequest("Denne agent har allerede et nummer. Frigiv det først, hvis I vil have et nyt.");
  }

  const assistantId = await ensureInboundAssistant(widget.id);

  let number;
  try {
    number = await createVapiManagedNumber({
      assistantId,
      name: body.label ?? widget.name,
      areaCode: body.areaCode,
    });
  } catch (err) {
    // A missing card on the platform's Vapi account is our problem, not the
    // customer's, and "provide a credit card payment method" reads like an
    // instruction to them. The detail stays in the log for whoever can act
    // on it; they get a sentence that is true and not theirs to fix.
    if (isVapiBillingRefusal(err)) {
      console.error("Vapi refused a phone number — the platform account needs a payment method:", err);
      throw ApiError.internal(
        "Der kan ikke tildeles flere telefonnumre lige nu. Vi er på sagen — kontakt os, hvis det haster."
      );
    }
    throw err;
  }

  const { data: phoneNumber, error } = await supabase
    .from("phone_numbers")
    .insert({
      customer_id: customerId,
      widget_id: widget.id,
      source: "vapi",
      direction: "inbound",
      purchase_status: "active",
      label: body.label ?? null,
      vapi_phone_number_id: number.id,
      phone_number: number.number,
    })
    .select(PHONE_NUMBER_CLIENT_COLUMNS)
    .single();
  if (error) throw error;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "phone_number.vapi_assigned",
    entityType: "phone_number",
    entityId: phoneNumber.id,
    metadata: { widgetId: widget.id, phoneNumber: phoneNumber.phone_number },
  });

  return NextResponse.json({ phoneNumber }, { status: 201 });
});
