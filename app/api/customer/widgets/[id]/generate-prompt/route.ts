import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, requireParam, generatePromptInputSchema } from "@/lib/security";
import { resolveLLMProviderWithFallback } from "@/lib/llm";
import { getPromptDraftingModelName } from "@/lib/settings/platform";
// Import the specific submodule, not the @/lib/knowledge-base barrel —
// see lib/knowledge-base/pdf.ts's top comment for why.
import type { KnowledgeBaseSource } from "@/lib/knowledge-base/types";
import { languageNameInDanish } from "@/lib/i18n/agent-content";
import { ApiError } from "@/types/errors";

// Every route here is per-request (auth cookies, live DB reads) —
// never statically optimized/cached.
export const dynamic = "force-dynamic";

// Picked in the wizard's first step ("Navn & type", see
// wizard.purposeQuestion in lib/i18n/dictionaries/agent.ts) — purely
// advisory for how the draft *reads*. The actual tools (booking, Shopify)
// are still gated by an actually-connected calendar/webshop at sync time
// (see syncWidgetToVapiAssistant in lib/vapi/sync.ts), never by this.
type AgentPurpose = "booking" | "shopify" | "qa";

// No selection (every widget created before this picker existed, or a
// customer who skipped it) keeps the original, purpose-agnostic bullet —
// mentions both Q&A and bookings — so existing behaviour doesn't shift
// under anyone who never saw the new step.
const DEFAULT_TASK_BULLET =
  "- Instruere AI'en i at hjælpe besøgende med spørgsmål og bookinger, og tale naturligt og kortfattet";

function taskBullets(purposes: AgentPurpose[]): string {
  if (purposes.length === 0) return DEFAULT_TASK_BULLET;

  const lines: string[] = [];
  if (purposes.includes("booking")) {
    lines.push(
      "- Instruere AI'en i at hjælpe besøgende med at booke/aftale tider, og bede om det den skal bruge for at gennemføre bookingen (ønsket tidspunkt, navn, kontaktinfo)"
    );
  }
  if (purposes.includes("shopify")) {
    lines.push(
      "- Instruere AI'en i at hjælpe besøgende med spørgsmål om produkter, lager og ordrer i virksomhedens webshop"
    );
  }
  if (purposes.includes("qa")) {
    lines.push(
      "- Instruere AI'en i KUN at svare på spørgsmål ud fra virksomhedens egen viden — den må ALDRIG tilbyde at booke en tid eller gennemføre et køb, medmindre en anden instruktion her siger den kan"
    );
  }
  lines.push("- Tale naturligt og kortfattet");
  return lines.join("\n");
}

// Meta-instruction is authored in Danish (Claude understands it fine either
// way) but the {language} placeholder makes sure the *generated* prompt —
// the one actually shown to and edited by the customer — comes out in the
// widget's own language, not always Danish.
function metaSystemPrompt(language: string, purposes: AgentPurpose[]): string {
  return `Du er ekspert i at skrive system-prompts til AI-receptionister, der bruges som chat/stemme-widgets på virksomheders hjemmesider.

Skriv en kort, klar system-prompt på ${language} til virksomheden beskrevet i brugerens besked. Prompten skal:
- Fastslå at AI'en er AI-receptionist for virksomheden, og nævne hvad virksomheden laver
- Nævne de vigtigste ydelser/produkter og åbningstider, hvis de er oplyst
${taskBullets(purposes)}
- Instruere AI'en i ALDRIG at opfinde information den ikke har — den skal sige det tydeligt i stedet

Brugerens besked kan indeholde uddrag fra virksomhedens egen vidensbase (hjemmeside, dokumenter). Brug dem til at forstå virksomheden og ramme dens tone og fagsprog — men GENGIV dem ikke i prompten: vidensbasen sendes med til agenten separat, så priser, åbningstider og produktdetaljer derfra skal ikke skrives ind i selve prompten, hvor de ville fryse fast og blive forældede.

Svar KUN med selve system-prompten, uden indledning, forklaring eller anførselstegn.`;
}

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
    .select("id, customer_id, language, name, business_name")
    .eq("id", widgetId)
    .maybeSingle();
  if (error) throw error;
  if (!widget || widget.customer_id !== ctx.profile.customer_id) throw ApiError.notFound("Widget not found");

  // The knowledge base the customer has already attached to this widget
  // (their website, documents) is the best description of the business we
  // have — far better than four short form fields — so the draft is written
  // with it in view. Only an excerpt: this is context for *writing* the
  // prompt, not the knowledge itself, which reaches the agent separately at
  // sync time (lib/vapi/sync.ts).
  const { data: settings } = await supabase
    .from("widget_settings")
    .select("extra")
    .eq("widget_id", widgetId)
    .maybeSingle<{
      extra: { knowledgeBase?: KnowledgeBaseSource[]; agentPurposes?: AgentPurpose[]; purposeNotes?: string } | null;
    }>();

  const knowledgeBaseExcerpt = buildKnowledgeBaseExcerpt(settings?.extra?.knowledgeBase ?? []);
  const purposes = settings?.extra?.agentPurposes ?? [];

  const details = [
    `Virksomhedens navn: ${widget.business_name ?? widget.name}`,
    `Hvad virksomheden laver: ${body.businessDescription}`,
    body.keyServices ? `Vigtigste ydelser/produkter: ${body.keyServices}` : null,
    body.openingHours ? `Åbningstider: ${body.openingHours}` : null,
    body.otherNotes ? `Andet vigtigt: ${body.otherNotes}` : null,
    settings?.extra?.purposeNotes ? `Andet agenten skal vide: ${settings.extra.purposeNotes}` : null,
    knowledgeBaseExcerpt,
  ]
    .filter(Boolean)
    .join("\n");

  // Falls back to a master-admin-configured Vapi assistant if Anthropic
  // fails — e.g. an empty credit balance, see lib/llm/registry.ts — so a
  // drafting request doesn't dead-end on "AI-kontoen (Anthropic) har ikke
  // flere credits" once a fallback assistant is set under
  // Admin → Indstillinger.
  const provider = resolveLLMProviderWithFallback("anthropic");
  const model = await getPromptDraftingModelName();

  const result = await provider.generateReply({
    model,
    systemPrompt: metaSystemPrompt(languageNameInDanish(widget.language), purposes),
    maxTokens: 500,
    messages: [{ role: "user", content: details }],
  });

  return NextResponse.json({ systemPrompt: result.content.trim() });
});

// A bounded taste of each attached source rather than the whole knowledge
// base: the draft only needs enough to recognise the business's field and
// tone, and the full text can run to tens of thousands of characters (see
// lib/knowledge-base/format.ts's own cap for the agent-facing copy).
const KB_EXCERPT_CHARS_PER_SOURCE = 1200;
const KB_EXCERPT_MAX_SOURCES = 5;

function buildKnowledgeBaseExcerpt(sources: KnowledgeBaseSource[]): string | null {
  if (sources.length === 0) return null;

  const parts = sources
    .slice(0, KB_EXCERPT_MAX_SOURCES)
    .map((source) => `### ${source.label}\n${source.content.slice(0, KB_EXCERPT_CHARS_PER_SOURCE)}`);

  return ["", "Uddrag fra virksomhedens vidensbase (til baggrund — gengiv dem ikke i prompten):", ...parts].join("\n");
}
