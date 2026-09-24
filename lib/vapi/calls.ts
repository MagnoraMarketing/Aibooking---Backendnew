import "server-only";
import { vapiFetch } from "./client";

export interface CreateOutboundCallParams {
  assistantId: string;
  phoneNumberId: string;
  customerNumber: string;
  // What this campaign is for, in the customer's words. Sent as an override
  // for these calls only — the assistant itself is never touched, so the
  // agent that answers the phone is unaffected by a campaign's wording.
  campaignInstruction?: string | null;
}

// The campaign's purpose as an addition to the assistant's own model.
//
// Vapi replaces `assistantOverrides.model` wholesale rather than merging it
// into the assistant's, so an override carrying only `messages` was refused
// outright ("model.provider must be one of…") — every campaign with an
// instruction failed every call. And had it been accepted, those messages
// would have replaced the agent's own prompt, not added to it. So the
// assistant's current model is read and sent back whole, with the
// campaign's message appended after its own.
//
// Null when the assistant's model can't be read: the call then goes out on
// the agent's own prompt alone, which is better than not going out at all.
async function modelWithCampaignInstruction(
  assistantId: string,
  instruction: string
): Promise<Record<string, unknown> | null> {
  try {
    const response = await vapiFetch(`/assistant/${encodeURIComponent(assistantId)}`, { method: "GET" });
    const assistant = (await response.json()) as { model?: Record<string, unknown> };
    const model = assistant.model;
    if (!model || typeof model.provider !== "string" || typeof model.model !== "string") return null;

    const messages = Array.isArray(model.messages) ? model.messages : [];
    return {
      ...model,
      messages: [...messages, { role: "system", content: `### Formålet med dette opkald\n${instruction}` }],
    };
  } catch (err) {
    console.error(`Could not read Vapi assistant ${assistantId} for a campaign instruction:`, String(err));
    return null;
  }
}

export async function createOutboundCall(params: CreateOutboundCallParams): Promise<{ id: string }> {
  const instruction = params.campaignInstruction?.trim();
  const model = instruction ? await modelWithCampaignInstruction(params.assistantId, instruction) : null;

  const response = await vapiFetch("/call", {
    method: "POST",
    body: JSON.stringify({
      assistantId: params.assistantId,
      phoneNumberId: params.phoneNumberId,
      customer: { number: params.customerNumber },
      ...(model ? { assistantOverrides: { model } } : {}),
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
  // A number bought on Vapi may only place so many calls a day. The count
  // resets, so this is the one refusal where waiting is a real answer — and
  // saying "vi kigger på det" would send the customer away for nothing.
  if (/daily outbound call limit/i.test(reason)) {
    return "Der er ringet ud det antal gange, nummeret tillader på én dag. Prøv igen i morgen, eller kontakt os, så sætter vi et nummer op uden den grænse.";
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
