import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { refreshCalcomToken } from "./calcom-oauth";
import { fetchCalcomTimezoneOAuth } from "./calcom";
import { ApiError } from "@/types/errors";

export interface CalcomTokens {
  accessToken: string;
  refreshToken: string | null;
  // The customer's own timezone, used for every availability and booking call
  // so slots are quoted in the calendar owner's local time rather than a
  // hardcoded one.
  timezone: string;
  // Event type bookings default to when the caller doesn't name one.
  defaultEventTypeId: number | null;
}

// Used only when Cal.com won't tell us the account's timezone — a connection
// with a null timezone is retried on the next call rather than pinned to this.
const FALLBACK_TIMEZONE = "Europe/Copenhagen";

// A connection stored before the callback kept the account's timezone has a
// null in the column (see migration 0028). Ask Cal.com for the real one and
// store it, so the backfill costs one extra request per connection, once.
async function resolveTimezone(
  customerId: string,
  stored: string | null,
  accessToken: string
): Promise<string> {
  if (stored) return stored;

  let timezone: string | null = null;
  try {
    timezone = await fetchCalcomTimezoneOAuth(accessToken);
  } catch (err) {
    console.error("Cal.com timezone lookup failed:", err);
  }

  // Leave the column null on a failure so the next call tries again instead of
  // pinning the connection to a guess.
  if (!timezone) return FALLBACK_TIMEZONE;

  const { error } = await getAdminClient()
    .from("calcom_connections")
    .update({ timezone })
    .eq("customer_id", customerId);

  if (error) console.error("Failed to store Cal.com timezone:", error);

  return timezone;
}

// Cal.com event type ids are numeric but stored as text on the connection.
function parseEventTypeId(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// Retrieves and validates Cal.com tokens for a customer, refreshing if expired.
// Throws if no connection exists or refresh fails.
export async function getCalcomTokens(customerId: string): Promise<CalcomTokens> {
  const supabase = getAdminClient();

  const { data: connection, error } = await supabase
    .from("calcom_connections")
    .select("access_token, refresh_token, token_expires_at, timezone, calcom_event_type_id")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (error) throw error;
  if (!connection) {
    throw ApiError.notFound("Cal.com er ikke forbundet");
  }

  const accessToken = decryptSecret(connection.access_token);
  const defaultEventTypeId = parseEventTypeId(connection.calcom_event_type_id);

  // Check if token needs refresh
  if (connection.token_expires_at && new Date(connection.token_expires_at) < new Date()) {
    if (!connection.refresh_token) {
      throw ApiError.badRequest("Cal.com token har udløbet og kan ikke opdateres. Forbind igen.");
    }

    const refreshToken = decryptSecret(connection.refresh_token);
    let newTokens;
    try {
      newTokens = await refreshCalcomToken(refreshToken);
    } catch (err) {
      console.error("Cal.com token refresh failed:", err);
      throw ApiError.badRequest("Kunne ikke opdatere Cal.com token. Forbind igen.");
    }

    // Update stored tokens
    const { error: updateError } = await supabase
      .from("calcom_connections")
      .update({
        access_token: encryptSecret(newTokens.accessToken),
        token_expires_at: newTokens.expiresAt,
        ...(newTokens.newRefreshToken && { refresh_token: encryptSecret(newTokens.newRefreshToken) }),
      })
      .eq("customer_id", customerId);

    if (updateError) throw updateError;

    return {
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.newRefreshToken ? refreshToken : null,
      // Resolved with the refreshed token — the expired one would be rejected.
      timezone: await resolveTimezone(customerId, connection.timezone, newTokens.accessToken),
      defaultEventTypeId,
    };
  }

  return {
    accessToken,
    refreshToken: connection.refresh_token ? decryptSecret(connection.refresh_token) : null,
    timezone: await resolveTimezone(customerId, connection.timezone, accessToken),
    defaultEventTypeId,
  };
}
