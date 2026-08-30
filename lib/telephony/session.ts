import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { createUsageSession } from "@/lib/usage";

export interface PhoneCallSession {
  conversationId: string;
}

// Twilio retries a webhook it considers failed (a timeout, a 5xx, a
// connection reset), and it retries with the same CallSid. Both call-start
// handlers used to answer that with a plain INSERT, which the unique index
// on conversations.twilio_call_sid (0019_twilio_direct_voice.sql) rejects —
// so a retry that should have recovered the call instead hung up on a live
// caller with "der opstod en teknisk fejl". Resuming the conversation the
// first attempt already created makes the retry do what the caller expects,
// and keeps one call to exactly one conversation and one usage session
// (i.e. one billed session, not two).
export async function startOrResumePhoneCallSession(params: {
  callSid: string;
  widgetId: string;
  customerId: string;
}): Promise<PhoneCallSession | null> {
  const supabase = getAdminClient();

  const existing = await findConversationByCallSid(params.callSid);
  if (existing) {
    // A retry after the first attempt got as far as the conversation but no
    // further leaves a conversation with no usage session at all, which the
    // turn handler reads as "already finished" and hangs up on. Only a
    // conversation that never got one is given one here — a session that
    // exists and has already ended means the call really is over.
    const { count } = await supabase
      .from("usage_sessions")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", existing);

    if (count === 0) {
      const created = await createSessionForConversation({ ...params, conversationId: existing });
      if (!created) return null;
    }

    return { conversationId: existing };
  }

  const { data: conversation, error } = await supabase
    .from("conversations")
    .insert({
      widget_id: params.widgetId,
      customer_id: params.customerId,
      status: "active",
      channel: "phone",
      twilio_call_sid: params.callSid,
    })
    .select("id")
    .single();

  if (error || !conversation) {
    // 23505 = unique violation: a concurrent retry won the race between the
    // lookup above and this insert. That row is exactly what we wanted, so
    // adopt it rather than failing the call.
    if (error?.code === "23505") {
      const raced = await findConversationByCallSid(params.callSid);
      if (raced) return { conversationId: raced };
    }
    console.error("Failed to create phone conversation:", error);
    return null;
  }

  const created = await createSessionForConversation({ ...params, conversationId: conversation.id });
  if (!created) return null;

  return { conversationId: conversation.id };
}

async function createSessionForConversation(params: {
  customerId: string;
  widgetId: string;
  conversationId: string;
}): Promise<boolean> {
  try {
    await createUsageSession({
      customerId: params.customerId,
      widgetId: params.widgetId,
      conversationId: params.conversationId,
    });
    return true;
  } catch (err) {
    // createUsageSession throws; letting that escape would return a 500 to
    // Twilio, which drops the caller into its own generic error message.
    // Without a session the turn handler can't bill, so end the call
    // ourselves — with our own wording — instead.
    console.error("Failed to create usage session for phone call:", err);
    return false;
  }
}

async function findConversationByCallSid(callSid: string): Promise<string | null> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("conversations")
    .select("id")
    .eq("twilio_call_sid", callSid)
    .maybeSingle();

  return data?.id ?? null;
}
