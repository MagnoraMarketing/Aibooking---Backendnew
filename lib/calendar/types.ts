import "server-only";

// Shared shape both OAuth providers (Google, Outlook) return after a
// successful token exchange — persisted straight into calendar_connections.
export interface OAuthTokenResult {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null; // ISO timestamp
  accountEmail: string | null;
  calendarId: string | null;
}
