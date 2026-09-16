import "server-only";
import { vapiFetch } from "./client";

export interface CreateOutboundCallParams {
  assistantId: string;
  phoneNumberId: string;
  customerNumber: string;
}

export async function createOutboundCall(params: CreateOutboundCallParams): Promise<{ id: string }> {
  const response = await vapiFetch("/call", {
    method: "POST",
    body: JSON.stringify({
      assistantId: params.assistantId,
      phoneNumberId: params.phoneNumberId,
      customer: { number: params.customerNumber },
    }),
  });
  const data = (await response.json()) as { id: string };
  return { id: data.id };
}

// What to tell the customer when a campaign call never got placed.
//
// The launch route used to return counts only, so a campaign whose every
// call was refused looked exactly like one that went out: status "launched",
// nothing on screen. The reason was in the database, in the provider's own
// English, where only we would ever read it.
//
// These are the refusals worth naming, because the customer's next move
// differs for each. Anything else stays generic on screen and keeps its raw
// text in outbound_campaign_contacts.failure_reason for us.
export function describeOutboundCallFailure(reason: string): string {
  // A free Vapi number places US calls only. That is a fact about the
  // platform's account, not the customer's campaign, and it fails every
  // single Danish number they will ever enter — so it has to say which
  // number is the problem, not just that something went wrong.
  if (/international calls/i.test(reason)) {
    return "Der kan kun ringes til amerikanske numre fra det valgte nummer. Vælg et andet nummer, eller kontakt os, så sætter vi et nummer op der kan ringe til danske numre.";
  }
  if (/credit card|payment method|billing/i.test(reason)) {
    return "Der kan ikke ringes ud lige nu. Vi er på sagen — kontakt os, hvis det haster.";
  }
  // Vapi's wording for a number it will not dial: a typo, a landline that
  // rejects the call, an unreachable country code.
  if (/invalid|not a valid|unreachable|is not valid/i.test(reason)) {
    return "Nummeret kunne ikke ringes op. Tjek at det er skrevet med landekode, fx +4512345678.";
  }
  return "Opkaldet kunne ikke startes. Vi har fået besked og kigger på det.";
}
