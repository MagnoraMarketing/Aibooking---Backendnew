import "server-only";
import { getPublicAppUrl } from "@/lib/app-url";
import { TRIAL_DAYS } from "@/lib/billing/trial";
import { buildEmbedSnippet } from "@/lib/widgets/embed";
import { sendEmail, PLATFORM_NOTIFICATION_TO } from "./client";
import { buildWelcomeEmailHtml } from "./templates/welcome";

// Sent to the customer right after a self-signup. Best-effort and never
// throws, like lib/email/internal-notifications.ts: the account already
// exists by the time this runs, and a Resend outage must not turn a
// completed signup into an error page.
export async function sendCustomerWelcomeEmail(params: {
  email: string;
  companyName: string;
  widget: { id: string; public_id: string };
  // The free trial is what unlocks the embed code for a brand-new customer
  // (lib/billing/trial.ts's hasEmbedCodeAccess) — with no trial minutes the
  // code isn't theirs to use yet, so the mail leaves it out.
  trialMinutes: number;
}): Promise<void> {
  const appUrl = getPublicAppUrl();
  try {
    await sendEmail({
      to: params.email,
      subject: "Velkommen til AIbooking.dk – sådan kommer du i gang",
      html: buildWelcomeEmailHtml({
        companyName: params.companyName,
        dashboardUrl: `${appUrl}/dashboard`,
        agentUrl: `${appUrl}/dashboard/agent/${params.widget.id}`,
        embedSnippet: params.trialMinutes > 0 ? buildEmbedSnippet(params.widget.public_id) : null,
        trialMinutes: params.trialMinutes,
        trialDays: TRIAL_DAYS,
      }),
      replyTo: PLATFORM_NOTIFICATION_TO,
    });
  } catch (err) {
    console.error("Failed to send welcome email:", err instanceof Error ? err.message : err);
  }
}
