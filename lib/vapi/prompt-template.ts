import type { Widget } from "@/types/database";
import type { AgentCapabilities } from "./types";

export const DEFAULT_SYSTEM_PROMPT_TEMPLATE = `You are the AI assistant for {{business_name}}.

{{business_description}}

Your job is to help callers naturally and efficiently:
- Answer questions about {{business_name}} accurately. If you don't know the answer, say so honestly instead of making something up — offer to have a human follow up instead.
- Speak in {{language}}, in a warm, professional, and concise tone.
- Keep responses short and conversational — this is a live voice conversation, not a written document.
{{capabilities_block}}
If the caller asks for something outside what you can help with, direct them to contact {{business_name}} directly{{contact_line}}.`;

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match);
}

function buildCapabilitiesBlock(capabilities: AgentCapabilities): string {
  const lines: string[] = [];
  if (capabilities.collectContactInfo) lines.push("- Politely collect the caller's name and contact details when relevant.");
  if (capabilities.bookAppointments) lines.push("- Help callers book appointments.");
  if (capabilities.cancelAppointments) lines.push("- Help callers cancel existing appointments.");
  if (capabilities.rescheduleAppointments) lines.push("- Help callers reschedule existing appointments.");
  if (capabilities.captureLeads) lines.push("- Capture the caller as a lead for the sales team to follow up with.");
  if (capabilities.transferToHuman) lines.push("- Offer to transfer the caller to a human team member if they ask for one.");
  return lines.join("\n");
}

// Generates the default system prompt from the widget's business
// configuration. Only used when the customer hasn't written their own
// system_prompt (see PromptLabTab / Voice Agent tab "Insert example").
export function buildDefaultSystemPrompt(
  widget: Pick<Widget, "business_name" | "business_description" | "business_phone" | "business_email" | "language">,
  capabilities: AgentCapabilities
): string {
  const businessName = widget.business_name?.trim() || "our business";
  const contactParts = [widget.business_phone, widget.business_email].filter(Boolean);
  const contactLine = contactParts.length > 0 ? ` at ${contactParts.join(" or ")}` : "";

  return renderTemplate(DEFAULT_SYSTEM_PROMPT_TEMPLATE, {
    business_name: businessName,
    business_description: widget.business_description?.trim() || `${businessName} is a business that this AI assistant represents.`,
    language: widget.language,
    capabilities_block: buildCapabilitiesBlock(capabilities),
    contact_line: contactLine,
  }).replace(/\n{3,}/g, "\n\n");
}

export function buildDefaultFirstMessage(widget: Pick<Widget, "business_name">): string {
  const businessName = widget.business_name?.trim() || "us";
  return `Hello, you've reached ${businessName}. How can I help you today?`;
}
