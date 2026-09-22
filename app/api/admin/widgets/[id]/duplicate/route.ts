import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog } from "@/lib/security";
import { generatePublicWidgetId, buildShareUrl, buildEmbedSnippet } from "@/lib/widgets";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// "Duplicate" (spec section 3) — copies the widget's own configuration
// (prompt, appearance, language) as a starting point for a new agent.
// Deliberately does NOT clone the Wapi agent connection or phone number: two
// widgets pointing at the same Vapi assistant/number would silently steal
// each other's calls, so the copy starts unconnected and the admin picks a
// Wapi agent for it explicitly (same as any other new widget).
export const POST = withErrorHandling(async (_request, { params }) => {
  const ctx = await requireMasterAdmin();
  const supabase = getAdminClient();

  const { data: source, error } = await supabase.from("widgets").select("*").eq("id", params.id).maybeSingle();
  if (error) throw error;
  if (!source) throw ApiError.notFound("Widget not found");

  const { data: sourceSettings } = await supabase
    .from("widget_settings")
    .select("extra")
    .eq("widget_id", params.id)
    .maybeSingle();
  const sourceExtra = (sourceSettings?.extra as Record<string, unknown> | null) ?? {};
  // Strip everything tied to a specific Vapi/telephony resource — see the
  // comment above.
  const {
    vapiAssistantId: _vapiAssistantId,
    vapiOutboundAssistantId: _vapiOutboundAssistantId,
    ...extraToCopy
  } = sourceExtra;

  const { data: widget, error: insertError } = await supabase
    .from("widgets")
    .insert({
      customer_id: source.customer_id,
      public_id: generatePublicWidgetId(),
      name: `${source.name} (kopi)`,
      agent_type: source.agent_type,
      deployment_type: source.deployment_type,
      status: "paused",
      business_name: source.business_name,
      language: source.language,
      system_prompt: source.system_prompt,
      welcome_message: source.welcome_message,
      opening_message: source.opening_message,
      primary_color: source.primary_color,
      secondary_color: source.secondary_color,
      logo_url: source.logo_url,
      avatar_url: source.avatar_url,
      position: source.position,
      widget_size: source.widget_size,
      show_branding: source.show_branding,
      max_response_chars: source.max_response_chars,
    })
    .select("*")
    .single();
  if (insertError) throw insertError;

  await supabase.from("widget_settings").insert({ widget_id: widget.id, extra: extraToCopy });

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: widget.customer_id,
    action: "widget.duplicated",
    entityType: "widget",
    entityId: widget.id,
    metadata: { sourceWidgetId: source.id },
  });

  return NextResponse.json(
    { widget: { ...widget, shareUrl: buildShareUrl(widget.public_id), embedSnippet: buildEmbedSnippet(widget.public_id) } },
    { status: 201 }
  );
});
