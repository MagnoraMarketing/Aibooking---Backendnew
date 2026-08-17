import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, requireParam, knowledgeBaseInputSchema } from "@/lib/security";
import {
  extractTextFromPdf,
  extractTextFromUrl,
  estimateIngestionCostSeconds,
  type KnowledgeBaseSource,
} from "@/lib/knowledge-base";
import { getBalanceSeconds, deductKnowledgeBaseCost, refundCredits } from "@/lib/credits";
import { syncWidgetToVapiAssistant } from "@/lib/vapi";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// A base64-encoded PDF would blow well past MAX_REQUEST_BODY_BYTES (100KB,
// sized for ordinary JSON payloads), so PDFs go through multipart/form-data
// on this same route instead of readJsonBody — see the content-type branch
// below. "A few pages" per the agreed scope; 5MB is generous headroom.
const MAX_PDF_BYTES = 5 * 1024 * 1024;

async function loadOwnWidget(supabase: ReturnType<typeof getAdminClient>, widgetId: string, customerId: string) {
  const { data, error } = await supabase.from("widgets").select("*").eq("id", widgetId).maybeSingle();
  if (error) throw error;
  if (!data || data.customer_id !== customerId) throw ApiError.notFound("Widget not found");
  return data;
}

async function loadExtra(supabase: ReturnType<typeof getAdminClient>, widgetId: string): Promise<Record<string, unknown>> {
  const { data } = await supabase.from("widget_settings").select("extra").eq("widget_id", widgetId).maybeSingle();
  return (data?.extra as Record<string, unknown> | null) ?? {};
}

export const POST = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const widgetId = requireParam(params, "id");
  const widget = await loadOwnWidget(supabase, widgetId, ctx.profile.customer_id!);

  let type: KnowledgeBaseSource["type"];
  let label: string;
  let content: string;

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw ApiError.badRequest("Missing file");
    if (file.size > MAX_PDF_BYTES) throw ApiError.badRequest("PDF is too large (max 5MB)");
    if (file.type && file.type !== "application/pdf") throw ApiError.badRequest("Only PDF files are supported");

    type = "pdf";
    label = file.name || "Uploadet PDF";
    try {
      content = await extractTextFromPdf(Buffer.from(await file.arrayBuffer()));
    } catch (err) {
      throw ApiError.badRequest(`Kunne ikke læse PDF'en: ${err instanceof Error ? err.message : "ukendt fejl"}`);
    }
  } else {
    const body = await readJsonBody(request, knowledgeBaseInputSchema);
    if (body.type === "text") {
      type = "text";
      label = body.label ?? "Manuel tekst";
      content = body.text;
    } else {
      type = "url";
      label = body.url;
      try {
        content = await extractTextFromUrl(body.url);
      } catch (err) {
        throw ApiError.badRequest(`Kunne ikke hente siden: ${err instanceof Error ? err.message : "ukendt fejl"}`);
      }
    }
  }

  content = content.trim();
  if (!content) throw ApiError.badRequest("Der blev ikke fundet noget tekstindhold");

  const costSeconds = await estimateIngestionCostSeconds(content.length);
  const balance = await getBalanceSeconds(widget.customer_id);
  if (balance < costSeconds) {
    throw ApiError.paymentRequired("Ikke nok minutter tilbage til at tilføje dette indhold");
  }

  const source: KnowledgeBaseSource = {
    id: crypto.randomUUID(),
    type,
    label,
    content,
    characterCount: content.length,
    costSeconds,
    createdAt: new Date().toISOString(),
  };

  await deductKnowledgeBaseCost({
    customerId: widget.customer_id,
    seconds: costSeconds,
    description: `Videnbase: ${label}`,
  });

  const extra = await loadExtra(supabase, widgetId);
  const existingSources = (extra.knowledgeBase as KnowledgeBaseSource[] | undefined) ?? [];
  const updatedExtra = { ...extra, knowledgeBase: [...existingSources, source] };

  const { error: upsertError } = await supabase.from("widget_settings").upsert({ widget_id: widgetId, extra: updatedExtra });
  if (upsertError) {
    // Don't leave the customer charged for content that never got saved.
    await refundCredits({
      customerId: widget.customer_id,
      seconds: costSeconds,
      description: `Refusion: videnbase-upload fejlede (${label})`,
    }).catch(() => {});
    throw upsertError;
  }

  await syncWidgetToVapiAssistant(widget, updatedExtra);

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: ctx.profile.customer_id,
    action: "widget.knowledge_base.added",
    entityType: "widget",
    entityId: widgetId,
    metadata: { type, label, characterCount: source.characterCount, costSeconds },
  });

  return NextResponse.json({ source, knowledgeBase: updatedExtra.knowledgeBase }, { status: 201 });
});
