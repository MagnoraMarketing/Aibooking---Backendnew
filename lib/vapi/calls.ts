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
  // The lead's own fields — name, company and every extra CSV column — so
  // the agent's prompt can say "{{name}}" and "{{company}}" (Vapi fills
  // {{…}} placeholders from variableValues). See lib/outbound/csv.ts.
  variables?: Record<string, string>;
  // Spoken instead of a conversation when the call reaches a voicemail box.
  // Unset leaves the assistant's own voicemail behaviour as it is.
  voicemailMessage?: string | null;
}

export async function createOutboundCall(params: CreateOutboundCallParams): Promise<{ id: string }> {
  const instruction = params.campaignInstruction?.trim();
  const voicemailMessage = params.voicemailMessage?.trim();
  const variables = params.variables && Object.keys(params.variables).length > 0 ? params.variables : null;

  const assistantOverrides: Record<string, unknown> = {};
  if (instruction) {
    // Appended, not replaced: the agent keeps its own prompt, knowledge and
    // manner, and this says what it is ringing about.
    assistantOverrides.model = {
      messages: [{ role: "system", content: `### Formålet med dette opkald\n${instruction}` }],
    };
  }
  if (variables) assistantOverrides.variableValues = variables;
  if (voicemailMessage) assistantOverrides.voicemailMessage = voicemailMessage;

  const body = (withAnalysis: boolean) =>
    JSON.stringify({
      assistantId: params.assistantId,
      phoneNumberId: params.phoneNumberId,
      customer: {
        number: params.customerNumber,
        ...(variables?.name ? { name: variables.name.slice(0, 40) } : {}),
      },
      ...(withAnalysis || Object.keys(assistantOverrides).length > 0
        ? { assistantOverrides: { ...assistantOverrides, ...(withAnalysis ? { analysisPlan: OUTCOME_ANALYSIS_PLAN } : {}) } }
        : {}),
    });

  // The outcome classification is a nicety: if Vapi ever refuses it (a
  // renamed field, a stricter schema check), the call goes out without it
  // rather than not at all. Any other refusal is the caller's to handle.
  let response: Response;
  try {
    response = await vapiFetch("/call", { method: "POST", body: body(true) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/\(400\)/.test(message) || !/analysis|structured/i.test(message)) throw err;
    console.error("[vapi] analysisPlan override refused, placing the call without it:", message);
    response = await vapiFetch("/call", { method: "POST", body: body(false) });
  }
  const data = (await response.json()) as { id: string };
  return { id: data.id };
}

// Asks Vapi's end-of-call analysis to classify every campaign call into one
// of the outcomes the dashboard counts (lib/outbound/outcome.ts reads it
// back from analysis.structuredData.outcome). Without it a picked-up call
// can only ever be "answered".
export const OUTCOME_ANALYSIS_PLAN = {
  structuredDataPlan: {
    enabled: true,
    schema: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          enum: ["interested", "meeting_booked", "callback", "not_interested", "wrong_number", "do_not_call", "other"],
          description:
            "The result of the call: interested (wants to know more), meeting_booked (a meeting or appointment was booked), callback (asked to be called at another time), not_interested, wrong_number (not the intended person or business), do_not_call (explicitly asked never to be called again), other.",
        },
      },
      required: ["outcome"],
    },
  },
} as const;

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
