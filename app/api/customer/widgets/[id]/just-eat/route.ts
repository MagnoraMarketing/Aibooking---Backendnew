import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog, requireParam, readJsonBody, justEatInputSchema } from "@/lib/security";
import { loadOwnedWidget } from "@/lib/shopify/connection";
import { justEatWebhookToken, mergeJustEatInput, removeJustEat, summarizeJustEat } from "@/lib/just-eat/connection";
import { getPublicAppUrl } from "@/lib/app-url";
import { syncWidgetToVapiAssistant } from "@/lib/vapi";
import { ApiError } from "@/types/errors";
import type { Widget } from "@/types/database";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Status, save and remove for one agent's Just Eat (JET Go) delivery setup.
// The customer pastes the API key from their Just Eat partner account; it is
// encrypted on the way in and never sent back. Mirrors ../uber-direct.

async function loadExtra(widgetId: string): Promise<Record<string, unknown>> {
  const { data } = await getAdminClient().from("widget_settings").select("extra").eq("widget_id", widgetId).maybeSingle();
  return (data?.extra as Record<string, unknown> | null) ?? {};
}

// Only the owner sees it: the token in it is what lets Just Eat post status.
function webhookUrl(widgetId: string, extra: Record<string, unknown>): string | null {
  const token = justEatWebhookToken(extra);
  if (!token) return null;
  return `${getPublicAppUrl().replace(/\/+$/, "")}/api/webhooks/just-eat/${widgetId}?token=${token}`;
}

// Pushes the delivery tools on or off the agent's voice assistant.
async function resync(widgetId: string, extra: Record<string, unknown>): Promise<void> {
  const { data: widget } = await getAdminClient().from("widgets").select("*").eq("id", widgetId).maybeSingle();
  if (widget) await syncWidgetToVapiAssistant(widget as Widget, extra);
}

async function requireOwnedWidget(params: Record<string, string | undefined>) {
  const ctx = await requireCustomerAdmin();
  const widgetId = requireParam(params, "id");
  const widget = await loadOwnedWidget(getAdminClient(), widgetId, ctx.profile.customer_id!);
  if (!widget) throw ApiError.notFound("Widget not found");
  return { ctx, widgetId, customerId: widget.customer_id };
}

export const GET = withErrorHandling(async (_request, { params }) => {
  const { widgetId } = await requireOwnedWidget(params);
  const extra = await loadExtra(widgetId);
  return NextResponse.json({ justEat: summarizeJustEat(extra), webhookUrl: webhookUrl(widgetId, extra) });
});

export const PUT = withErrorHandling(async (request, { params }) => {
  const { ctx, widgetId, customerId } = await requireOwnedWidget(params);
  const body = await readJsonBody(request, justEatInputSchema);

  const current = await loadExtra(widgetId);
  if (!body.apiKey && !summarizeJustEat(current)?.hasApiKey) {
    throw ApiError.badRequest("API-nøglen fra Just Eat er påkrævet første gang Just Eat sættes op.");
  }

  const extra = mergeJustEatInput(current, body);
  const { error } = await getAdminClient().from("widget_settings").upsert({ widget_id: widgetId, extra });
  if (error) throw error;

  await resync(widgetId, extra);
  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "just_eat.configured",
    entityType: "widget",
    entityId: widgetId,
    metadata: { enabled: body.enabled },
  });

  return NextResponse.json({ justEat: summarizeJustEat(extra), webhookUrl: webhookUrl(widgetId, extra) });
});

export const DELETE = withErrorHandling(async (_request, { params }) => {
  const { ctx, widgetId, customerId } = await requireOwnedWidget(params);

  const extra = removeJustEat(await loadExtra(widgetId));
  const { error } = await getAdminClient().from("widget_settings").upsert({ widget_id: widgetId, extra });
  if (error) throw error;

  await resync(widgetId, extra);
  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "just_eat.removed",
    entityType: "widget",
    entityId: widgetId,
  });

  return NextResponse.json({ success: true });
});
