// The internal "noget skete på platformen" email — a new signup, a payment —
// sent to the platform's own inbox rather than to a customer. Same
// table-based layout and inline styles as the invite template (the only
// thing Gmail, Outlook and Apple Mail all render consistently), but styled
// as a notice rather than a welcome: the point is to be skimmable on a phone
// and to put the customer's contact details one tap away.

export interface InternalNotificationRow {
  label: string;
  value: string;
  // Renders the value as a link — "tel:" for a phone number, "mailto:" for
  // an address — so it can be dialled or answered straight from the mail.
  href?: string;
}

export interface InternalNotificationEmailParams {
  heading: string;
  intro: string;
  rows: InternalNotificationRow[];
  accentColor?: string;
  footerNote?: string;
}

export function buildInternalNotificationEmailHtml(params: InternalNotificationEmailParams): string {
  const { heading, intro, rows, footerNote } = params;
  const accentColor = params.accentColor ?? "#264ed1";

  const rowsHtml = rows
    .map(
      (row) => `
              <tr>
                <td style="padding:10px 0; border-bottom:1px solid #e2e8f0; color:#64748b; font-size:13px; width:38%; vertical-align:top;">
                  ${escapeHtml(row.label)}
                </td>
                <td style="padding:10px 0; border-bottom:1px solid #e2e8f0; color:#0f172a; font-size:14px; font-weight:500; vertical-align:top;">
                  ${row.href ? `<a href="${escapeAttribute(row.href)}" style="color:${accentColor}; text-decoration:none;">${escapeHtml(row.value)}</a>` : escapeHtml(row.value)}
                </td>
              </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="da">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f1f5f9; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9; padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 1px 3px rgba(15,23,42,0.08);">
            <tr>
              <td style="background-color:${accentColor}; padding:28px 32px;">
                <span style="color:#ffffff; font-size:18px; font-weight:600; letter-spacing:-0.01em;">AIbooking.dk</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <h1 style="margin:0 0 12px 0; color:#0f172a; font-size:20px; font-weight:600; line-height:1.3;">
                  ${escapeHtml(heading)}
                </h1>
                <p style="margin:0; color:#475569; font-size:15px; line-height:1.6;">
                  ${escapeHtml(intro)}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 8px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; background-color:#f8fafc; border-top:1px solid #e2e8f0;">
                <p style="margin:0; color:#94a3b8; font-size:12px; line-height:1.6;">
                  ${escapeHtml(footerNote ?? "Automatisk besked fra AIbooking.dk-platformen.")}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Hrefs are built by us from a customer's email/phone, so the danger isn't a
// crafted URL scheme but a quote breaking out of the attribute — escape the
// same characters, and strip anything that isn't a mailto:/tel: link.
function escapeAttribute(href: string): string {
  const safe = /^(mailto:|tel:|https:\/\/)/i.test(href) ? href : "#";
  return escapeHtml(safe);
}
