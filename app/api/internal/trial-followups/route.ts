import { NextResponse } from "next/server";
import { withErrorHandling, requireCronSecret } from "@/lib/security";
import { sendDueTrialFollowups } from "@/lib/email/trial-followups";

export const dynamic = "force-dynamic";

// A handful of Resend calls, one after another.
export const maxDuration = 60;

// Sends the automatic trial follow-up mails (lib/email/trial-followups.ts):
// "tak for din interesse" the day after signup, and "hvordan går det?" the
// day before the trial ends to customers who haven't paid.
//
// Run once a day by Vercel Cron (vercel.json) — daily is all this needs,
// and all this project's Vercel plan allows. Vercel sends
// `Authorization: Bearer $CRON_SECRET`; requireCronSecret checks it, so
// nobody else can make the platform mail its customers.
async function handle(request: Request) {
  requireCronSecret(request);
  const result = await sendDueTrialFollowups();
  console.log(
    `Trial follow-ups: day1 ${result.day1.sent} sent / ${result.day1.failed} failed, ` +
      `day6 ${result.day6.sent} sent / ${result.day6.failed} failed / ${result.day6.skippedPaid} already paid`
  );
  return NextResponse.json(result);
}

export const GET = withErrorHandling(handle);
export const POST = withErrorHandling(handle);
