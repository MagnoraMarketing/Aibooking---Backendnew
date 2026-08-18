import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, rateLimit, getClientIp, widgetRelayTokenSchema } from "@/lib/security";
import { getWidgetBundleByPublicId } from "@/lib/widgets";
import { checkAndRefillIfNeeded } from "@/lib/credits";
import { createUsageSession } from "@/lib/usage";
import { createVoiceAccessToken } from "@/lib/twilio";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Twilio ConversationRelay's browser-side entry point — the counterpart to
// /api/widget/session's `mode: "vapi"` branch, but for the twilio_relay
// engine (see 0024_twilio_conversation_relay.sql). Creates the
// conversation/usage session up front, exactly like the Vapi path, then
// mints a short-lived Twilio Voice access token so the browser can place
// its "call" via the Twilio Voice SDK. Deliberately returns `publicId`, not
// the widget's internal id — see lib/widgets/config.ts's module comment on
// PublicWidgetConfig for why internal ids never reach the browser; the
// relay-start webhook (app/api/telephony/twilio/voice/relay-start) resolves
// the internal widget/customer ids itself from publicId once Twilio calls it.
export const POST = withErrorHandling(async (request) => {
  const ip = getClientIp(request.headers);
  const { allowed } = rateLimit(`widget-relay-token:${ip}`, { limit: 20, windowMs: 60_000 });
  if (!allowed) throw ApiError.tooManyRequests();

  const body = await readJsonBody(request, widgetRelayTokenSchema);
  const bundle = await getWidgetBundleByPublicId(body.publicId);
  if (!bundle) throw ApiError.notFound("Widget not found");
  if (bundle.llmModel?.provider !== "twilio_relay") {
    throw ApiError.badRequest("This widget is not configured for Twilio Voice Relay");
  }
  if (bundle.widget.status !== "active" || bundle.customer.status !== "active") {
    throw ApiError.notFound("Widget unavailable");
  }

  const refill = await checkAndRefillIfNeeded(bundle.customer.id);
  if (refill.balanceSeconds <= 0) {
    throw ApiError.paymentRequired("This assistant is temporarily unavailable — no minutes remaining");
  }

  const supabase = getAdminClient();
  const { data: conversation, error } = await supabase
    .from("conversations")
    .insert({ widget_id: bundle.widget.id, customer_id: bundle.customer.id, status: "active" })
    .select("*")
    .single();

  if (error) throw error;

  const usageSession = await createUsageSession({
    customerId: bundle.customer.id,
    widgetId: bundle.widget.id,
    conversationId: conversation.id,
  });

  const token = createVoiceAccessToken(`widget-${bundle.widget.id}-${usageSession.id}`);

  return NextResponse.json(
    {
      token,
      publicId: body.publicId,
      sessionId: usageSession.id,
      conversationId: conversation.id,
      openingMessage: bundle.widget.opening_message,
    },
    { status: 201 }
  );
});
