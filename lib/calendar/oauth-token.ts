import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";

// Shared token-refresh-on-read for the two OAuth calendar providers (Google,
// Outlook) — same shape as lib/calendar/calcom-token.ts's getCalcomTokens,
// generalized since both providers use the same calendar_connections
// columns (access_token/refresh_token/token_expires_at) and the same
// encrypt-at-rest handling. Returns null (never throws) whenever the
// connection can't be used right now — no connection, an unrecoverable
// expired token, or a failed refresh — so callers in lib/vapi/booking-tools.ts
// and lib/conversation/calendar-tools.ts can degrade to their existing
// "booking not set up" reply instead of a mid-call crash.
export interface OAuthCalendarSession {
  connectionId: string;
  accessToken: string;
  calendarId: string;
  accountEmail: string | null;
  durationMinutes: number;
}

interface RefreshResult {
  accessToken: string;
  expiresAt: string;
  newRefreshToken?: string;
}

export async function getOAuthCalendarSession(
  widgetId: string,
  provider: "google" | "outlook",
  refresh: (refreshToken: string) => Promise<RefreshResult>
): Promise<OAuthCalendarSession | null> {
  const supabase = getAdminClient();

  const { data: connection, error } = await supabase
    .from("calendar_connections")
    .select("id, access_token, refresh_token, token_expires_at, calendar_id, external_account_email, default_duration_minutes")
    .eq("widget_id", widgetId)
    .eq("provider", provider)
    .eq("status", "connected")
    .maybeSingle();

  if (error) throw error;
  if (!connection?.access_token || !connection.calendar_id) return null;

  let accessToken = decryptSecret(connection.access_token);

  if (connection.token_expires_at && new Date(connection.token_expires_at) < new Date()) {
    if (!connection.refresh_token) return null;

    let refreshed: RefreshResult;
    try {
      refreshed = await refresh(decryptSecret(connection.refresh_token));
    } catch (err) {
      console.error(`${provider} token refresh failed for widget ${widgetId}:`, err);
      return null;
    }

    accessToken = refreshed.accessToken;
    const patch: Record<string, unknown> = {
      access_token: encryptSecret(refreshed.accessToken),
      token_expires_at: refreshed.expiresAt,
    };
    if (refreshed.newRefreshToken) patch.refresh_token = encryptSecret(refreshed.newRefreshToken);

    const { error: updateError } = await supabase.from("calendar_connections").update(patch).eq("id", connection.id);
    if (updateError) console.error(`Failed to persist refreshed ${provider} token:`, updateError.message);
  }

  return {
    connectionId: connection.id,
    accessToken,
    calendarId: connection.calendar_id,
    accountEmail: connection.external_account_email,
    durationMinutes: connection.default_duration_minutes ?? 30,
  };
}
