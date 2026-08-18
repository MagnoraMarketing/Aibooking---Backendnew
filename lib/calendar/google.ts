import "server-only";
import { ApiError } from "@/types/errors";
import type { OAuthTokenResult } from "./types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar"].join(" ");

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw ApiError.badRequest("Google Kalender er ikke konfigureret endnu. Kontakt support.");
  }
  return { clientId, clientSecret };
}

function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/api/customer/calendar/google/callback`;
}

export function buildGoogleAuthUrl(state: string): string {
  const { clientId } = getCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCode(code: string): Promise<OAuthTokenResult> {
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
    throw new Error(`Google token exchange failed: ${tokenResponse.status} ${body}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  let accountEmail: string | null = null;
  try {
    const userResponse = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (userResponse.ok) {
      const userData = (await userResponse.json()) as { email?: string };
      accountEmail = userData.email ?? null;
    }
  } catch {
    // Non-fatal — the connection still works without a display email.
  }

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    expiresAt: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
    accountEmail,
    calendarId: "primary",
  };
}
