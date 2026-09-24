import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog, requireParam } from "@/lib/security";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

// Settings the copy carries over — everything that describes the campaign,
// nothing that describes what happened to it.
const COPIED_COLUMNS = [
  "widget_id",
  "phone_number_id",
  "agent_instruction",
  "voicemail_message",
  "call_window_start",
  "call_window_end",
  "call_days",
  "call_timezone",
  "max_concurrent_calls",
  "max_attempts",
  "retry_after_minutes",
  "retry_rules",
] as const;

// "Dupliker": a new draft with the same agent, number, settings and
// contacts, and none of the results — every contact starts fresh, so the
// copy can be reviewed and launched like any new campaign.
export const POST = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;
  const campaignId = requireParam(params, "id");
  const supabase = getAdminClient();

  const { data: source, error } = await supabase.from("outbound_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (error) throw error;
  if (!source || source.customer_id !== customerId) throw ApiError.notFound("Campaign not found");

  const copy: Record<string, unknown> = { customer_id: customerId, name: `${source.name} (kopi)`.slice(0, 200) };
  for (const column of COPIED_COLUMNS) copy[column] = source[column];

  const { data: campaign, error: insertError } = await supabase.from("outbound_campaigns").insert(copy).select("*").single();
  if (insertError) throw insertError;

  const { data: contacts, error: contactsError } = await supabase
    .from("outbound_campaign_contacts")
    .select("phone_number, contact_name, company, email, custom_data")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  if (contactsError) throw contactsError;

  if (contacts && contacts.length > 0) {
    const { error: copyError } = await supabase
      .from("outbound_campaign_contacts")
      .insert(contacts.map((contact) => ({ ...contact, campaign_id: campaign.id })));
    if (copyError) {
      await supabase.from("outbound_campaigns").delete().eq("id", campaign.id);
      throw copyError;
    }
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "outbound_campaign.duplicated",
    entityType: "outbound_campaign",
    entityId: campaign.id,
    metadata: { sourceCampaignId: campaignId, contactCount: contacts?.length ?? 0 },
  });

  return NextResponse.json({ campaign }, { status: 201 });
});
