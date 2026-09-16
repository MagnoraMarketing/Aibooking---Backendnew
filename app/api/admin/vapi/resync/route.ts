import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog } from "@/lib/security";
import { syncWidgetToVapiAssistant } from "@/lib/vapi";
import type { Widget } from "@/types/database";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// One sync is a handful of Vapi round-trips, and this does every widget at
// once — well past the platform's 10s default.
export const maxDuration = 60;

// How many widgets are synced at a time. Sequential would be simplest but
// makes the request scale with the number of widgets until it times out;
// unbounded would fire dozens of parallel Vapi calls and invite rate
// limiting. Five keeps the whole estate inside one request without either.
const CONCURRENCY = 5;

interface ResyncRow {
  widgetId: string;
  name: string;
  status: "synced" | "skipped" | "failed";
  detail?: string;
}

// Pushes the current platform configuration — voice templates, system
// prompt, knowledge base, booking and Shopify tools — back out to every Vapi
// assistant we know about.
//
// It exists because an assistant only picks up a platform-level change the
// next time something happens to ITS widget. When a voice template is
// replaced (as it was when Vapi retired a voice out from under us), every
// existing assistant otherwise keeps the old one until its owner happens to
// edit something — which for a quiet widget can be never.
//
// Safe to run repeatedly: each sync writes the same desired state, so a
// second press is a no-op rather than a second change. That also makes a
// timeout harmless — press it again.
export const POST = withErrorHandling(async () => {
  const ctx = await requireMasterAdmin();
  const supabase = getAdminClient();

  // Joined rather than two queries so a widget whose settings row is missing
  // simply doesn't appear — there'd be no assistant id to sync it to anyway.
  const { data: settingsRows, error } = await supabase
    .from("widget_settings")
    .select("widget_id, extra, widgets(*)");
  if (error) throw error;

  const targets = (settingsRows ?? [])
    .map((row) => {
      const extra = (row.extra as Record<string, unknown> | null) ?? {};
      const widget = (row as unknown as { widgets: Widget | null }).widgets;
      return { widget, extra };
    })
    .filter((target): target is { widget: Widget; extra: Record<string, unknown> } => {
      return Boolean(target.widget) && typeof target.extra.vapiAssistantId === "string";
    });

  const results: ResyncRow[] = [];

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map(async ({ widget, extra }) => {
        // syncWidgetToVapiAssistant already swallows Vapi errors into a
        // "failed" outcome; this catch is for anything upstream of that (a
        // database read inside the sync, say) so one bad widget can't take
        // the whole run down with it.
        try {
          return { widget, outcome: await syncWidgetToVapiAssistant(widget, extra) };
        } catch (err) {
          return {
            widget,
            outcome: { status: "failed" as const, error: err instanceof Error ? err.message : String(err) },
          };
        }
      })
    );

    for (const { widget, outcome } of outcomes) {
      results.push({
        widgetId: widget.id,
        name: widget.name,
        status: outcome.status,
        detail: outcome.status === "failed" ? outcome.error : outcome.status === "skipped" ? outcome.reason : undefined,
      });
    }
  }

  const summary = {
    total: results.length,
    synced: results.filter((r) => r.status === "synced").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
  };

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    action: "vapi_assistants.resynced",
    metadata: summary,
  });

  // Only the failures are returned in full: a master admin needs to see
  // which assistants still need attention, and a list of 30 successes is
  // just noise on the way to that.
  return NextResponse.json({
    ...summary,
    failures: results.filter((r) => r.status === "failed"),
  });
});
