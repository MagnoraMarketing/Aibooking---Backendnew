import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog, encryptSecret } from "@/lib/security";
import { exchangeCalcomCode, hashOAuthState } from "@/lib/calendar";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

function redirectWithStatus(request: Request, status: "connected" | "error") {
  const url = new URL("/dashboard/integrations", request.url);
  url.searchParams.set(status === "connected" ? "connected" : "calendarError", "calcom");
  return NextResponse.redirect(url);
}

export const GET = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  // Handle OAuth error from Cal.com
  if (error) {
    console.warn("Cal.com OAuth error:", error, errorDescription);
    return redirectWithStatus(request, "error");
  }

  if (!code || !state) {
    return redirectWithStatus(request, "error");
  }

  const customerId = ctx.profile.customer_id!;
  const supabase = getAdminClient();
  const stateHash = hashOAuthState(state);

  // Verify state in database (CSRF protection)
  const { data: stateRow, error: stateError } = await supabase
    .from("calcom_oauth_states")
    .select("state_hash, customer_id, expires_at")
    .eq("state_hash", stateHash)
    .eq("customer_id", customerId)
    .maybeSingle();

  if (stateError) throw stateError;
  if (!stateRow) {
    console.warn("Invalid or expired OAuth state for customer:", customerId);
    return redirectWithStatus(request, "error");
  }

  // Check expiry
  if (new Date(stateRow.expires_at) < new Date()) {
    console.warn("OAuth state expired for customer:", customerId);
    return redirectWithStatus(request, "error");
  }

  // Delete state after validation (one-time use)
  await supabase.from("calcom_oauth_states").delete().eq("state_hash", stateHash);

  // Exchange code for tokens
  let tokenResult;
  try {
    tokenResult = await exchangeCalcomCode(code);
  } catch (err) {
    console.error("Cal.com OAuth exchange failed:", err);
    return redirectWithStatus(request, "error");
  }

  // Get refresh token from existing connection if this is a reconnect
  let refreshToken = tokenResult.refreshToken;
  if (!refreshToken) {
    const { data: existing } = await supabase
      .from("calcom_connections")
      .select("refresh_token")
      .eq("customer_id", customerId)
      .maybeSingle();
    refreshToken = existing?.refresh_token ?? null;
  }

  // Upsert connection
  const { error: upsertError } = await supabase.from("calcom_connections").upsert(
    {
      customer_id: customerId,
      calcom_user_id: String(tokenResult.userId),
      calcom_username: tokenResult.username,
      calcom_email: tokenResult.email,
      access_token: encryptSecret(tokenResult.accessToken),
      refresh_token: refreshToken ? encryptSecret(refreshToken) : null,
      token_expires_at: tokenResult.expiresAt,
      scope: "profile booking:read booking:write",
      // Cal.com reports the account's own timezone; keep the column default
      // when the userinfo call didn't carry one.
      ...(tokenResult.timezone ? { timezone: tokenResult.timezone } : {}),
    },
    { onConflict: "customer_id" }
  );

  if (upsertError) throw upsertError;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "calendar_connection.connected",
    entityType: "customer",
    entityId: customerId,
    metadata: { provider: "calcom", oauthFlow: true },
  });

  return redirectWithStatus(request, "connected");
});
