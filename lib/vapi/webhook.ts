import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { Vapi } from "@vapi-ai/server-sdk";
import { getAdminClient } from "@/lib/database/admin";
import { vapiEnv } from "./env";

// Vapi's assistant.server config has no signature/secret field (unlike
// Stripe's HMAC scheme), so verification here is a shared secret we embed
// ourselves as a query param on the webhook URL we register with Vapi (see
// buildVapiWebhookUrl in lib/vapi/mapping.ts) and check on the way back in.
// If VAPI_WEBHOOK_SECRET isn't configured, requests are accepted
// unverified (matches this app's "fail open with a logged warning rather
// than break the endpoint" posture elsewhere) — set it in production.
export function verifyVapiWebhookSecret(providedSecret: string | null): boolean {
  const expected = vapiEnv.webhookSecret;
  if (!expected) return true;
  if (!providedSecret) return false;

  const a = Buffer.from(providedSecret);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface WidgetLink {
  id: string;
  customer_id: string;
}

async function resolveWidgetByAssistantId(assistantId: string): Promise<WidgetLink | null> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("widgets")
    .select("id, customer_id")
    .eq("vapi_assistant_id", assistantId)
    .maybeSingle<WidgetLink>();
  return data ?? null;
}

function durationSeconds(startedAt?: string, endedAt?: string): number | null {
  if (!startedAt || !endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return ms >= 0 ? Math.round(ms / 1000) : null;
}

async function upsertCallRow(assistantId: string, row: Record<string, unknown>): Promise<void> {
  const widget = await resolveWidgetByAssistantId(assistantId);
  // A webhook for an assistant we no longer have a widget link for (e.g.
  // the widget was later deleted) is not an error — just nothing to record.
  if (!widget) return;

  const supabase = getAdminClient();
  await supabase.from("vapi_calls").upsert(
    {
      ...row,
      widget_id: widget.id,
      customer_id: widget.customer_id,
      vapi_assistant_id: assistantId,
    },
    { onConflict: "vapi_call_id" }
  );
}

// Handles one Vapi server message. Only the event types this app actually
// stores something for are handled — everything else (function-call,
// transfer-update, etc.) is a deliberate no-op, not a bug: this app doesn't
// implement tools/transfers yet, so there's nothing to persist for them.
export async function handleVapiServerMessage(message: Vapi.ServerMessageMessage): Promise<void> {
  switch (message.type) {
    case "status-update": {
      const call = message.call;
      if (!call?.id || !call.assistantId) return;

      await upsertCallRow(call.assistantId, {
        vapi_call_id: call.id,
        status: message.status,
        ended_reason: message.endedReason ?? null,
        started_at: call.startedAt ?? null,
        ended_at: call.endedAt ?? null,
        customer_phone_number: call.customer?.number ?? null,
      });
      return;
    }

    case "end-of-call-report": {
      const call = message.call;
      if (!call?.id || !call.assistantId) return;

      await upsertCallRow(call.assistantId, {
        vapi_call_id: call.id,
        status: "ended",
        ended_reason: message.endedReason,
        started_at: message.startedAt ?? call.startedAt ?? null,
        ended_at: message.endedAt ?? call.endedAt ?? null,
        duration_seconds: durationSeconds(message.startedAt ?? call.startedAt, message.endedAt ?? call.endedAt),
        cost: message.cost ?? null,
        transcript: message.artifact?.transcript ?? null,
        summary: message.analysis?.summary ?? null,
        recording_url: message.artifact?.recordingUrl ?? null,
        customer_phone_number: call.customer?.number ?? null,
      });
      return;
    }

    default:
      return;
  }
}
