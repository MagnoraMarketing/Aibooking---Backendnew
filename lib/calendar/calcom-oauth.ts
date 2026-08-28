import "server-only";
import { ApiError } from "@/types/errors";
import type { OAuthTokenResult } from "./types";

const AUTH_URL = "https://app.cal.com/oauth/authorize";
const TOKEN_URL = "https://api.cal.com/oauth/token";
const USERINFO_URL = "https://api.cal.com/v2/me";
const SCOPES = ["profile", "booking:read", "booking:write"].join(" ");

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.CALCOM_CLIENT_ID;
  const clientSecret = process.env.CALCOM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw ApiError.badRequest("Cal.com OAuth er ikke konfigureret endnu. Kontakt support.");
  }
  return { clientId, clientSecret };
}

function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/api/customer/calendar/calcom/callback`;
}

export function buildCalcomAuthUrl(state: string): string {
  const { clientId } = getCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCalcomCode(code: string): Promise<OAuthTokenResult & { userId: number; username: string; email: string; timezone: string | null }> {
  const { clientId, clientSecret } = getCredentials();

  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text().catch(() => "");
    throw new Error(`Cal.com token exchange failed: ${tokenResponse.status} ${body}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  // Fetch user info
  let userId: number | null = null;
  let username: string | null = null;
  let email: string | null = null;
  let timezone: string | null = null;

  try {
    const userResponse = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (userResponse.ok) {
      const userData = (await userResponse.json()) as {
        data?: {
          id?: number;
          username?: string;
          email?: string;
          timeZone?: string;
        };
      };

      if (userData.data) {
        userId = userData.data.id ?? null;
        username = userData.data.username ?? null;
        email = userData.data.email ?? null;
        timezone = userData.data.timeZone ?? null;
      }
    }
  } catch (err) {
    console.error("Failed to fetch Cal.com user info:", err);
    // Non-fatal — the token still works, just without user details
  }

  if (!userId || !username || !email) {
    throw ApiError.badRequest("Kunne ikke hente Cal.com brugeroplysninger. Prøv igen.");
  }

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString(),
    accountEmail: email,
    calendarId: null,
    userId,
    username,
    email,
    timezone,
  };
}

export async function refreshCalcomToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: string; newRefreshToken?: string }> {
  const { clientId, clientSecret } = getCredentials();

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`Cal.com token refresh failed: ${response.status} ${body}`);
    throw new Error("Cal.com token refresh failed");
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
    newRefreshToken: data.refresh_token,
  };
}
