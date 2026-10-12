// Editing the platform's own Vapi assistants (the Aibooking.dk Dashboard's
// widget, inbound line and outbound sales agent) from the admin.
//
// These assistants are built by hand in Vapi, not by lib/vapi/sync.ts, so the
// "Vapi resync" button never reaches them. This reads the few settings the
// admin edits out of the assistant as Vapi returns it, and writes them back
// without disturbing anything else on it.
//
// Pure — no fetching — so it can be tested against Vapi's shapes directly.

import { isLocale, type Locale } from "@/lib/i18n/locales";
import { stripEndCallDirective, withEndCallDirective } from "@/lib/i18n/agent-content";

export interface AssistantConfig {
  vapiName: string | null;
  firstMessage: string;
  systemPrompt: string;
  endCallOnGoodbye: boolean;
  // Said by Vapi itself when the agent hangs up. Empty = the agent's own
  // goodbye is the last thing said.
  endCallMessage: string;
  silenceTimeoutSeconds: number | null;
  maxDurationSeconds: number | null;
  language: Locale;
  // Read-only context for the editor.
  modelLabel: string | null;
  voiceLabel: string | null;
  // An end-call tool attached as a saved Vapi tool (model.toolIds) rather
  // than inline: it cannot be switched off from here.
  endCallFromSavedTool: boolean;
}

export interface AssistantConfigInput {
  firstMessage?: string;
  systemPrompt?: string;
  endCallOnGoodbye?: boolean;
  endCallMessage?: string;
  silenceTimeoutSeconds?: number | null;
  maxDurationSeconds?: number | null;
}

type Raw = Record<string, unknown>;

function obj(value: unknown): Raw {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// The assistant's spoken language, as far as Vapi says it: the transcriber's
// language ("da", "en-US", …), else Danish.
export function assistantLanguage(raw: Raw): Locale {
  const code = (str(obj(raw.transcriber).language) ?? "").slice(0, 2).toLowerCase();
  return isLocale(code) ? code : "da";
}

function systemMessageIndex(messages: Raw[]): number {
  return messages.findIndex((m) => m.role === "system");
}

function isEndCallTool(tool: unknown): boolean {
  return obj(tool).type === "endCall";
}

export function readAssistantConfig(raw: Raw, savedToolTypes: string[] = []): AssistantConfig {
  const model = obj(raw.model);
  const messages = Array.isArray(model.messages) ? (model.messages as Raw[]) : [];
  const system = messages[systemMessageIndex(messages)];
  const tools = Array.isArray(model.tools) ? model.tools : [];
  const voice = obj(raw.voice);
  const endCallFromSavedTool = savedToolTypes.includes("endCall");

  return {
    vapiName: str(raw.name),
    firstMessage: str(raw.firstMessage) ?? "",
    systemPrompt: stripEndCallDirective(str(system?.content) ?? ""),
    endCallOnGoodbye: tools.some(isEndCallTool) || endCallFromSavedTool,
    endCallMessage: str(raw.endCallMessage) ?? "",
    silenceTimeoutSeconds: num(raw.silenceTimeoutSeconds),
    maxDurationSeconds: num(raw.maxDurationSeconds),
    language: assistantLanguage(raw),
    modelLabel: [str(model.provider), str(model.model)].filter(Boolean).join(" · ") || null,
    voiceLabel: [str(voice.provider), str(voice.voiceId)].filter(Boolean).join(" · ") || null,
    endCallFromSavedTool,
  };
}

// The PATCH body for Vapi. `model` is sent whole, because Vapi replaces it
// wholesale rather than merging (see lib/vapi/calls.ts) — so it is the
// assistant's own model with only the system prompt and the end-call tool
// changed. Every other tool, the provider and its settings go back as they
// came.
export function buildAssistantPatch(
  raw: Raw,
  input: AssistantConfigInput,
  endCallTool: Raw,
  savedToolTypes: string[] = []
): Raw {
  const current = readAssistantConfig(raw, savedToolTypes);
  const body: Raw = {};

  if (input.firstMessage !== undefined) body.firstMessage = input.firstMessage;
  if (input.endCallMessage !== undefined) body.endCallMessage = input.endCallMessage;
  if (input.silenceTimeoutSeconds !== undefined && input.silenceTimeoutSeconds !== null) {
    body.silenceTimeoutSeconds = input.silenceTimeoutSeconds;
  }
  if (input.maxDurationSeconds !== undefined && input.maxDurationSeconds !== null) {
    body.maxDurationSeconds = input.maxDurationSeconds;
  }

  const promptChanged = input.systemPrompt !== undefined && input.systemPrompt !== current.systemPrompt;
  const endCallChanged = input.endCallOnGoodbye !== undefined && input.endCallOnGoodbye !== current.endCallOnGoodbye;
  if (!promptChanged && !endCallChanged) return body;

  const model = obj(raw.model);
  if (!str(model.provider) || !str(model.model)) {
    throw new Error("Assistentens model kunne ikke læses fra Vapi, så prompten kan ikke gemmes herfra.");
  }

  const endCall = input.endCallOnGoodbye ?? current.endCallOnGoodbye;
  const prompt = input.systemPrompt ?? current.systemPrompt;
  const content = endCall ? withEndCallDirective(prompt, current.language) : prompt;

  const messages = Array.isArray(model.messages) ? [...(model.messages as Raw[])] : [];
  const index = systemMessageIndex(messages);
  if (index >= 0) messages[index] = { ...messages[index], content };
  else messages.unshift({ role: "system", content });

  const otherTools = (Array.isArray(model.tools) ? model.tools : []).filter((tool) => !isEndCallTool(tool));
  // A saved end-call tool (toolIds) already covers it; adding an inline one
  // too would give the model two functions with the same name.
  const withEndCall = endCall && !savedToolTypes.includes("endCall");

  body.model = { ...model, messages, tools: withEndCall ? [...otherTools, endCallTool] : otherTools };
  return body;
}
