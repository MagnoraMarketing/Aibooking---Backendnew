import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { fetchCalcomEventTypes } from "./calcom";

// AIbooking's own website widgets (the reserved is_platform_owned customer,
// see lib/admin/aibooking-customer.ts) book into AIbooking's own Cal.com
// account, whose API key lives in the deployment's environment
// (CALCOM_API_KEY) rather than in a key pasted on the agent in the
// dashboard. A key pasted there once and since revoked used to be the only
// one the agent knew, so every booking on the website widget failed with
// "Ugyldig Cal.com API-nøgle" while a working key sat unused in Vercel.
//
// Only the platform's own widgets ever get this key: any other customer's
// callers would otherwise be booked into AIbooking's calendar.

export interface PlatformCalcomCredential {
  apiKey: string;
  eventTypeId: number;
  timezone: string;
}

function envEventTypeId(): number | null {
  const parsed = Number(process.env.CALCOM_EVENT_TYPE_ID?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function resolvePlatformCalcomCredential(
  customerId: string,
  widgetId: string
): Promise<PlatformCalcomCredential | null> {
  const apiKey = process.env.CALCOM_API_KEY?.trim();
  if (!apiKey) return null;

  const supabase = getAdminClient();
  const { data: customer } = await supabase
    .from("customers")
    .select("is_platform_owned")
    .eq("id", customerId)
    .maybeSingle();
  if (!customer?.is_platform_owned) return null;

  // The event type: CALCOM_EVENT_TYPE_ID, else the one chosen on the agent's
  // Cal.com connection (whatever its status — the stored key may be the
  // broken part, the chosen service is not), else the account's first.
  const { data: connection } = await supabase
    .from("calendar_connections")
    .select("calcom_event_type_id, calcom_timezone")
    .eq("widget_id", widgetId)
    .eq("provider", "calcom")
    .maybeSingle();

  const fromConnection = Number(connection?.calcom_event_type_id);
  let eventTypeId =
    envEventTypeId() ?? (Number.isInteger(fromConnection) && fromConnection > 0 ? fromConnection : null);

  if (!eventTypeId) {
    try {
      const [first] = await fetchCalcomEventTypes(apiKey);
      eventTypeId = first?.id ?? null;
    } catch (err) {
      console.error("Could not list event types for CALCOM_API_KEY:", err);
    }
  }
  if (!eventTypeId) {
    console.error("CALCOM_API_KEY is set but no Cal.com event type could be found; set CALCOM_EVENT_TYPE_ID.");
    return null;
  }

  return {
    apiKey,
    eventTypeId,
    timezone: connection?.calcom_timezone ?? "Europe/Copenhagen",
  };
}
