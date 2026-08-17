import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, requireParam, generatePromptInputSchema } from "@/lib/security";
import { resolveLLMProvider } from "@/lib/llm";
import { getSummarizationModelName } from "@/lib/settings/platform";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

const META_SYSTEM_PROMPT = `Du er ekspert i at skrive system-prompts til AI-receptionister, der bruges som chat/stemme-widgets på virksomheders hjemmesider.

Skriv en kort, klar system-prompt på dansk til virksomheden beskrevet i brugerens besked. Prompten skal:
- Fastslå at AI'en er AI-receptionist for virksomheden, og nævne hvad virksomheden laver
- Nævne de vigtigste ydelser/produkter og åbningstider, hvis de er oplyst
- Instruere AI'en i at hjælpe besøgende med spørgsmål og bookinger, og tale naturligt og kortfattet
- Instruere AI'en i ALDRIG at opfinde information den ikke har — den skal sige det tydeligt i stedet

Svar KUN med selve system-prompten, uden indledning, forklaring eller anførselstegn.`;

// This just drafts a starting point for the "system-prompt" field on
// Prompt Lab (a config-authoring aid, not something the end customer's
// widget visitors ever trigger) — unlike knowledge base ingestion, it isn't
// billed against the credit ledger.
export const POST = withErrorHandling(async (request, { params }) => {
  const ctx = await requireCustomerAdmin();
  const supabase = getAdminClient();
  const widgetId = requireParam(params, "id");
  const body = await readJsonBody(request, generatePromptInputSchema);

  const { data: widget, error } = await supabase
    .from("widgets")
    .select("id, customer_id")
    .eq("id", widgetId)
    .maybeSingle();
  if (error) throw error;
  if (!widget || widget.customer_id !== ctx.profile.customer_id) throw ApiError.notFound("Widget not found");

  const details = [
    `Hvad virksomheden laver: ${body.businessDescription}`,
    body.keyServices ? `Vigtigste ydelser/produkter: ${body.keyServices}` : null,
    body.openingHours ? `Åbningstider: ${body.openingHours}` : null,
    body.otherNotes ? `Andet vigtigt: ${body.otherNotes}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const provider = resolveLLMProvider("anthropic");
  const model = await getSummarizationModelName();

  const result = await provider.generateReply({
    model,
    systemPrompt: META_SYSTEM_PROMPT,
    maxTokens: 500,
    messages: [{ role: "user", content: details }],
  });

  return NextResponse.json({ systemPrompt: result.content.trim() });
});
