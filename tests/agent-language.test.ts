import { describe, it, expect, vi, beforeEach } from "vitest";

// The language a customer picks under Settings is the language their visitors
// get. Two things used to break that, both invisible from the code alone:
// Vapi speaks its own English fillers ("Hold on a sec.") whenever a tool
// carries no messages of its own, and a Danish agent had no directive telling
// it to stay in Danish, so it answered an English-speaking visitor in English.

const vapiFetchMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(new Response("{}")));
vi.mock("@/lib/vapi/client", () => ({
  vapiFetch: (...args: unknown[]) => vapiFetchMock(...args),
}));

vi.mock("@/lib/settings/platform", () => ({
  getVapiVoiceTemplateAssistantId: async () => null,
}));

import { createVapiAssistant } from "@/lib/vapi/assistants";
import { languageDirective, withLanguageDirective, toolWaitText } from "@/lib/i18n/agent-content";

const PARAMS = { name: "Frisørstuen", systemPrompt: "Du er receptionist.", firstMessage: "Hej!" };

function toolsSent(callIndex = 0): Array<{ function?: { name?: string }; messages?: Array<{ type: string; content: string }> }> {
  const init = vapiFetchMock.mock.calls[callIndex]![1] as RequestInit;
  const body = JSON.parse(String(init.body)) as { model: { tools: unknown[] } };
  return body.model.tools as ReturnType<typeof toolsSent>;
}

beforeEach(() => {
  vapiFetchMock.mockReset().mockResolvedValue(new Response("{}"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("what the agent says while a tool runs", () => {
  it("carries a spoken filler in the widget's language on every tool", async () => {
    await createVapiAssistant({ ...PARAMS, language: "da" }, true);

    const tools = toolsSent();
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      const start = tool.messages?.find((message) => message.type === "request-start");
      expect(start?.content).toBe("Lige et øjeblik.");
    }
  });

  // The whole point: without these, Vapi supplies its own English ones.
  it("leaves no tool without messages, whatever module built it", async () => {
    const shopifyTool = { type: "function", function: { name: "search_products", description: "…", parameters: {} } };
    await createVapiAssistant({ ...PARAMS, language: "da" }, true, [shopifyTool]);

    const tools = toolsSent();
    expect(tools.some((tool) => tool.function?.name === "search_products")).toBe(true);
    for (const tool of tools) {
      expect(tool.messages?.length).toBeGreaterThan(0);
    }
  });

  it("follows the widget's language rather than defaulting to Danish", async () => {
    await createVapiAssistant({ ...PARAMS, language: "de" }, true);

    const start = toolsSent()[0]!.messages?.find((message) => message.type === "request-start");
    expect(start?.content).toBe("Einen Moment.");
  });

  // A tool that knows better keeps its own wording.
  it("does not overwrite messages a tool already defines", async () => {
    const ownMessages = [{ type: "request-start", content: "Jeg slår det op i webshoppen." }];
    const tool = { type: "function", function: { name: "custom", parameters: {} }, messages: ownMessages };

    await createVapiAssistant({ ...PARAMS, language: "da" }, false, [tool]);

    expect(toolsSent()[0]!.messages).toEqual(ownMessages);
  });

  it("tells the agent it failed, in the same language, when a tool errors", async () => {
    await createVapiAssistant({ ...PARAMS, language: "da" }, true);

    const failed = toolsSent()[0]!.messages?.find((message) => message.type === "request-failed");
    expect(failed?.content).toContain("desværre");
  });
});

describe("the language directive", () => {
  // Danish used to get none — the prompt was already Danish, which says
  // nothing about what to do when the visitor writes in English.
  it("is present for every language, Danish included", () => {
    for (const language of ["da", "en", "es", "fr", "pt", "de"]) {
      expect(languageDirective(language).length).toBeGreaterThan(0);
    }
    expect(languageDirective("da")).toContain("dansk");
  });

  it("covers the case the customer speaks another language", () => {
    expect(languageDirective("da")).toContain("andet sprog");
    expect(languageDirective("en")).toContain("another language");
  });

  it("falls back to Danish for an unknown or missing language", () => {
    expect(languageDirective(null)).toBe(languageDirective("da"));
    expect(languageDirective("klingon")).toBe(languageDirective("da"));
  });

  it("is appended to the prompt the agent actually runs on", () => {
    const prompt = withLanguageDirective("Du er receptionist for Bageren.", "da");
    expect(prompt.startsWith("Du er receptionist for Bageren.")).toBe(true);
    expect(prompt).toContain(languageDirective("da"));
  });

  it("names a spoken filler in the same language the tools use", () => {
    expect(toolWaitText("da")).toBe("Lige et øjeblik.");
    expect(toolWaitText("en")).toBe("One moment.");
  });
});

// The setup guidance a customer follows is part of the product: every wrong
// turn there comes back as "the agent says there's a technical problem".
describe("the Shopify setup link", () => {
  it("points into the customer's own store admin", async () => {
    const { shopifyDevelopAppsUrl } = await import("@/components/dashboard/agent-tabs/webshop-tab");
    expect(shopifyDevelopAppsUrl("frisorstuen.myshopify.com")).toBe(
      "https://admin.shopify.com/store/frisorstuen/settings/apps/development"
    );
  });

  it("takes the handle from whatever shape they typed", async () => {
    const { shopifyDevelopAppsUrl } = await import("@/components/dashboard/agent-tabs/webshop-tab");
    expect(shopifyDevelopAppsUrl("  https://Frisorstuen.myshopify.com  ")).toBe(
      "https://admin.shopify.com/store/frisorstuen/settings/apps/development"
    );
  });

  // A link to a store that doesn't exist is worse than no link: it sends the
  // customer to a Shopify 404 while they're already unsure what to do.
  it("gives no link at all when the field is empty or not a store address", async () => {
    const { shopifyDevelopAppsUrl } = await import("@/components/dashboard/agent-tabs/webshop-tab");
    for (const input of ["", "   ", ".myshopify.com", "https://"]) {
      expect(shopifyDevelopAppsUrl(input)).toBeNull();
    }
  });
});
