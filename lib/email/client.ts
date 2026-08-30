import "server-only";
import { requireCredentialEnv } from "@/lib/security/env";

// Every transactional email this platform sends comes from this one
// address — keeping it a single constant (not an env var) means it can't
// drift between call sites the way DEFAULT_VAPI_FIRST_MESSAGE-style
// hardcoded platform defaults elsewhere in this codebase don't either.
export const PLATFORM_EMAIL_FROM = "AIbooking.dk <mail@aibooking.dk>";

function getApiKey(): string {
  return requireCredentialEnv(
    "RESEND_API_KEY",
    "Mail er ikke konfigureret på platformen endnu (mangler RESEND_API_KEY i miljøvariablerne)."
  );
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

// Talks to Resend's REST API directly rather than pulling in their SDK —
// matches how lib/vapi/client.ts calls Vapi's API with plain fetch, and one
// POST is all this platform's mail sending needs today.
export async function sendEmail(params: SendEmailParams): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: PLATFORM_EMAIL_FROM,
      to: params.to,
      subject: params.subject,
      html: params.html,
      reply_to: params.replyTo,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Resend afviste anmodningen (${response.status}): ${errorBody || "ingen detaljer"}`);
  }
}
