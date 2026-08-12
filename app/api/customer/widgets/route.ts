import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, createWidgetSchema } from "@/lib/security";
import { generatePublicWidgetId, buildShareUrl, buildEmbedSnippet } from "@/lib/widgets";
import { getDefaultSystemPrompt } from "@/lib/settings/platform";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("widgets")
    .select("*")
    .eq("customer_id", ctx.profile.customer_id!)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const widgets = (data ?? []).map((w) => ({
    ...w,
    shareUrl: buildShareUrl(w.public_id),
    embedSnippet: buildEmbedSnippet(w.public_id),
  }));

  return NextResponse.json({ widgets });
});

export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const body = await readJsonBody(request, createWidgetSchema);
  const supabase = getAdminClient();
  const customerId = ctx.profile.customer_id!;

  const systemPrompt = body.systemPrompt ?? (await getDefaultSystemPrompt());

  const { data: widget, error } = await supabase
    .from("widgets")
    .insert({
      customer_id: customerId,
      public_id: generatePublicWidgetId(),
      name: body.name,
      business_name: body.businessName,
      llm_model_id: body.llmModelId,
      voice_model_id: body.voiceModelId,
      language: body.language ?? "da",
      system_prompt: systemPrompt,
      welcome_message: body.welcomeMessage,
      opening_message: body.openingMessage,
    })
    .select("*")
    .single();

  if (error) throw error;

  await supabase.from("widget_settings").insert({ widget_id: widget.id, extra: {} });

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "widget.created",
    entityType: "widget",
    entityId: widget.id,
  });

  return NextResponse.json(
    { widget: { ...widget, shareUrl: buildShareUrl(widget.public_id), embedSnippet: buildEmbedSnippet(widget.public_id) } },
    { status: 201 }
  );
});
