import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { writeAuditLog } from "@/lib/security/audit";
import {
  createVapiManagedNumber,
  ensureInboundAssistant,
  isVapiBillingRefusal,
  attachAssistantToVapiNumber,
  listVapiPhoneNumbers,
} from "@/lib/vapi";
import { PHONE_NUMBER_CLIENT_COLUMNS } from "./columns";
import { ApiError } from "@/types/errors";
import type { PhoneNumber } from "@/types/database";

export interface ProvisionVapiNumberParams {
  customerId: string;
  widget: { id: string; name: string };
  label?: string | null;
  areaCode?: string;
  /** A number the platform already owns, picked by the customer — see attachExistingNumber. */
  vapiPhoneNumberId?: string;
  /** Present when a signed-in admin triggered this directly (the API route); absent for a webhook-driven auto-assignment. */
  actor?: { userId: string; role: string };
}

// Points a number the platform already owns at this agent's assistant. The
// number is looked up rather than trusted from the caller: an id that is not
// in the account would otherwise be stored as a working number nobody can
// call.
async function attachExistingNumber(vapiPhoneNumberId: string, assistantId: string) {
  const existing = (await listVapiPhoneNumbers()).find((number) => number.id === vapiPhoneNumberId);
  if (!existing) {
    throw ApiError.badRequest("Nummeret findes ikke længere. Genindlæs siden og vælg et andet.");
  }

  await attachAssistantToVapiNumber(existing.id, assistantId);
  return { id: existing.id, number: existing.number };
}

// Gives an agent an inbound number handed out by Vapi, wired to its assistant
// from the moment it exists. The customer keeps the number their customers
// already call and forwards it here, so nobody has to own a Twilio account or
// move an existing line — see supabase/migrations/0037_vapi_inbound_numbers.sql.
//
// Shared by app/api/customer/phone-numbers/vapi/route.ts (a signed-in
// customer clicking "Få nummer", or the wizard's phone step) and
// provisionVapiNumbersForNewlyPaidCustomer below (auto-assignment right
// after a Stripe payment, driven from the webhook). Both callers are
// expected to have already checked the customer has an active subscription —
// this function itself only guards against double-provisioning the same
// widget.
export async function provisionVapiNumberForWidget(params: ProvisionVapiNumberParams): Promise<PhoneNumber> {
  const supabase = getAdminClient();
  const { customerId, widget } = params;

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
    // Attaching one the platform already owns is preferred wherever the
    // customer picked one: Vapi's free allowance is a single number, so a
    // number already paid for is worth more than a new one.
    number = params.vapiPhoneNumberId
      ? await attachExistingNumber(params.vapiPhoneNumberId, assistantId)
      : await createVapiManagedNumber({
          assistantId,
          name: params.label ?? widget.name,
          areaCode: params.areaCode,
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
      label: params.label ?? null,
      vapi_phone_number_id: number.id,
      phone_number: number.number,
    })
    .select(PHONE_NUMBER_CLIENT_COLUMNS)
    .single<PhoneNumber>();
  if (error) throw error;

  await writeAuditLog({
    actorId: params.actor?.userId,
    actorRole: params.actor?.role,
    customerId,
    action: "phone_number.vapi_assigned",
    entityType: "phone_number",
    entityId: phoneNumber.id,
    metadata: { widgetId: widget.id, phoneNumber: phoneNumber.phone_number, auto: !params.actor },
  });

  return phoneNumber;
}

// Called right after a customer's subscription becomes active (Stripe webhook
// — see app/api/webhooks/stripe/route.ts) and from the Inbound page's own
// return-from-checkout render (app/dashboard/inbound/page.tsx), same
// belt-and-suspenders pattern as grantWidgetLaunchCredits: whichever gets
// there first wins, the other is a no-op.
//
// A phone (Telefon) agent can be built and tested for free during the trial
// (see the wizard's phone step), but the number itself is gated on payment —
// so a customer who set one up before subscribing is sitting with a
// ready-to-go agent and no number. This is what closes that gap: every phone
// agent that doesn't have a live Vapi number yet gets one, the moment there is
// a subscription to justify it.
export async function provisionVapiNumbersForNewlyPaidCustomer(customerId: string): Promise<void> {
  const supabase = getAdminClient();

  const { data: widgets, error } = await supabase
    .from("widgets")
    .select("id, name")
    .eq("customer_id", customerId)
    .eq("agent_type", "phone");
  if (error || !widgets || widgets.length === 0) return;

  const { data: numbered } = await supabase
    .from("phone_numbers")
    .select("widget_id")
    .eq("customer_id", customerId)
    .eq("source", "vapi")
    .is("released_at", null);
  const alreadyNumbered = new Set((numbered ?? []).map((row) => row.widget_id));

  for (const widget of widgets) {
    if (alreadyNumbered.has(widget.id)) continue;
    try {
      await provisionVapiNumberForWidget({ customerId, widget });
    } catch (err) {
      // Never let one widget's failure (or a re-run finding the number
      // already there — provisionVapiNumberForWidget's own guard throws a
      // plain ApiError for that) stop the others, and never let it bubble
      // into the Stripe webhook as a 500: the payment itself already
      // succeeded and must not be retried over this.
      console.error(`Auto-provisioning a Vapi number failed for widget ${widget.id}:`, err);
    }
  }
}
