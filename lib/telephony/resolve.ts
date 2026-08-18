import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { getOrCreateSubaccount, type TwilioCredentials } from "@/lib/twilio";

export interface TwilioDirectNumberContext {
  phoneNumberId: string;
  customerId: string;
  widgetId: string;
  credentials: TwilioCredentials;
}

// Looks up which customer/widget owns a given E.164 number and returns the
// Twilio subaccount credentials needed to validate that call's request
// signature — used by every telephony webhook to go from "a request
// claiming to be about +45..." to "the actual owner's Twilio secret",
// which is what makes the signature check meaningful.
export async function resolveTwilioDirectNumber(phoneNumber: string): Promise<TwilioDirectNumberContext | null> {
  const supabase = getAdminClient();
  const { data: row } = await supabase
    .from("phone_numbers")
    .select("id, customer_id, widget_id")
    .eq("phone_number", phoneNumber)
    .eq("purchase_status", "active")
    .maybeSingle();

  if (!row) return null;

  const credentials = await getOrCreateSubaccount(row.customer_id);
  return { phoneNumberId: row.id, customerId: row.customer_id, widgetId: row.widget_id, credentials };
}
