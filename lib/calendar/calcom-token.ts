import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { refreshCalcomToken } from "./calcom-oauth";
import { ApiError } from "@/types/errors";

export interface CalcomTokens {
  accessToken: string;
  refreshToken: string | null;
}

// Retrieves and validates Cal.com tokens for a customer, refreshing if expired.
// Throws if no connection exists or refresh fails.
export async function getCalcomTokens(customerId: string): Promise<CalcomTokens> {
  const supabase = getAdminClient();

  const { data: connection, error } = await supabase
    .from("calcom_connections")
    .select("access_token, refresh_token, token_expires_at")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (error) throw error;
  if (!connection) {
    throw ApiError.notFound("Cal.com er ikke forbundet");
  }

  const accessToken = decryptSecret(connection.access_token);

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
    };
  }

  return {
    accessToken,
    refreshToken: connection.refresh_token ? decryptSecret(connection.refresh_token) : null,
  };
}
