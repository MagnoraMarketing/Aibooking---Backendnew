import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, requireParam } from "@/lib/security";
import { widgetUnavailableReason } from "@/lib/widgets";
import { ApiError } from "@/types/errors";
import type { Customer, Widget } from "@/types/database";

export const dynamic = "force-dynamic";

// The owner's view of "can this agent be reached from a website right now?".
//
// The public /api/widget/config answers every unavailable case with the same
// "Widget not found" — on purpose, so a website visitor can't tell a paused
// agent from a deleted account. That same answer told the owner nothing in
// the Test step: they saw "Widget not found" for an agent they were looking
// at. This route gives the owner the actual reason, and the dashboard turns
// it into a fix (turn the agent on, set up the voice assistant again, or
// contact support).
export type WidgetHealthStatus = "ok" | "widget_paused" | "customer_inactive" | "no_assistant";

export const GET = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const widgetId = requireParam(params, "id");
  const customerId = ctx.profile.customer_id!;

  const { data: widget, error } = await supabase.from("widgets").select("*").eq("id", widgetId).maybeSingle<Widget>();
  if (error) throw error;
  if (!widget || widget.customer_id !== customerId) throw ApiError.notFound("Widget not found");

  const [{ data: customer }, { data: settings }, { data: model }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", customerId).maybeSingle<Customer>(),
    supabase.from("widget_settings").select("extra").eq("widget_id", widget.id).maybeSingle(),
    widget.llm_model_id
      ? supabase.from("llm_models").select("provider").eq("id", widget.llm_model_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const extra = (settings?.extra as Record<string, unknown> | null) ?? {};
  const needsAssistant = (model as { provider?: string } | null)?.provider === "vapi";
  const hasAssistant = typeof extra.vapiAssistantId === "string" && extra.vapiAssistantId.length > 0;

  const status: WidgetHealthStatus =
    widgetUnavailableReason(widget, customer) ?? (needsAssistant && !hasAssistant ? "no_assistant" : "ok");

  return NextResponse.json({ status, widgetStatus: widget.status, updatedAt: widget.updated_at });
});
