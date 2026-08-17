import type { Widget } from "@/types/database";
import type { VapiWidgetEmbedConfig } from "./types";

const WIDGET_MODE_TO_VAPI: Record<Widget["widget_mode"], VapiWidgetEmbedConfig["mode"]> = {
  voice: "voice",
  chat: "chat",
  both: "hybrid",
};

export function toVapiWidgetEmbedConfig(widget: Widget, publicKey: string): VapiWidgetEmbedConfig {
  return {
    publicKey,
    assistantId: widget.vapi_assistant_id!,
    mode: WIDGET_MODE_TO_VAPI[widget.widget_mode],
    theme: widget.widget_theme,
    position: widget.position,
    accentColor: widget.primary_color,
    title: widget.business_name || widget.name,
    startButtonText: "Start",
    endButtonText: "End Call",
  };
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// Builds the copy-pasteable <script>+<vapi-widget> embed snippet from the
// official Vapi client-sdk-react UMD bundle (docs.vapi.ai/chat/web-widget).
// Only ever includes the public key + the customer's own assistant id —
// never VAPI_API_KEY.
export function buildVapiEmbedSnippet(config: VapiWidgetEmbedConfig): string {
  return [
    '<script src="https://unpkg.com/@vapi-ai/client-sdk-react/dist/embed/widget.umd.js" async type="text/javascript"></script>',
    "<vapi-widget",
    `  public-key="${escapeAttr(config.publicKey)}"`,
    `  assistant-id="${escapeAttr(config.assistantId)}"`,
    `  mode="${config.mode}"`,
    `  theme="${config.theme}"`,
    `  position="${escapeAttr(config.position)}"`,
    `  accent-color="${escapeAttr(config.accentColor)}"`,
    `  title="${escapeAttr(config.title)}"`,
    `  start-button-text="${escapeAttr(config.startButtonText)}"`,
    `  end-button-text="${escapeAttr(config.endButtonText)}"`,
    "></vapi-widget>",
  ].join("\n");
}
