import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { syncWidgetToVapiAssistant } from "./sync";

// Connecting a calendar is what makes booking real for an agent:
// widgets.booking_enabled is the single gate the runtime reads (see
// 0030_optional_booking.sql), and the Vapi assistant only carries the
// booking tools once it has been synced with the gate on. The Cal.com
// connect route always did both; the Google and Outlook OAuth callbacks
// only stored the connection, so those agents still said they couldn't book.
//
// Never throws: the calendar is connected either way, and a failed sync is
// healed by the next save of the widget or the admin bulk re-sync.
export async function enableBookingForWidget(widgetId: string): Promise<void> {
  try {
    const supabase = getAdminClient();
    const { data: widget, error } = await supabase
      .from("widgets")
      .update({ booking_enabled: true })
      .eq("id", widgetId)
      .select("*")
      .single();
    if (error || !widget) {
      console.error("Could not enable booking for widget", widgetId, error);
      return;
    }

    const { data: settings } = await supabase
      .from("widget_settings")
      .select("extra")
      .eq("widget_id", widgetId)
      .maybeSingle();
    await syncWidgetToVapiAssistant(widget, (settings?.extra as Record<string, unknown> | null) ?? {});
  } catch (err) {
    console.error("Failed to enable booking for widget", widgetId, err instanceof Error ? err.message : err);
  }
}
