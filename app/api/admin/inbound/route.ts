import { NextResponse } from "next/server";
import type { z } from "zod";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, createAdminWidgetSchema } from "@/lib/security";
import { createAdminWidget } from "@/lib/admin/widget-service";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Inbound is not a separate resource — an "inbound agent" (spec section 7)
// is simply a widgets row with agent_type='phone', same table the customer
// dashboard's own /dashboard/inbound reads (see 0036_agent_type.sql). This
// route is the admin, cross-customer view of exactly that slice, joined with
// the phone number and Wapi agent each one is connected to.
export const GET = withErrorHandling(async (request) => {
  await requireMasterAdmin();
  const supabase = getAdminClient();
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId");

  let query = supabase
    .from("widgets")
    .select("*, customers(id, name, email), wapi_agents(id, wapi_agent_id, name), phone_numbers(id, phone_number, purchase_status)")
    .eq("agent_type", "phone")
    .order("created_at", { ascending: false });

  if (customerId) query = query.eq("customer_id", customerId);

  const { data, error } = await query;
  if (error) throw error;

  return NextResponse.json({ inboundAgents: data ?? [] });
});

// Creates an inbound agent — the same creation path as a Voice Widget (see
// lib/admin/widget-service.ts), with agentType forced to "phone" regardless
// of what the client sent, since this endpoint's entire purpose is that
// distinction.
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, createAdminWidgetSchema);
  // See the matching comment in app/api/admin/widgets/route.ts — body's
  // static type understates what z.parse() actually guarantees at runtime.
  const result = await createAdminWidget(
    { ...(body as z.infer<typeof createAdminWidgetSchema>), agentType: "phone" },
    { userId: ctx.userId, role: ctx.profile.role }
  );

  return NextResponse.json(
    { widget: result.widget, shareUrl: result.shareUrl, embedSnippet: result.embedSnippet, vapiSync: result.vapiSync },
    { status: 201 }
  );
});
