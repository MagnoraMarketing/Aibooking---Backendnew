import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/database/admin";
import { deductPhoneCallCost } from "@/lib/credits";
import { executeBookingTool, resolveToolContext } from "@/lib/vapi/booking-tools";
import { findWidgetIdForAssistant } from "@/lib/vapi/assistant-owner";
import { executeShopifyTool, isShopifyToolName } from "@/lib/shopify/agent-tools";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Vapi doesn't sign webhook payloads (unlike Stripe) — it echoes back a
// shared secret configured on the assistant's server URL as the
// `x-vapi-secret` header. Compare with a fixed-time check since this is a
// bearer-style credential.
function isValidSecret(received: string | null, expected: string): boolean {
  if (!received) return false;
  const receivedBuf = Buffer.from(received);
  const expectedBuf = Buffer.from(expected);
  if (receivedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(receivedBuf, expectedBuf);
}

type SupabaseAdmin = ReturnType<typeof getAdminClient>;

// Whose agent a call belongs to.
//
// Normally the assistant it ran on: assistants are minted by us and stored
// on widget_settings.extra.vapiAssistantId. But that mapping can drift —
// a number re-pointed at another assistant in Vapi's own dashboard, or an
// agent's stored assistant changed while the number kept ringing the old
// one — and the lookup then finds nothing. It used to return here, so the
// call was neither recorded nor billed, and nothing said so.
//
// The number the call came in on is the second answer, and a good one: the
// platform assigns each number to one agent, so a call on it belongs to
// that agent's customer even when the assistant no longer matches.
// Attributing by the line beats dropping the call.
async function resolveCallOwner(
  supabase: SupabaseAdmin,
  assistantId: string,
  phoneNumberRow: { widget_id: string; customer_id: string; released_at: string | null } | null
): Promise<{ id: string; customer_id: string } | null> {
  const widgetId = await findWidgetIdForAssistant(assistantId, supabase);

  if (widgetId) {
    const { data: widget } = await supabase
      .from("widgets")
      .select("id, customer_id")
      .eq("id", widgetId)
      .maybeSingle();
    if (widget) return widget;
  }

  // A released number's agent is whoever had it last, which is no longer a
  // claim worth making about a live call.
  if (!phoneNumberRow || phoneNumberRow.released_at) return null;

  console.error(
    `Vapi assistant ${assistantId} matches no agent — attributing the call to the agent that owns the number it came in on (widget ${phoneNumberRow.widget_id}). The assistant on that number in Vapi and the one stored for the agent have drifted apart.`
  );
  return { id: phoneNumberRow.widget_id, customer_id: phoneNumberRow.customer_id };
}

// Phone calls (inbound + outbound, see 0013_phone_calling.sql) are billed
// from *here* rather than from our own start/end session calls, because —
// unlike the widget — nothing in our own backend is on the line for a phone
// call's start or end; Vapi is. This is this system's only source of truth
// for "how long did that call actually last".
async function recordAndBillCall(supabase: SupabaseAdmin, message: Record<string, unknown>): Promise<void> {
  const call = message.call as { id?: string; assistantId?: string; phoneNumberId?: string } | undefined;
  const callId = call?.id;
  const assistantId = call?.assistantId;
  const durationSeconds = Math.round(Number(message.durationSeconds) || 0);

  if (!callId || !assistantId || durationSeconds <= 0) return;

  // Idempotency: Vapi can redeliver webhooks, and phone_calls.vapi_call_id
  // is unique — never double-bill the same call.
  const { data: existing } = await supabase.from("phone_calls").select("id").eq("vapi_call_id", callId).maybeSingle();
  if (existing) return;

  // The line the call came in on. Looked up once: it is the row stored on
  // the call, and the fallback for whose agent this is.
  let phoneNumberRow: { id: string; widget_id: string; customer_id: string; released_at: string | null } | null = null;
  if (call?.phoneNumberId) {
    const { data } = await supabase
      .from("phone_numbers")
      .select("id, widget_id, customer_id, released_at")
      .eq("vapi_phone_number_id", call.phoneNumberId)
      .maybeSingle();
    phoneNumberRow = data ?? null;
  }

  const widget = await resolveCallOwner(supabase, assistantId, phoneNumberRow);
  if (!widget) {
    // Never silent. A call that reaches no agent is one nobody is billed for
    // and nobody can see happened — the three inbound calls this replaced
    // went unrecorded for half an hour before anyone noticed.
    console.error(
      `Vapi call ${callId} belongs to no agent we know (assistant ${assistantId}, number ${
        call?.phoneNumberId ?? "unknown"
      }) — not recorded, not billed.`
    );
    return;
  }

  const { data: contact } = await supabase
    .from("outbound_campaign_contacts")
    .select("id")
    .eq("vapi_call_id", callId)
    .maybeSingle();
  const direction = contact ? "outbound" : "inbound";

  const phoneNumberRowId = phoneNumberRow?.id ?? null;

  const { error: insertError } = await supabase.from("phone_calls").insert({
    customer_id: widget.customer_id,
    widget_id: widget.id,
    phone_number_id: phoneNumberRowId,
    campaign_contact_id: contact?.id ?? null,
    direction,
    vapi_call_id: callId,
    duration_seconds: durationSeconds,
    ended_reason: typeof message.endedReason === "string" ? message.endedReason : null,
  });
  if (insertError) {
    console.error("Failed to record phone call:", insertError.message);
    return;
  }

  if (contact) {
    await supabase.from("outbound_campaign_contacts").update({ status: "completed" }).eq("id", contact.id);
  }

  await deductPhoneCallCost({
    customerId: widget.customer_id,
    seconds: durationSeconds,
    description: `${direction === "outbound" ? "Udgående" : "Indgående"} opkald (${durationSeconds}s)`,
  }).catch((err) => {
    console.error("Failed to deduct phone call cost:", err);
  });
}

// Spoken back to the caller when a tool can't run at all. Deliberately says
// nothing happened rather than staying vague — the agent must never be able
// to read a failure as a completed booking.
const FAILED_TOOL_RESULT =
  "Handlingen kunne ikke gennemføres, og der blev ikke booket noget. Sig det ærligt til kunden og tilbyd at vende tilbage.";

interface VapiToolCall {
  id?: string;
  function?: { name?: string; arguments?: unknown };
  // Older deliveries put the name/arguments directly on the call.
  name?: string;
  arguments?: unknown;
}

// Vapi sends arguments as an object, but has historically sent a JSON string
// for some models — accept both rather than dropping the call.
function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

// Booking tools run here rather than at their own endpoint because this URL
// *is* the assistant's serverUrl (see lib/vapi/assistants.ts's webhookConfig)
// — it's where Vapi delivers tool calls, already behind the shared-secret
// check above. The customer/widget a tool may act on is resolved from the
// call's assistantId, never from the payload's own fields, so one customer's
// assistant can't reach another's calendar.
async function handleToolCalls(message: Record<string, unknown>): Promise<NextResponse> {
  const call = message.call as { assistantId?: string } | undefined;
  const assistantId = call?.assistantId;

  const rawCalls = (message.toolCallList ?? message.toolCalls) as VapiToolCall[] | undefined;
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const ctx = assistantId
    ? await resolveToolContext(assistantId).catch((err) => {
        console.error("Failed to resolve Vapi tool context:", err);
        return null;
      })
    : null;

  const results = await Promise.all(
    rawCalls.map(async (toolCall) => {
      const toolCallId = toolCall.id ?? "";
      const name = toolCall.function?.name ?? toolCall.name ?? "";

      // An assistant we can't map to a widget gets a spoken-safe refusal, not
      // a guess — the alternative would be acting without knowing whose
      // calendar we're touching.
      if (!ctx) {
        return { toolCallId, result: FAILED_TOOL_RESULT };
      }

      const args = parseToolArguments(toolCall.function?.arguments ?? toolCall.arguments);
      try {
        // Which widget's webshop a tool may read is taken from `ctx` — resolved
        // from the call's assistantId above — never from the tool arguments, so
        // one customer's agent cannot ask about another's orders.
        const result = isShopifyToolName(name)
          ? await executeShopifyTool(name, args, ctx.widgetId)
          : await executeBookingTool(name, args, ctx);
        return { toolCallId, result };
      } catch (err) {
        // Nothing thrown here may escape: an unhandled rejection would make
        // this a 500, and Vapi would be left mid-call with no tool result at
        // all. A wrong-but-honest answer beats a dead call.
        console.error(`Vapi tool ${name} threw:`, err);
        return { toolCallId, result: FAILED_TOOL_RESULT };
      }
    })
  );

  return NextResponse.json({ results });
}

// Vapi fires many event types per call (status-update, transcript chunks,
// end-of-call-report, tool-calls, etc.) — every delivery is logged to
// vapi_events for audit/debugging (see 0011_vapi_model.sql), and
// end-of-call-report specifically also drives billing (recordAndBillCall
// above).
export async function POST(request: Request): Promise<NextResponse> {
  const webhookSecret = process.env.VAPI_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 400 });
  }

  const receivedSecret = request.headers.get("x-vapi-secret");
  if (!isValidSecret(receivedSecret, webhookSecret)) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const message = (body as { message?: Record<string, unknown> } | null)?.message;
  if (!message) {
    return NextResponse.json({ error: "Missing message payload" }, { status: 400 });
  }

  const call = message.call as { id?: string } | undefined;
  const supabase = getAdminClient();

  const { error } = await supabase.from("vapi_events").insert({
    call_id: call?.id ?? null,
    type: typeof message.type === "string" ? message.type : null,
    payload: message,
  });

  const isToolCall = message.type === "tool-calls";

  if (error) {
    console.error("Failed to record vapi event:", error.message);
    // A tool call is the one event where a caller is mid-sentence waiting on
    // us, so a failed audit write must not take the call down with it: log it
    // and answer anyway. Every other event type is fire-and-forget, so a 500
    // there just asks Vapi to redeliver and keeps the audit log complete.
    if (!isToolCall) {
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }

  if (message.type === "end-of-call-report") {
    await recordAndBillCall(supabase, message);
  }

  // Unlike every other event, a tool call is synchronous: Vapi is waiting on
  // this response to continue the conversation, so it must carry the results.
  if (isToolCall) {
    return handleToolCalls(message);
  }

  return NextResponse.json({ received: true });
}
