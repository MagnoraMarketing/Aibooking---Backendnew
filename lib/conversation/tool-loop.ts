import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, type LLMMessage } from "@/lib/llm";
import { buildShopifyAnthropicTools } from "@/lib/shopify/tool-definitions";
import { executeShopifyTool, isShopifyToolName, type ShopifyCapabilities } from "@/lib/shopify/agent-tools";
import { CALENDAR_TOOLS, executeCalendarTool, type CalendarToolContext } from "./calendar-tools";

// The tool-use loop for the chat/relay pipeline. Runs the same single-turn
// shape as AnthropicProvider.generateReply, but with tools enabled and a loop
// that executes them — the caller (lib/conversation/handle-turn.ts) only ever
// sees the final text reply and the total token usage across every call this
// made, so billing/usage recording there needs no changes.
//
// It was the calendar's loop first. It is shared now because an agent for a
// webshop that also takes bookings has to do both in one conversation, and
// because the voice pipeline (Vapi) already dispatches both kinds of tool from
// a single place — chat drifting from that would mean a customer's agent
// behaving differently depending on whether they typed or called.

export interface ShopifyToolLoopContext {
  widgetId: string;
  capabilities: ShopifyCapabilities;
}

export interface ToolLoopResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

const MAX_TOOL_ITERATIONS = 4;
const FALLBACK_REPLY =
  "Beklager, jeg kunne ikke afslutte det lige nu. Prøv igen om lidt, eller kontakt os direkte for at booke.";

function buildTools(
  calendar: CalendarToolContext | null,
  shopify: ShopifyToolLoopContext | null
): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [];
  if (calendar) tools.push(...CALENDAR_TOOLS);
  if (shopify) tools.push(...(buildShopifyAnthropicTools(shopify.capabilities) as Anthropic.Tool[]));
  return tools;
}

// Appended to the widget's own prompt so the model knows what it can do and
// what today's date is. Only the parts that apply are added: telling an agent
// about a calendar it hasn't got is how you get it offering to book.
function buildToolGuidance(
  calendar: CalendarToolContext | null,
  shopify: ShopifyToolLoopContext | null
): string {
  const today = new Date().toISOString().slice(0, 10);
  const parts: string[] = [`Dagens dato er ${today}.`];

  if (calendar) {
    parts.push(
      `I kan tjekke ledige tider og booke møder direkte via de tilgængelige funktioner (check_availability, book_meeting). Kalenderens tidszone er ${calendar.timezone}. Book kun en tid kunden eksplicit har bekræftet, og tjek altid ledighed først.`
    );
  }

  if (shopify?.capabilities.products) {
    parts.push(
      "Virksomheden har en webshop. Brug search_shopify_products når kunden spørger om et produkt, en pris, en størrelse, en farve eller lagerstatus — opfind aldrig et produkt eller en pris."
    );
  }

  if (shopify?.capabilities.orders) {
    parts.push(
      "Du kan slå ordrestatus og tracking op med get_shopify_order_status. Spørg altid kunden om deres ordrenummer først, og oplys kun om den ordre de selv har nævnt."
    );
  }

  return parts.join(" ");
}

async function executeTool(
  name: string,
  input: unknown,
  calendar: CalendarToolContext | null,
  shopify: ShopifyToolLoopContext | null
): Promise<string> {
  if (isShopifyToolName(name)) {
    if (!shopify) return "Webshoppen er ikke forbundet, så det kan du ikke slå op.";
    return executeShopifyTool(name, (input ?? {}) as Record<string, unknown>, shopify.widgetId);
  }
  if (!calendar) return "Kalenderen er ikke forbundet, så det kan du ikke slå op.";
  return executeCalendarTool(name, input, calendar);
}

export async function generateReplyWithTools(params: {
  model: string;
  systemPrompt: string;
  messages: LLMMessage[];
  maxTokens: number;
  calendar: CalendarToolContext | null;
  shopify: ShopifyToolLoopContext | null;
}): Promise<ToolLoopResult> {
  const client = getAnthropicClient();
  const tools = buildTools(params.calendar, params.shopify);
  const systemPrompt = `${params.systemPrompt}\n\n${buildToolGuidance(params.calendar, params.shopify)}`;

  const conversationMessages: Anthropic.MessageParam[] = params.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await client.messages.create({
      model: params.model,
      system: systemPrompt,
      max_tokens: params.maxTokens,
      tools,
      messages: conversationMessages,
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    if (response.stop_reason !== "tool_use") {
      const content = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      return { content, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
    }

    conversationMessages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const resultText = await executeTool(block.name, block.input, params.calendar, params.shopify);
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
    }
    conversationMessages.push({ role: "user", content: toolResults });
  }

  // Exhausted the loop without a final text turn (e.g. the model kept
  // calling tools) — fail safe with a message the caller can speak/display,
  // rather than throwing and losing the turn's usage accounting.
  return { content: FALLBACK_REPLY, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}
