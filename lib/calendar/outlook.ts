import "server-only";
import { ApiError } from "@/types/errors";
import type { OAuthTokenResult } from "./types";

// Microsoft 365 / Outlook — the other dominant business calendar in
// Denmark alongside Google Workspace. Uses the Microsoft identity platform
// v2.0 endpoint against the "common" tenant so both work and personal
// Microsoft accounts can connect.
const AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const ME_URL = "https://graph.microsoft.com/v1.0/me";
const SCOPES = ["offline_access", "User.Read", "Calendars.ReadWrite"].join(" ");

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw ApiError.badRequest("Outlook/Microsoft 365 Kalender er ikke konfigureret endnu. Kontakt support.");
  }
  return { clientId, clientSecret };
}

function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/api/customer/calendar/outlook/callback`;
}

export function buildOutlookAuthUrl(state: string): string {
  const { clientId } = getCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    response_mode: "query",
    scope: SCOPES,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeOutlookCode(code: string): Promise<OAuthTokenResult> {
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
      scope: SCOPES,
    }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text().catch(() => "");
    throw new Error(`Outlook token exchange failed: ${tokenResponse.status} ${body}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  let accountEmail: string | null = null;
  try {
    const meResponse = await fetch(ME_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (meResponse.ok) {
      const meData = (await meResponse.json()) as { mail?: string; userPrincipalName?: string };
      accountEmail = meData.mail ?? meData.userPrincipalName ?? null;
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
