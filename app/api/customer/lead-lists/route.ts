import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, leadListInputSchema } from "@/lib/security";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("lead_lists")
    .select("*, leads(count)")
    .eq("customer_id", ctx.profile.customer_id!)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return NextResponse.json({ lists: data });
});

// Creates a lead list with its leads in one shot — nothing further needed
// before the dialer can start calling through it (unlike outbound
// campaigns' draft/launch split, there's no "launch" step here: a human
// dials each lead individually, whenever they're ready).
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, leadListInputSchema);
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const { data: list, error } = await supabase
    .from("lead_lists")
    .insert({ customer_id: customerId, name: body.name })
    .select("*")
    .single();
  if (error) throw error;

  const { error: leadsError } = await supabase.from("leads").insert(
    body.leads.map((lead) => ({
      list_id: list.id,
      customer_id: customerId,
      phone_number: lead.phoneNumber,
      contact_name: lead.name ?? null,
      company: lead.company ?? null,
    }))
  );

  if (leadsError) {
    // Don't leave an empty list behind if the leads failed to save.
    await supabase.from("lead_lists").delete().eq("id", list.id);
    throw leadsError;
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "lead_list.created",
    entityType: "lead_list",
    entityId: list.id,
    metadata: { leadCount: body.leads.length },
  });

  return NextResponse.json({ list }, { status: 201 });
});
