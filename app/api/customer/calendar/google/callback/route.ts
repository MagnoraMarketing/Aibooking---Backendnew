import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { withErrorHandling, writeAuditLog, encryptSecret } from "@/lib/security";
import { exchangeGoogleCode, parseOAuthState, cookieNameForProvider } from "@/lib/calendar";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

function redirectWithStatus(request: Request, status: "connected" | "error", provider = "google") {
  const url = new URL("/dashboard/integrations", request.url);
  url.searchParams.set(status === "connected" ? "connected" : "calendarError", provider);
  return NextResponse.redirect(url);
}

export const GET = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const cookieStore = cookies();
  const cookieName = cookieNameForProvider("google");
  const expectedNonce = cookieStore.get(cookieName)?.value;
  cookieStore.delete(cookieName);

  if (!code || !state || !expectedNonce) return redirectWithStatus(request, "error");

  const parsedState = parseOAuthState(state, expectedNonce);
  if (!parsedState) return redirectWithStatus(request, "error");

  const supabase = getAdminClient();
  const { data: widget, error: widgetError } = await supabase
    .from("widgets")
    .select("id, customer_id")
    .eq("id", parsedState.widgetId)
    .maybeSingle();
  if (widgetError) throw widgetError;
  if (!widget || widget.customer_id !== ctx.profile.customer_id) throw ApiError.notFound("Widget not found");

  let tokenResult;
  try {
    tokenResult = await exchangeGoogleCode(code);
  } catch (err) {
    console.error("Google Calendar OAuth exchange failed:", err);
    return redirectWithStatus(request, "error");
  }

  // Google only sends a refresh_token on the very first consent for a given
  // account+scopes — a later reconnect can omit it, so keep the existing
  // (already-encrypted) column value as-is rather than overwriting it with
  // null. Only a freshly-issued token, still plaintext from Google, needs
  // encrypting here.
  let refreshToken = tokenResult.refreshToken ? encryptSecret(tokenResult.refreshToken) : null;
  if (!refreshToken) {
    const { data: existing } = await supabase
      .from("calendar_connections")
      .select("refresh_token")
      .eq("widget_id", widget.id)
      .eq("provider", "google")
      .maybeSingle();
    refreshToken = existing?.refresh_token ?? null;
  }

  const { error } = await supabase.from("calendar_connections").upsert(
    {
      customer_id: widget.customer_id,
      widget_id: widget.id,
      provider: "google",
      status: "connected",
      external_account_email: tokenResult.accountEmail,
      calendar_id: tokenResult.calendarId,
      // Encrypted at rest with the same AES-256-GCM helper already used for
      // Cal.com/Shopify credentials (lib/security/crypto.ts) — every read
      // site must decryptSecret() before calling Google's API.
      access_token: encryptSecret(tokenResult.accessToken),
      refresh_token: refreshToken,
      token_expires_at: tokenResult.expiresAt,
    },
    { onConflict: "widget_id,provider" }
  );
  if (error) throw error;

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId: widget.customer_id,
    action: "calendar_connection.connected",
    entityType: "widget",
    entityId: widget.id,
    metadata: { provider: "google" },
  });

  return redirectWithStatus(request, "connected");
});
