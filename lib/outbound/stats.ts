import "server-only";
import { getAdminClient } from "@/lib/database/admin";

// What a campaign amounts to, counted once for the whole page.
//
// The overview shows totals, outcomes, minutes and the last call for every
// campaign. Asking per campaign would be one query each plus one per contact
// list — a dozen campaigns and the page is doing thirty round-trips. Two
// queries answer it for all of them, and the grouping happens here.
//
// Nothing is stored: every number is derived from the contacts and the calls
// that actually happened, so it cannot drift out of step with them the way a
// counter column would.

export interface CampaignStats {
  total: number;
  called: number;
  pending: number;
  successful: number;
  failed: number;
  durationSeconds: number;
  lastCallAt: string | null;
}

export const EMPTY_STATS: CampaignStats = {
  total: 0,
  called: 0,
  pending: 0,
  successful: 0,
  failed: 0,
  durationSeconds: 0,
  lastCallAt: null,
};

export async function campaignStatsFor(
  campaignIds: string[],
  supabase: ReturnType<typeof getAdminClient> = getAdminClient()
): Promise<Record<string, CampaignStats>> {
  const stats: Record<string, CampaignStats> = {};
  if (campaignIds.length === 0) return stats;
  for (const id of campaignIds) stats[id] = { ...EMPTY_STATS };

  const { data: contacts } = await supabase
    .from("outbound_campaign_contacts")
    .select("id, campaign_id, status, last_called_at")
    .in("campaign_id", campaignIds);

  // Maps a contact back to its campaign, so the call rows — which know the
  // contact but not the campaign — can be counted against the right one.
  const campaignOfContact = new Map<string, string>();

  for (const contact of contacts ?? []) {
    const row = stats[contact.campaign_id];
    if (!row) continue;
    campaignOfContact.set(contact.id, contact.campaign_id);

    row.total += 1;
    // "Called" is anyone we have finished trying, either way — a contact
    // still ringing is neither called nor waiting.
    if (contact.status === "completed") {
      row.called += 1;
      row.successful += 1;
    } else if (contact.status === "failed") {
      row.called += 1;
      row.failed += 1;
    } else if (contact.status === "pending") {
      row.pending += 1;
    }

    if (contact.last_called_at && (!row.lastCallAt || contact.last_called_at > row.lastCallAt)) {
      row.lastCallAt = contact.last_called_at;
    }
  }

  // Minutes come from phone_calls, which is where a call's real duration is
  // recorded (by the Vapi webhook) and what the customer is billed on. Adding
  // them up here rather than storing a total keeps the two from disagreeing.
  const contactIds = [...campaignOfContact.keys()];
  if (contactIds.length > 0) {
    const { data: calls } = await supabase
      .from("phone_calls")
      .select("campaign_contact_id, duration_seconds")
      .in("campaign_contact_id", contactIds);

    for (const call of calls ?? []) {
      const campaignId = call.campaign_contact_id ? campaignOfContact.get(call.campaign_contact_id) : undefined;
      if (!campaignId) continue;
      stats[campaignId]!.durationSeconds += call.duration_seconds ?? 0;
    }
  }

  return stats;
}
