// Table-based layout + inline styles throughout — the only way to get a
// consistent result across Gmail, Outlook and Apple Mail, none of which
// reliably support a <style> block or CSS classes in transactional mail.
export function buildInviteEmailHtml(params: { recipientName: string; companyName: string; actionLink: string }): string {
  const { recipientName, companyName, actionLink } = params;

  return `<!doctype html>
<html lang="da">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Velkommen til AIbooking.dk</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f1f5f9; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9; padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 1px 3px rgba(15,23,42,0.08);">
            <tr>
              <td style="background-color:#264ed1; padding:28px 32px;">
                <span style="color:#ffffff; font-size:18px; font-weight:600; letter-spacing:-0.01em;">AIbooking.dk</span>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px 8px 32px;">
                <h1 style="margin:0 0 16px 0; color:#0f172a; font-size:22px; font-weight:600; line-height:1.3;">
                  Velkommen, ${escapeHtml(recipientName)} 👋
                </h1>
                <p style="margin:0 0 16px 0; color:#475569; font-size:15px; line-height:1.6;">
                  ${escapeHtml(companyName)} er nu oprettet på AIbooking.dk. Vi har allerede sat jeres første AI-agent op og
                  klargjort jeres konto — I skal blot vælge en adgangskode for at komme i gang.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 32px 32px;" align="center">
                <a href="${actionLink}" style="display:inline-block; background-color:#264ed1; color:#ffffff; font-size:15px; font-weight:600; text-decoration:none; padding:13px 28px; border-radius:10px;">
                  Vælg adgangskode og log ind
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px 32px;">
                <p style="margin:0; color:#94a3b8; font-size:12px; line-height:1.6;">
                  Virker knappen ikke? Kopiér og indsæt dette link i din browser:<br />
                  <a href="${actionLink}" style="color:#264ed1; word-break:break-all;">${actionLink}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; background-color:#f8fafc; border-top:1px solid #e2e8f0;">
                <p style="margin:0; color:#94a3b8; font-size:12px; line-height:1.6;">
                  Spørgsmål? Skriv til os på
                  <a href="mailto:mail@aibooking.dk" style="color:#264ed1;">mail@aibooking.dk</a> — vi svarer altid gerne.
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
