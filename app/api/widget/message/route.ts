import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, rateLimit, getClientIp, widgetMessageSchema } from "@/lib/security";
import { getWidgetBundleById } from "@/lib/widgets";
import { checkAndRefillIfNeeded } from "@/lib/credits";
import { handleConversationTurn } from "@/lib/conversation/handle-turn";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request) => {
  const body = await readJsonBody(request, widgetMessageSchema);

  const { allowed } = rateLimit(`widget-message:${body.sessionId}`, { limit: 30, windowMs: 60_000 });
  if (!allowed) throw ApiError.tooManyRequests();

  const supabase = getAdminClient();

  const { data: usageSession, error } = await supabase
    .from("usage_sessions")
    .select("*")
    .eq("id", body.sessionId)
    .maybeSingle();

  if (error) throw error;
  if (!usageSession || usageSession.conversation_id !== body.conversationId) {
    throw ApiError.notFound("Session not found");
  }
  if (usageSession.ended_at) {
    throw ApiError.badRequest("This session has already ended");
  }

  const refill = await checkAndRefillIfNeeded(usageSession.customer_id);
  if (refill.balanceSeconds <= 0) {
    throw ApiError.paymentRequired("No minutes remaining on this account");
  }

  const bundle = await getWidgetBundleById(usageSession.widget_id);
  if (!bundle || !bundle.llmModel || !bundle.voiceModel) {
    throw ApiError.badRequest("Widget is not fully configured");
  }
  if (bundle.widget.status !== "active" || bundle.customer.status !== "active") {
    throw ApiError.notFound("Widget unavailable");
  }

  const result = await handleConversationTurn({
    widget: bundle.widget,
    llmModel: bundle.llmModel,
    voiceModel: bundle.voiceModel,
    usageSessionId: usageSession.id,
    conversationId: body.conversationId,
    customerId: usageSession.customer_id,
    userMessage: body.message,
    clientDurationSeconds: body.clientDurationSeconds,
  });

  return NextResponse.json({
    reply: result.replyText,
    audioBase64: result.audioBase64,
    audioContentType: result.audioContentType,
  });
});
