// Plain function, no server-only import: the dialer normalizes pasted
// lead lists in the browser (components/dashboard/dialer-manager.tsx).
//
// Lists come out of spreadsheets and CRMs, where Danish numbers are rarely
// written in E.164 — "12 34 56 78", "0045 12345678", "+45 12-34-56-78".
// The server only accepts E.164 (and Twilio only dials it), so a single
// such line used to reject the whole upload. Normalized here instead:
// separators dropped, a 00 prefix read as +, and a bare 8-digit number read
// as Danish. Anything else is passed through untouched for the server to
// reject with its own message.
export function normalizeLeadPhoneNumber(raw: string): string {
  const trimmed = raw.trim();
  const compact = trimmed.replace(/[\s\-().]/g, "");
  if (/^\+\d+$/.test(compact)) return compact;
  if (/^00\d+$/.test(compact)) return `+${compact.slice(2)}`;
  if (/^\d{8}$/.test(compact)) return `+45${compact}`;
  if (/^45\d{8}$/.test(compact)) return `+${compact}`;
  return trimmed;
}
