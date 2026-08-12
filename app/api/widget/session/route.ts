import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/database/admin";
import {
  readJsonBody,
  withErrorHandling,
  rateLimit,
  getClientIp,
  widgetSessionStartSchema,
  widgetSessionEndSchema,
} from "@/lib/security";
import { getWidgetBundleByPublicId } from "@/lib/widgets";
import { checkAndRefillIfNeeded } from "@/lib/credits";
import { createUsageSession, finalizeUsageSession, setUsageSessionDuration } from "@/lib/usage";
import { createRealtimeClientSecret } from "@/lib/realtime";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

const DEFAULT_REALTIME_INSTRUCTIONS =
  "Du er en hjælpsom AI-assistent. Tal naturligt og kortfattet på dansk.";

export const POST = withErrorHandling(async (request) => {
  const ip = getClientIp(request.headers);
  const { allowed } = rateLimit(`widget-session-start:${ip}`, { limit: 20, windowMs: 60_000 });
  if (!allowed) throw ApiError.tooManyRequests();

  const body = await readJsonBody(request, widgetSessionStartSchema);
  const bundle = await getWidgetBundleByPublicId(body.publicId);
  if (!bundle) throw ApiError.notFound("Widget not found");
  if (!bundle.llmModel) {
    throw ApiError.badRequest("Widget is not fully configured yet");
  }

  // "Expert model" (provider=openai) is speech-to-speech via OpenAI's own
  // Realtime API — it doesn't use our TTS pipeline or voice_models table.
  const isRealtime = bundle.llmModel.provider === "openai";
  if (!isRealtime && !bundle.voiceModel) {
    throw ApiError.badRequest("Widget is not fully configured yet");
  }

  const refill = await checkAndRefillIfNeeded(bundle.customer.id);
  if (refill.balanceSeconds <= 0) {
    throw ApiError.paymentRequired("This assistant is temporarily unavailable — no minutes remaining");
  }

  const supabase = getAdminClient();

  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .insert({ widget_id: bundle.widget.id, customer_id: bundle.customer.id, status: "active" })
    .select("*")
    .single();

  if (convError) throw convError;

  const usageSession = await createUsageSession({
    customerId: bundle.customer.id,
    widgetId: bundle.widget.id,
    conversationId: conversation.id,
  });

  if (isRealtime) {
    let realtimeSession;
    try {
      realtimeSession = await createRealtimeClientSecret({
        model: bundle.llmModel.model_name,
        instructions: bundle.widget.system_prompt ?? DEFAULT_REALTIME_INSTRUCTIONS,
      });
    } catch (err) {
      // Don't leave an orphaned usage session/conversation behind if OpenAI
      // is unreachable or misconfigured (e.g. OPENAI_API_KEY not set yet).
      await finalizeUsageSession(usageSession.id);
      throw err;
    }

    return NextResponse.json(
      {
        sessionId: usageSession.id,
        conversationId: conversation.id,
        openingMessage: bundle.widget.opening_message,
        mode: "realtime",
        realtime: {
          clientSecret: realtimeSession.clientSecret,
          model: realtimeSession.model,
          expiresAt: realtimeSession.expiresAt,
        },
      },
      { status: 201 }
    );
  }

  return NextResponse.json(
    {
      sessionId: usageSession.id,
      conversationId: conversation.id,
      openingMessage: bundle.widget.opening_message,
      mode: "text",
    },
    { status: 201 }
  );
});

export const PATCH = withErrorHandling(async (request) => {
  const ip = getClientIp(request.headers);
  const { allowed } = rateLimit(`widget-session-end:${ip}`, { limit: 40, windowMs: 60_000 });
  if (!allowed) throw ApiError.tooManyRequests();

  const body = await readJsonBody(request, widgetSessionEndSchema);

  if (body.clientMeasuredDurationSeconds !== undefined) {
    await setUsageSessionDuration(body.sessionId, body.clientMeasuredDurationSeconds);
  }

  const session = await finalizeUsageSession(body.sessionId);

  return NextResponse.json({
    sessionId: session.id,
    billedDurationSeconds: session.billed_duration_seconds,
  });
});
