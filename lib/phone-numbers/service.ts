import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { getOrCreateSubaccount, purchaseTwilioNumber, releaseTwilioNumber } from "@/lib/twilio";
import { importTwilioPhoneNumber } from "@/lib/vapi";
import { writeAuditLog } from "@/lib/security/audit";

// Shared provisioning logic for a platform-bought number, called from two
// places: the Stripe webhook once payment is confirmed
// (app/api/webhooks/stripe/route.ts), and the manual retry endpoint for a
// previously failed attempt (app/api/customer/phone-numbers/[id]/retry).
// Deliberately swallows provisioning failures into the row's
// purchase_status/failure_reason rather than throwing — a Twilio/Vapi
// hiccup here shouldn't turn into an endless Stripe webhook retry loop (the
// payment already succeeded either way), and the customer gets a clear
// in-app "failed, here's why" instead of a silently stuck purchase.
export async function provisionPurchasedNumber(phoneNumberRowId: string): Promise<void> {
  const supabase = getAdminClient();

  const { data: row, error: rowError } = await supabase
    .from("phone_numbers")
    .select("*")
    .eq("id", phoneNumberRowId)
    .single();
  if (rowError) throw rowError;

  if (row.purchase_status !== "payment_confirmed" && row.purchase_status !== "failed") {
    // Already provisioning/active, or not yet paid — nothing to do. Makes
    // this safe to call twice for the same row (webhook redelivery, or a
    // retry click after it already succeeded).
    return;
  }

  await supabase.from("phone_numbers").update({ purchase_status: "provisioning" }).eq("id", phoneNumberRowId);

  try {
    const { data: settings } = await supabase
      .from("widget_settings")
      .select("extra")
      .eq("widget_id", row.widget_id)
      .maybeSingle();
    const assistantId = (settings?.extra as Record<string, unknown> | null)?.vapiAssistantId;
    if (typeof assistantId !== "string") {
      throw new Error("Agenten har ikke en Vapi-assistent endnu");
    }

    const credentials = await getOrCreateSubaccount(row.customer_id);
    const purchased = await purchaseTwilioNumber(credentials, row.phone_number);
    const imported = await importTwilioPhoneNumber({
      twilioAccountSid: credentials.accountSid,
      twilioAuthToken: credentials.authToken,
      twilioPhoneNumber: purchased.phoneNumber,
      assistantId,
      name: row.label ?? undefined,
    });

    await supabase
      .from("phone_numbers")
      .update({
        vapi_phone_number_id: imported.id,
        phone_number: imported.number,
        twilio_sid: purchased.sid,
        purchase_status: "active",
        failure_reason: null,
      })
      .eq("id", phoneNumberRowId);

    await writeAuditLog({
      customerId: row.customer_id,
      action: "phone_number.provisioned",
      entityType: "phone_number",
      entityId: phoneNumberRowId,
      metadata: { phoneNumber: imported.number },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ukendt fejl";
    console.error(`Failed to provision phone_numbers row ${phoneNumberRowId}:`, err);
    await supabase
      .from("phone_numbers")
      .update({ purchase_status: "failed", failure_reason: message })
      .eq("id", phoneNumberRowId);

    await writeAuditLog({
      customerId: row.customer_id,
      action: "phone_number.provisioning_failed",
      entityType: "phone_number",
      entityId: phoneNumberRowId,
      metadata: { error: message },
    });
  }
}

// Releases an active number back to Twilio and marks the row terminal.
// Keeps the row (status='released') rather than deleting it, so purchase
// history and past call records (phone_calls.phone_number_id) survive.
export async function releasePhoneNumber(phoneNumberRowId: string): Promise<void> {
  const supabase = getAdminClient();

  const { data: row, error } = await supabase.from("phone_numbers").select("*").eq("id", phoneNumberRowId).single();
  if (error) throw error;

  if (row.twilio_sid && row.source === "platform_twilio") {
    const credentials = await getOrCreateSubaccount(row.customer_id);
    await releaseTwilioNumber(credentials, row.twilio_sid);
  }

  await supabase
    .from("phone_numbers")
    .update({ purchase_status: "released", released_at: new Date().toISOString() })
    .eq("id", phoneNumberRowId);

  await writeAuditLog({
    customerId: row.customer_id,
    action: "phone_number.released",
    entityType: "phone_number",
    entityId: phoneNumberRowId,
    metadata: { phoneNumber: row.phone_number },
  });
}
