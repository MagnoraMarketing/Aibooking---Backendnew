import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog, requireParam, readJsonBody, uberDirectInputSchema } from "@/lib/security";
import { loadOwnedWidget } from "@/lib/shopify/connection";
import { mergeUberDirectInput, removeUberDirect, summarizeUberDirect } from "@/lib/uber-direct/connection";
import { getPublicAppUrl } from "@/lib/app-url";
import { syncWidgetToVapiAssistant } from "@/lib/vapi";
import { ApiError } from "@/types/errors";
import type { Widget } from "@/types/database";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Status, save and remove for one agent's Uber Direct delivery setup. The
// customer pastes the credentials from their own Uber Direct dashboard;
// secrets are encrypted on the way in and never sent back.

async function loadExtra(widgetId: string): Promise<Record<string, unknown>> {
  const { data } = await getAdminClient().from("widget_settings").select("extra").eq("widget_id", widgetId).maybeSingle();
  return (data?.extra as Record<string, unknown> | null) ?? {};
}

function webhookUrl(widgetId: string): string {
  return `${getPublicAppUrl().replace(/\/+$/, "")}/api/webhooks/uber-direct/${widgetId}`;
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
  return NextResponse.json({
    uberDirect: summarizeUberDirect(await loadExtra(widgetId)),
    webhookUrl: webhookUrl(widgetId),
  });
});

export const PUT = withErrorHandling(async (request, { params }) => {
  const { ctx, widgetId, customerId } = await requireOwnedWidget(params);
  const body = await readJsonBody(request, uberDirectInputSchema);

  const current = await loadExtra(widgetId);
  const hasSecret = Boolean(summarizeUberDirect(current)?.hasClientSecret);
  if (!body.clientSecret && !hasSecret) {
    throw ApiError.badRequest("Client secret er påkrævet første gang Uber Direct sættes op.");
  }

  const extra = mergeUberDirectInput(current, body);
  const { error } = await getAdminClient().from("widget_settings").upsert({ widget_id: widgetId, extra });
  if (error) throw error;

  await resync(widgetId, extra);
  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "uber_direct.configured",
    entityType: "widget",
    entityId: widgetId,
    metadata: { enabled: body.enabled },
  });

  return NextResponse.json({ uberDirect: summarizeUberDirect(extra), webhookUrl: webhookUrl(widgetId) });
});

export const DELETE = withErrorHandling(async (_request, { params }) => {
  const { ctx, widgetId, customerId } = await requireOwnedWidget(params);

  const extra = removeUberDirect(await loadExtra(widgetId));
  const { error } = await getAdminClient().from("widget_settings").upsert({ widget_id: widgetId, extra });
  if (error) throw error;

  await resync(widgetId, extra);
  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "uber_direct.removed",
    entityType: "widget",
    entityId: widgetId,
  });

  return NextResponse.json({ success: true });
});
