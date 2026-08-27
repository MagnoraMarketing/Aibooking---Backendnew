import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/database/admin";
import { deductPhoneCallCost } from "@/lib/credits";
import { executeBookingTool, resolveToolContext } from "@/lib/vapi/booking-tools";

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

  const { data: settingsRow } = await supabase
    .from("widget_settings")
    .select("widget_id")
    .eq("extra->>vapiAssistantId", assistantId)
    .maybeSingle();
  if (!settingsRow) return;

  const { data: widget } = await supabase
    .from("widgets")
    .select("id, customer_id")
    .eq("id", settingsRow.widget_id)
    .maybeSingle();
  if (!widget) return;

  const { data: contact } = await supabase
    .from("outbound_campaign_contacts")
    .select("id")
    .eq("vapi_call_id", callId)
    .maybeSingle();
  const direction = contact ? "outbound" : "inbound";

  let phoneNumberRowId: string | null = null;
  if (call?.phoneNumberId) {
    const { data: phoneNumberRow } = await supabase
      .from("phone_numbers")
      .select("id")
      .eq("vapi_phone_number_id", call.phoneNumberId)
      .maybeSingle();
    phoneNumberRowId = phoneNumberRow?.id ?? null;
  }

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

  const ctx = assistantId ? await resolveToolContext(assistantId) : null;

  const results = await Promise.all(
    rawCalls.map(async (toolCall) => {
      const toolCallId = toolCall.id ?? "";
      const name = toolCall.function?.name ?? toolCall.name ?? "";

      // An assistant we can't map to a widget gets a spoken-safe refusal, not
      // a guess — the alternative would be acting without knowing whose
      // calendar we're touching.
      if (!ctx) {
        return { toolCallId, result: "Systemet kunne ikke slå virksomheden op, så handlingen blev ikke udført." };
      }

      const args = parseToolArguments(toolCall.function?.arguments ?? toolCall.arguments);
      const result = await executeBookingTool(name, args, ctx);
      return { toolCallId, result };
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

  if (error) {
    console.error("Failed to record vapi event:", error.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  if (message.type === "end-of-call-report") {
    await recordAndBillCall(supabase, message);
  }

  // Unlike every other event, a tool call is synchronous: Vapi is waiting on
  // this response to continue the conversation, so it must carry the results.
  if (message.type === "tool-calls") {
    return handleToolCalls(message);
  }

  return NextResponse.json({ received: true });
}
