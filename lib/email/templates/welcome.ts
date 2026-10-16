// The welcome email a self-signup customer gets right after creating their
// account. Same table-based layout and inline styles as the invite template
// (the only thing Gmail, Outlook and Apple Mail all render consistently),
// but where the invite's one job is "choose a password", this one walks
// through what to do next and hands over the embed code, so the customer can
// go live without first finding the Indlejringskode tab in the dashboard.

export interface WelcomeEmailParams {
  companyName: string;
  dashboardUrl: string;
  agentUrl: string;
  // null when the customer has no embed access yet (no free trial minutes
  // configured) — the code step then points at choosing a package instead.
  embedSnippet: string | null;
  trialMinutes: number;
  trialDays: number;
}

export function buildWelcomeEmailHtml(params: WelcomeEmailParams): string {
  const { companyName, dashboardUrl, agentUrl, embedSnippet, trialMinutes, trialDays } = params;

  const steps: Array<{ title: string; body: string }> = [
    {
      title: "Log ind på dit dashboard",
      body: `Brug den e-mail og adgangskode, du lige har oprettet dig med, på <a href="${escapeAttribute(dashboardUrl)}" style="color:#264ed1; text-decoration:none;">${escapeHtml(stripScheme(dashboardUrl))}</a>.`,
    },
    {
      title: "Tilpas din AI-agent",
      body: "Vi har allerede sat din første agent op. Giv den et navn, en velkomsthilsen og en stemme, og fortæl den om din virksomhed, dine åbningstider og dine ydelser.",
    },
    {
      title: "Test agenten",
      body: "Tal med agenten direkte i forhåndsvisningen i dashboardet, og ret til, indtil den svarer, som du vil have det.",
    },
    embedSnippet
      ? {
          title: "Sæt agenten på din hjemmeside",
          body: "Kopiér koden nedenfor og indsæt den på din hjemmeside lige før <code style=\"font-family:Menlo,Consolas,monospace; font-size:13px;\">&lt;/body&gt;</code>. Bruger du WordPress, Shopify, Wix eller lignende, kan koden indsættes som en \"brugerdefineret kode\" / \"custom HTML\".",
        }
      : {
          title: "Sæt agenten på din hjemmeside",
          body: "Når du har valgt en pakke under Abonnement i dashboardet, finder du koden til din hjemmeside under Indlejringskode på din agent.",
        },
    {
      title: "Vælg en pakke",
      body:
        trialMinutes > 0
          ? `Du har ${trialMinutes} gratis minutter, som gælder i ${trialDays} dage. Vælg en pakke under Abonnement, før prøveperioden udløber, så din agent bliver ved med at svare.`
          : "Vælg en pakke under Abonnement for at gå live.",
    },
  ];

  const stepsHtml = steps
    .map(
      (step, index) => `
              <tr>
                <td style="padding:0 14px 20px 0; vertical-align:top; width:28px;">
                  <div style="width:28px; height:28px; line-height:28px; border-radius:14px; background-color:#e0e7ff; color:#264ed1; font-size:14px; font-weight:600; text-align:center;">${index + 1}</div>
                </td>
                <td style="padding:0 0 20px 0; vertical-align:top;">
                  <p style="margin:3px 0 4px 0; color:#0f172a; font-size:15px; font-weight:600;">${escapeHtml(step.title)}</p>
                  <p style="margin:0; color:#475569; font-size:14px; line-height:1.6;">${step.body}</p>
                </td>
              </tr>`
    )
    .join("");

  const embedHtml = embedSnippet
    ? `
            <tr>
              <td style="padding:0 32px 24px 32px;">
                <p style="margin:0 0 8px 0; color:#0f172a; font-size:14px; font-weight:600;">Din kode til hjemmesiden</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background-color:#0f172a; border-radius:10px; padding:16px;">
                      <code style="font-family:Menlo,Consolas,monospace; font-size:12px; line-height:1.6; color:#e2e8f0; word-break:break-all;">${escapeHtml(embedSnippet)}</code>
                    </td>
                  </tr>
                </table>
                <p style="margin:8px 0 0 0; color:#94a3b8; font-size:12px; line-height:1.6;">
                  Du kan altid finde koden igen under Indlejringskode på din agent i dashboardet.
                </p>
              </td>
            </tr>`
    : "";

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
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%; background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 1px 3px rgba(15,23,42,0.08);">
            <tr>
              <td style="background-color:#264ed1; padding:28px 32px;">
                <span style="color:#ffffff; font-size:18px; font-weight:600; letter-spacing:-0.01em;">AIbooking.dk</span>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px 8px 32px;">
                <h1 style="margin:0 0 16px 0; color:#0f172a; font-size:22px; font-weight:600; line-height:1.3;">
                  Velkommen til AIbooking.dk 👋
                </h1>
                <p style="margin:0 0 24px 0; color:#475569; font-size:15px; line-height:1.6;">
                  Tak fordi ${escapeHtml(companyName)} har oprettet sig. Din konto og din første AI-agent er klar — her er,
                  hvad du skal gøre for at få den til at svare dine kunder.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 4px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${stepsHtml}
                </table>
              </td>
            </tr>${embedHtml}
            <tr>
              <td style="padding:0 32px 32px 32px;" align="center">
                <a href="${escapeAttribute(agentUrl)}" style="display:inline-block; background-color:#264ed1; color:#ffffff; font-size:15px; font-weight:600; text-decoration:none; padding:13px 28px; border-radius:10px;">
                  Gå til din agent
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; background-color:#f8fafc; border-top:1px solid #e2e8f0;">
                <p style="margin:0; color:#94a3b8; font-size:12px; line-height:1.6;">
                  Spørgsmål eller brug for hjælp til at komme i gang? Svar på denne mail eller skriv til
                  <a href="mailto:mail@aibooking.dk" style="color:#264ed1;">mail@aibooking.dk</a> — vi hjælper gerne.
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

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//i, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(href: string): string {
  const safe = /^https?:\/\//i.test(href) ? href : "#";
  return escapeHtml(safe);
}
