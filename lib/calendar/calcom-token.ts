import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { refreshCalcomToken } from "./calcom-oauth";
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

// Cal.com's own default when a connection predates the timezone column.
const FALLBACK_TIMEZONE = "Europe/Copenhagen";

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
  const timezone = connection.timezone || FALLBACK_TIMEZONE;
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
      timezone,
      defaultEventTypeId,
    };
  }

  return {
    accessToken,
    refreshToken: connection.refresh_token ? decryptSecret(connection.refresh_token) : null,
    timezone,
    defaultEventTypeId,
  };
}
