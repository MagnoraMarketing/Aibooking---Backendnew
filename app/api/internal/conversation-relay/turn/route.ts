import { NextResponse } from "next/server";
import { requireInternalSecret, readJsonBody, withErrorHandling, internalConversationRelayTurnSchema } from "@/lib/security";
import { getWidgetBundleById } from "@/lib/widgets";
import { generateConversationReplyText } from "@/lib/conversation/handle-turn";
import type { KnowledgeBaseSource } from "@/lib/knowledge-base/types";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Called by relay-server/ (the standalone ConversationRelay WebSocket
// service) once per finished caller utterance. Not reachable from the
// browser or from Twilio directly — see requireInternalSecret's module
// comment. Reuses the exact same AI/knowledge-base/Cal.com-booking logic the
// phone and text-widget pipelines already run (generateConversationReplyText,
// extracted from handleConversationTurn in lib/conversation/handle-turn.ts),
// just without the TTS synthesis step — Twilio's own TTS speaks the
// returned text.
export const POST = withErrorHandling(async (request) => {
  requireInternalSecret(request);
  const body = await readJsonBody(request, internalConversationRelayTurnSchema);

  const bundle = await getWidgetBundleById(body.widgetId);
  if (!bundle || !bundle.llmModel || bundle.llmModel.provider !== "twilio_relay") {
    throw ApiError.badRequest("Widget is not configured for Twilio Voice Relay");
  }
  if (bundle.customer.id !== body.customerId) {
    throw ApiError.badRequest("Customer/widget mismatch");
  }

  const { replyText } = await generateConversationReplyText({
    widget: bundle.widget,
    llmModel: bundle.llmModel,
    usageSessionId: body.usageSessionId,
    conversationId: body.conversationId,
    customerId: body.customerId,
    userMessage: body.userText,
    knowledgeBase: (bundle.extra.knowledgeBase as KnowledgeBaseSource[] | undefined) ?? [],
  });

  return NextResponse.json({ text: replyText });
});
