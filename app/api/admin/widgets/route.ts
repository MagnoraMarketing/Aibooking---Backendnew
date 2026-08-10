import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, createWidgetSchema } from "@/lib/security";
import { generatePublicWidgetId, buildShareUrl, buildEmbedSnippet } from "@/lib/widgets";
import { getDefaultSystemPrompt } from "@/lib/settings/platform";
import { ApiError } from "@/types/errors";
import { z } from "zod";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

const createWidgetForCustomerSchema = createWidgetSchema.extend({
  customerId: z.string().uuid(),
});

export const GET = withErrorHandling(async (request) => {
  await requireMasterAdmin();
  const supabase = getAdminClient();
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId");

  let query = supabase.from("widgets").select("*").order("created_at", { ascending: false });
  if (customerId) query = query.eq("customer_id", customerId);

  const { data, error } = await query;
  if (error) throw error;

  const widgets = (data ?? []).map((w) => ({
    ...w,
    shareUrl: buildShareUrl(w.public_id),
    embedSnippet: buildEmbedSnippet(w.public_id),
  }));

  return NextResponse.json({ widgets });
});

export const POST = withErrorHandling(async (request) => {
  const ctx = await requireMasterAdmin();
  const body = await readJsonBody(request, createWidgetForCustomerSchema);
  const supabase = getAdminClient();

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("id", body.customerId)
    .maybeSingle();

  if (!customer) throw ApiError.notFound("Customer not found");

  const systemPrompt = body.systemPrompt ?? (await getDefaultSystemPrompt());

  const { data: widget, error } = await supabase
    .from("widgets")
    .insert({
      customer_id: body.customerId,
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
    customerId: body.customerId,
    action: "widget.created",
    entityType: "widget",
    entityId: widget.id,
  });

  return NextResponse.json(
    { widget: { ...widget, shareUrl: buildShareUrl(widget.public_id), embedSnippet: buildEmbedSnippet(widget.public_id) } },
    { status: 201 }
  );
});
