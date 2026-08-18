import type { WidgetBundle } from "./lookup";

// Public-facing config for the embeddable widget UI. Deliberately excludes
// system_prompt, internal IDs, provider voice IDs, and anything else that
// isn't needed to render the widget in the browser.
export interface PublicWidgetConfig {
  publicId: string;
  businessName: string | null;
  welcomeMessage: string | null;
  openingMessage: string | null;
  language: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  avatarUrl: string | null;
  position: string;
  widgetSize: string;
  showBranding: boolean;
  // "realtime" widgets (Expert model / OpenAI Realtime over WebRTC), "vapi"
  // widgets (Vapi model / Vapi Web SDK) and "twilio_relay" widgets (Twilio
  // ConversationRelay via the Twilio Voice SDK) all get a voice-first UI in
  // widget.js instead of the text-chat panel — see buildRealtimeUI(),
  // buildVapiUI() and buildTwilioRelayUI() there.
  mode: "text" | "realtime" | "vapi" | "twilio_relay";
}

function resolveMode(provider: string | undefined): PublicWidgetConfig["mode"] {
  if (provider === "openai") return "realtime";
  if (provider === "vapi") return "vapi";
  if (provider === "twilio_relay") return "twilio_relay";
  return "text";
}

export function toPublicWidgetConfig(bundle: WidgetBundle): PublicWidgetConfig {
  const { widget } = bundle;
  return {
    publicId: widget.public_id,
    businessName: widget.business_name,
    welcomeMessage: widget.welcome_message,
    openingMessage: widget.opening_message,
    language: widget.language,
    primaryColor: widget.primary_color,
    secondaryColor: widget.secondary_color,
    logoUrl: widget.logo_url,
    avatarUrl: widget.avatar_url,
    position: widget.position,
    widgetSize: widget.widget_size,
    showBranding: widget.show_branding,
    mode: resolveMode(bundle.llmModel?.provider),
  };
}
