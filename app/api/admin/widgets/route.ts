import { NextResponse } from "next/server";
import type { z } from "zod";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, createAdminWidgetSchema } from "@/lib/security";
import { buildShareUrl, buildEmbedSnippet } from "@/lib/widgets";
import { createAdminWidget } from "@/lib/admin/widget-service";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Cross-customer Voice Widgets table (app/admin/widgets) — every widget on
// the platform, joined with the customer, cached Wapi agent and any phone
// number it owns, so the admin table doesn't need N follow-up requests.
export const GET = withErrorHandling(async (request) => {
  await requireMasterAdmin();
  const supabase = getAdminClient();
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId");
  const agentType = searchParams.get("agentType");
  const deploymentType = searchParams.get("deploymentType");
  const wapiAgentId = searchParams.get("wapiAgentId");

  let query = supabase
    .from("widgets")
    .select("*, customers(id, name, email), wapi_agents(id, wapi_agent_id, name), phone_numbers(id, phone_number)")
    .order("created_at", { ascending: false });

  if (customerId) query = query.eq("customer_id", customerId);
  if (agentType) query = query.eq("agent_type", agentType);
  if (deploymentType) query = query.eq("deployment_type", deploymentType);
  if (wapiAgentId) query = query.eq("wapi_agent_id", wapiAgentId);

  const { data, error } = await query;
  if (error) throw error;

  const widgets = (data ?? []).map((w) => ({
    ...w,
    shareUrl: buildShareUrl(w.public_id),
    embedSnippet: buildEmbedSnippet(w.public_id),
  }));

  return NextResponse.json({ widgets });
});

// Create a Voice Widget or Inbound agent from the admin Control Center (spec
// sections 4 and 8) — picking "AIbooking website" as the deployment type
// resolves to the reserved internal customer server-side rather than trusting
// a client-sent id for it. See lib/admin/widget-service.ts.
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, createAdminWidgetSchema);
  // readJsonBody<T>'s inference lands on the schema's *input* type (fields
  // with a `.default()`, like `name`, are optional there) rather than its
  // parsed output — but z.parse() (which readJsonBody calls) always applies
  // defaults, so at runtime `body` already matches the output type exactly.
  const result = await createAdminWidget(body as z.infer<typeof createAdminWidgetSchema>, {
    userId: ctx.userId,
    role: ctx.profile.role,
  });

  return NextResponse.json({ widget: result.widget, shareUrl: result.shareUrl, embedSnippet: result.embedSnippet }, { status: 201 });
});
