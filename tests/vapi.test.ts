import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { verifyVapiWebhookSecret } from "@/lib/vapi/webhook";
import { buildDefaultSystemPrompt, buildDefaultFirstMessage } from "@/lib/vapi/prompt-template";
import { buildVapiEmbedSnippet, toVapiWidgetEmbedConfig } from "@/lib/vapi/widget-snippet";
import { DEFAULT_AGENT_CAPABILITIES } from "@/lib/vapi/types";
import { vapiSyncSchema, widgetUpdateSchema } from "@/lib/security/schemas";
import type { Widget } from "@/types/database";

describe("verifyVapiWebhookSecret", () => {
  const originalSecret = process.env.VAPI_WEBHOOK_SECRET;

  afterEach(() => {
    process.env.VAPI_WEBHOOK_SECRET = originalSecret;
  });

  it("accepts any request when no secret is configured (local dev)", () => {
    delete process.env.VAPI_WEBHOOK_SECRET;
    expect(verifyVapiWebhookSecret(null)).toBe(true);
    expect(verifyVapiWebhookSecret("anything")).toBe(true);
  });

  it("rejects a missing or wrong secret once one is configured", () => {
    process.env.VAPI_WEBHOOK_SECRET = "correct-horse-battery-staple";
    expect(verifyVapiWebhookSecret(null)).toBe(false);
    expect(verifyVapiWebhookSecret("wrong")).toBe(false);
  });

  it("accepts the exact configured secret", () => {
    process.env.VAPI_WEBHOOK_SECRET = "correct-horse-battery-staple";
    expect(verifyVapiWebhookSecret("correct-horse-battery-staple")).toBe(true);
  });
});

describe("buildDefaultSystemPrompt", () => {
  it("fills the business name and description into the template", () => {
    const prompt = buildDefaultSystemPrompt(
      {
        business_name: "Fjordbageriet",
        business_description: "Et lokalt bageri i Aarhus.",
        business_phone: "12345678",
        business_email: null,
        language: "da",
      },
      DEFAULT_AGENT_CAPABILITIES
    );

    expect(prompt).toContain("Fjordbageriet");
    expect(prompt).toContain("Et lokalt bageri i Aarhus.");
    expect(prompt).toContain("12345678");
  });

  it("falls back to a generic description when none is set", () => {
    const prompt = buildDefaultSystemPrompt(
      { business_name: "Test A/S", business_description: null, business_phone: null, business_email: null, language: "en" },
      DEFAULT_AGENT_CAPABILITIES
    );
    expect(prompt).toContain("Test A/S");
    expect(prompt).not.toContain("{{");
  });

  it("adds a capability line only for capabilities that are actually enabled", () => {
    const withBooking = buildDefaultSystemPrompt(
      { business_name: "Klinik", business_description: null, business_phone: null, business_email: null, language: "da" },
      { ...DEFAULT_AGENT_CAPABILITIES, bookAppointments: true }
    );
    const withoutBooking = buildDefaultSystemPrompt(
      { business_name: "Klinik", business_description: null, business_phone: null, business_email: null, language: "da" },
      DEFAULT_AGENT_CAPABILITIES
    );

    expect(withBooking).toContain("book appointments");
    expect(withoutBooking).not.toContain("book appointments");
  });
});

describe("buildDefaultFirstMessage", () => {
  it("greets using the business name", () => {
    expect(buildDefaultFirstMessage({ business_name: "Fjordbageriet" })).toBe(
      "Hello, you've reached Fjordbageriet. How can I help you today?"
    );
  });

  it("falls back gracefully when there is no business name", () => {
    expect(buildDefaultFirstMessage({ business_name: null })).toContain("us");
  });
});

describe("Vapi embed snippet", () => {
  const widget: Widget = {
    id: "widget-1",
    customer_id: "customer-1",
    public_id: "abc123",
    name: "Reception",
    status: "active",
    business_name: "Fjordbageriet",
    llm_model_id: null,
    voice_model_id: null,
    language: "da",
    system_prompt: null,
    welcome_message: null,
    opening_message: null,
    primary_color: "#4F46E5",
    secondary_color: "#111827",
    logo_url: null,
    avatar_url: null,
    position: "bottom-right",
    widget_size: "medium",
    show_branding: true,
    max_response_chars: 400,
    vapi_assistant_id: "asst_123",
    vapi_voice_provider: "vapi",
    vapi_voice_id: "Elliot",
    vapi_llm_provider: "openai",
    vapi_llm_model: "gpt-4o-mini",
    widget_mode: "both",
    widget_theme: "light",
    business_description: null,
    business_phone: null,
    business_email: null,
    website_url: null,
    vapi_synced_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  it("never includes anything resembling a private API key", () => {
    const snippet = buildVapiEmbedSnippet(toVapiWidgetEmbedConfig(widget, "pk_live_public_only"));
    expect(snippet).toContain("pk_live_public_only");
    expect(snippet).toContain("asst_123");
    expect(snippet).not.toMatch(/VAPI_API_KEY|sk_live|service_role/i);
  });

  it("maps widgetMode 'both' to the widget's 'hybrid' mode", () => {
    const snippet = buildVapiEmbedSnippet(toVapiWidgetEmbedConfig(widget, "pk_test"));
    expect(snippet).toContain('mode="hybrid"');
  });

  it("uses the official client-sdk-react umd bundle", () => {
    const snippet = buildVapiEmbedSnippet(toVapiWidgetEmbedConfig(widget, "pk_test"));
    expect(snippet).toContain("unpkg.com/@vapi-ai/client-sdk-react/dist/embed/widget.umd.js");
    expect(snippet).toContain("<vapi-widget");
  });
});

describe("vapiSyncSchema", () => {
  it("accepts a partial config update", () => {
    const result = vapiSyncSchema.safeParse({ llmProvider: "openai", llmModel: "gpt-4o-mini", widgetMode: "voice" });
    expect(result.success).toBe(true);
  });

  it("rejects an unsupported llm provider", () => {
    const result = vapiSyncSchema.safeParse({ llmProvider: "some-random-provider" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid business email", () => {
    const result = vapiSyncSchema.safeParse({ businessEmail: "not-an-email" });
    expect(result.success).toBe(false);
  });
});

describe("widgetUpdateSchema new Vapi-related fields", () => {
  it("accepts widgetMode and widgetTheme", () => {
    const result = widgetUpdateSchema.safeParse({ widgetMode: "chat", widgetTheme: "dark" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid widgetMode", () => {
    const result = widgetUpdateSchema.safeParse({ widgetMode: "carrier-pigeon" });
    expect(result.success).toBe(false);
  });
});
