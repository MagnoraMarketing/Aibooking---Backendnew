import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, requireCredentialEnv } from "@/lib/security";
import { buildCalcomAuthUrl, hashOAuthState } from "@/lib/calendar";

export const dynamic = "force-dynamic";

// Initiates Cal.com OAuth flow for the current customer.
// Generates a CSRF state, stores it in the database, and redirects to Cal.com.
export const GET = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  requireCredentialEnv("CALCOM_CLIENT_ID");

  const state = randomUUID();
  const stateHash = hashOAuthState(state);
  const customerId = ctx.profile.customer_id!;
  const supabase = getAdminClient();

  // Store state in database for CSRF validation in callback
  const { error: stateError } = await supabase
    .from("calcom_oauth_states")
    .insert({
      state_hash: stateHash,
      customer_id: customerId,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
    });

  if (stateError) throw stateError;

  // Redirect to Cal.com authorization
  const authUrl = buildCalcomAuthUrl(state);
  return NextResponse.redirect(authUrl);
});
