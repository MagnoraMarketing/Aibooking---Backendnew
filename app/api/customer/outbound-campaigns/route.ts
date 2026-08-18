import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, outboundCampaignInputSchema } from "@/lib/security";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("outbound_campaigns")
    .select("*, outbound_campaign_contacts(count)")
    .eq("customer_id", ctx.profile.customer_id!)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return NextResponse.json({ campaigns: data });
});

// Creates a campaign in "draft" status with its contact list — placing the
// actual calls is a separate step (POST .../[id]/launch), so a customer can
// review the list before anything goes out.
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, outboundCampaignInputSchema);
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const { data: widget, error: widgetError } = await supabase
    .from("widgets")
    .select("id, customer_id")
    .eq("id", body.widgetId)
    .maybeSingle();
  if (widgetError) throw widgetError;
  if (!widget || widget.customer_id !== customerId) throw ApiError.notFound("Widget not found");

  const { data: phoneNumber, error: phoneNumberError } = await supabase
    .from("phone_numbers")
    .select("id, customer_id")
    .eq("id", body.phoneNumberId)
    .maybeSingle();
  if (phoneNumberError) throw phoneNumberError;
  if (!phoneNumber || phoneNumber.customer_id !== customerId) {
    throw ApiError.notFound("Phone number not found");
  }

  const { data: campaign, error } = await supabase
    .from("outbound_campaigns")
    .insert({
      customer_id: customerId,
      widget_id: widget.id,
      phone_number_id: phoneNumber.id,
      name: body.name,
    })
    .select("*")
    .single();

  if (error) throw error;

  const { error: contactsError } = await supabase.from("outbound_campaign_contacts").insert(
    body.contacts.map((contact) => ({
      campaign_id: campaign.id,
      phone_number: contact.phoneNumber,
      contact_name: contact.name ?? null,
    }))
  );

  if (contactsError) {
    // Don't leave an empty campaign behind if the contact list failed to save.
    await supabase.from("outbound_campaigns").delete().eq("id", campaign.id);
    throw contactsError;
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "outbound_campaign.created",
    entityType: "outbound_campaign",
    entityId: campaign.id,
    metadata: { contactCount: body.contacts.length },
  });

  return NextResponse.json({ campaign }, { status: 201 });
});
