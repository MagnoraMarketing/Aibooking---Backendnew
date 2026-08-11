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
import { createUsageSession, finalizeUsageSession } from "@/lib/usage";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request) => {
  const ip = getClientIp(request.headers);
  const { allowed } = rateLimit(`widget-session-start:${ip}`, { limit: 20, windowMs: 60_000 });
  if (!allowed) throw ApiError.tooManyRequests();

  const body = await readJsonBody(request, widgetSessionStartSchema);
  const bundle = await getWidgetBundleByPublicId(body.publicId);
  if (!bundle) throw ApiError.notFound("Widget not found");
  if (!bundle.llmModel || !bundle.voiceModel) {
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

  return NextResponse.json(
    {
      sessionId: usageSession.id,
      conversationId: conversation.id,
      openingMessage: bundle.widget.opening_message,
    },
    { status: 201 }
  );
});

export const PATCH = withErrorHandling(async (request) => {
  const ip = getClientIp(request.headers);
  const { allowed } = rateLimit(`widget-session-end:${ip}`, { limit: 40, windowMs: 60_000 });
  if (!allowed) throw ApiError.tooManyRequests();

  const body = await readJsonBody(request, widgetSessionEndSchema);
  const session = await finalizeUsageSession(body.sessionId);

  return NextResponse.json({
    sessionId: session.id,
    billedDurationSeconds: session.billed_duration_seconds,
  });
});
