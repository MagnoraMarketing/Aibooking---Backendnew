import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "./client";
import { buildInviteEmailHtml } from "./templates/invite";

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export interface SendCustomerInviteEmailParams {
  supabase: SupabaseClient;
  email: string;
  recipientName: string;
  companyName: string;
}

// Generates the invite link ourselves (supabase.auth.admin.generateLink)
// instead of calling the deprecated inviteUserByEmail, which would also
// fire Supabase's own built-in mailer — using generateLink creates the
// same auth user without sending anything, so our own branded email (see
// lib/email/templates/invite.ts) is the only one the customer ever gets.
// Returns the new auth user's id on success; null if either step failed
// (best-effort — the caller decides whether that should block onboarding).
export async function sendCustomerInviteEmail(params: SendCustomerInviteEmailParams): Promise<{ userId: string } | null> {
  const { data, error } = await params.supabase.auth.admin.generateLink({
    type: "invite",
    email: params.email,
    options: {
      data: { full_name: params.recipientName },
      redirectTo: `${getAppUrl()}/accept-invite`,
    },
  });

  if (error || !data?.user || !data.properties?.action_link) {
    console.error("Failed to generate customer invite link:", error?.message);
    return null;
  }

  try {
    await sendEmail({
      to: params.email,
      subject: `Velkommen til AIbooking.dk, ${params.companyName}`,
      html: buildInviteEmailHtml({
        recipientName: params.recipientName,
        companyName: params.companyName,
        actionLink: data.properties.action_link,
      }),
    });
  } catch (err) {
    console.error("Failed to send customer invite email:", err instanceof Error ? err.message : err);
    return null;
  }

  return { userId: data.user.id };
}
