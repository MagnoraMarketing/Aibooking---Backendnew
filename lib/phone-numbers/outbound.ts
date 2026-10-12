import type { PhoneNumber } from "@/types/database";

// Which of a customer's numbers a given agent can actually place a campaign
// call from.
//
// Outbound used to demand a number bound to that exact agent and refuse
// anything with direction='inbound'. Both rules outlived their reason. Every
// Vapi number this platform hands out is created as inbound (that is what a
// customer forwards their company line to — see
// app/api/customer/phone-numbers/vapi/route.ts), and it is one number per
// agent, so between them the two rules left most agents unable to run a
// campaign at all, with a number sitting right there unused. `direction` is
// bookkeeping about what a number is set up to answer, not a statement about
// what it can dial.
//
// What does decide it is the provider that places the call, which follows
// the agent's model (see the outbound launch route): a Vapi agent dials
// through Vapi and needs a number Vapi knows, while an older Anthropic agent
// dials through the customer's own Twilio subaccount and needs a Twilio one.
// Offering a combination that cannot work would fail per contact, deep inside
// a launched campaign, with the vendor's own wording.
export interface OutboundNumberContext {
  usesVapi: boolean;
}

export type OutboundCapableNumber = Pick<
  PhoneNumber,
  "purchase_status" | "released_at" | "vapi_phone_number_id" | "twilio_sid"
>;

// The reason this number cannot be dialled from, or null when it can.
export function outboundNumberIssue(
  phoneNumber: OutboundCapableNumber,
  { usesVapi }: OutboundNumberContext
): string | null {
  if (phoneNumber.released_at) return "Dette nummer er frigivet og kan ikke bruges.";
  if (phoneNumber.purchase_status !== "active") return "Dette telefonnummer er ikke aktivt endnu";

  if (usesVapi) {
    if (!phoneNumber.vapi_phone_number_id) {
      return "Dette nummer er ikke registreret i Vapi, så agenten kan ikke ringe ud fra det.";
    }
    return null;
  }

  if (!phoneNumber.twilio_sid) {
    return "Denne agent ringer ud gennem Twilio og kan ikke bruge et Vapi-nummer. Vælg et Twilio-nummer.";
  }
  return null;
}

export function canPlaceOutboundFrom(
  phoneNumber: OutboundCapableNumber,
  context: OutboundNumberContext
): boolean {
  return outboundNumberIssue(phoneNumber, context) === null;
}
