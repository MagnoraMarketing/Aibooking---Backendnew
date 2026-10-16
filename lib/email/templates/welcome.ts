import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/locales";

// The welcome email a self-signup customer gets right after creating their
// account. Same table-based layout and inline styles as the invite template
// (the only thing Gmail, Outlook and Apple Mail all render consistently),
// but where the invite's one job is "choose a password", this one walks
// through what to do next and hands over the embed code, so the customer can
// go live without first finding the embed code tab in the dashboard.
//
// Written in the language picked on /signup — the same six LOCALES the
// dashboard speaks. The copy lives here rather than in lib/i18n/dictionaries
// because those are UI strings resolved via t(); an email is rendered once,
// server-side, and its steps carry inline HTML (links, <code>).

export interface WelcomeEmailParams {
  // Anything outside LOCALES falls back to Danish, like the rest of the
  // platform.
  language: string;
  companyName: string;
  dashboardUrl: string;
  agentUrl: string;
  // null when the customer has no embed access yet (no free trial minutes
  // configured) — the code step then points at choosing a package instead.
  embedSnippet: string | null;
  trialMinutes: number;
  trialDays: number;
}

interface WelcomeCopy {
  subject: string;
  heading: string;
  // companyName is already HTML-escaped when these are called.
  intro: (companyName: string) => string;
  loginTitle: string;
  loginBody: (dashboardLink: string) => string;
  customizeTitle: string;
  customizeBody: string;
  testTitle: string;
  testBody: string;
  embedTitle: string;
  embedBody: (bodyTag: string) => string;
  embedLockedBody: string;
  packageTitle: string;
  packageTrialBody: (minutes: number, days: number) => string;
  packageNoTrialBody: string;
  codeLabel: string;
  codeHint: string;
  cta: string;
  footer: (mailLink: string) => string;
}

const COPY: Record<Locale, WelcomeCopy> = {
  da: {
    subject: "Velkommen til AIbooking.dk – sådan kommer du i gang",
    heading: "Velkommen til AIbooking.dk 👋",
    intro: (c) =>
      `Tak fordi ${c} har oprettet sig. Din konto og din første AI-agent er klar — her er, hvad du skal gøre for at få den til at svare dine kunder.`,
    loginTitle: "Log ind på dit dashboard",
    loginBody: (l) => `Brug den e-mail og adgangskode, du lige har oprettet dig med, på ${l}.`,
    customizeTitle: "Tilpas din AI-agent",
    customizeBody:
      "Vi har allerede sat din første agent op. Giv den et navn, en velkomsthilsen og en stemme, og fortæl den om din virksomhed, dine åbningstider og dine ydelser.",
    testTitle: "Test agenten",
    testBody: "Tal med agenten direkte i forhåndsvisningen i dashboardet, og ret til, indtil den svarer, som du vil have det.",
    embedTitle: "Sæt agenten på din hjemmeside",
    embedBody: (b) =>
      `Kopiér koden nedenfor og indsæt den på din hjemmeside lige før ${b}. Bruger du WordPress, Shopify, Wix eller lignende, kan koden indsættes som en "brugerdefineret kode" / "custom HTML".`,
    embedLockedBody:
      "Når du har valgt en pakke under Abonnement i dashboardet, finder du koden til din hjemmeside under Indlejringskode på din agent.",
    packageTitle: "Vælg en pakke",
    packageTrialBody: (m, d) =>
      `Du har ${m} gratis minutter, som gælder i ${d} dage. Vælg en pakke under Abonnement, før prøveperioden udløber, så din agent bliver ved med at svare.`,
    packageNoTrialBody: "Vælg en pakke under Abonnement for at gå live.",
    codeLabel: "Din kode til hjemmesiden",
    codeHint: "Du kan altid finde koden igen under Indlejringskode på din agent i dashboardet.",
    cta: "Gå til din agent",
    footer: (l) => `Spørgsmål eller brug for hjælp til at komme i gang? Svar på denne mail eller skriv til ${l} — vi hjælper gerne.`,
  },
  en: {
    subject: "Welcome to AIbooking.dk – here's how to get started",
    heading: "Welcome to AIbooking.dk 👋",
    intro: (c) =>
      `Thanks for signing up ${c}. Your account and your first AI agent are ready — here's what to do to have it answering your customers.`,
    loginTitle: "Log in to your dashboard",
    loginBody: (l) => `Use the email and password you just signed up with at ${l}.`,
    customizeTitle: "Customise your AI agent",
    customizeBody:
      "We've already set up your first agent. Give it a name, a greeting and a voice, and tell it about your business, your opening hours and your services.",
    testTitle: "Test the agent",
    testBody: "Talk to the agent right in the dashboard preview and adjust it until it answers the way you want.",
    embedTitle: "Put the agent on your website",
    embedBody: (b) =>
      `Copy the code below and paste it into your website just before ${b}. On WordPress, Shopify, Wix or similar, add it as "custom code" / "custom HTML".`,
    embedLockedBody:
      "Once you've chosen a package under Subscription in the dashboard, you'll find the code for your website under Embed Code on your agent.",
    packageTitle: "Choose a package",
    packageTrialBody: (m, d) =>
      `You have ${m} free minutes, valid for ${d} days. Choose a package under Subscription before the trial ends so your agent keeps answering.`,
    packageNoTrialBody: "Choose a package under Subscription to go live.",
    codeLabel: "Your website code",
    codeHint: "You can always find the code again under Embed Code on your agent in the dashboard.",
    cta: "Go to your agent",
    footer: (l) => `Questions, or need help getting started? Reply to this email or write to ${l} — we're happy to help.`,
  },
  es: {
    subject: "Bienvenido a AIbooking.dk – cómo empezar",
    heading: "Bienvenido a AIbooking.dk 👋",
    intro: (c) =>
      `Gracias por registrar ${c}. Tu cuenta y tu primer agente de IA están listos: esto es lo que debes hacer para que empiece a atender a tus clientes.`,
    loginTitle: "Inicia sesión en tu panel",
    loginBody: (l) => `Usa el correo y la contraseña con los que te acabas de registrar en ${l}.`,
    customizeTitle: "Personaliza tu agente de IA",
    customizeBody:
      "Ya hemos creado tu primer agente. Dale un nombre, un saludo y una voz, y cuéntale sobre tu negocio, tu horario y tus servicios.",
    testTitle: "Prueba el agente",
    testBody: "Habla con el agente directamente en la vista previa del panel y ajústalo hasta que responda como quieres.",
    embedTitle: "Pon el agente en tu sitio web",
    embedBody: (b) =>
      `Copia el código de abajo y pégalo en tu sitio web justo antes de ${b}. En WordPress, Shopify, Wix o similares, añádelo como "código personalizado" / "HTML personalizado".`,
    embedLockedBody:
      "Cuando hayas elegido un plan en Suscripción en el panel, encontrarás el código para tu sitio web en Código de inserción de tu agente.",
    packageTitle: "Elige un plan",
    packageTrialBody: (m, d) =>
      `Tienes ${m} minutos gratis, válidos durante ${d} días. Elige un plan en Suscripción antes de que termine la prueba para que tu agente siga respondiendo.`,
    packageNoTrialBody: "Elige un plan en Suscripción para empezar a funcionar.",
    codeLabel: "Tu código para el sitio web",
    codeHint: "Siempre puedes volver a encontrar el código en Código de inserción de tu agente en el panel.",
    cta: "Ir a tu agente",
    footer: (l) => `¿Preguntas o necesitas ayuda para empezar? Responde a este correo o escribe a ${l}; te ayudaremos encantados.`,
  },
  fr: {
    subject: "Bienvenue sur AIbooking.dk – comment démarrer",
    heading: "Bienvenue sur AIbooking.dk 👋",
    intro: (c) =>
      `Merci d'avoir inscrit ${c}. Votre compte et votre premier agent IA sont prêts — voici ce qu'il faut faire pour qu'il réponde à vos clients.`,
    loginTitle: "Connectez-vous à votre tableau de bord",
    loginBody: (l) => `Utilisez l'e-mail et le mot de passe avec lesquels vous venez de vous inscrire sur ${l}.`,
    customizeTitle: "Personnalisez votre agent IA",
    customizeBody:
      "Nous avons déjà configuré votre premier agent. Donnez-lui un nom, un message d'accueil et une voix, et parlez-lui de votre entreprise, de vos horaires et de vos services.",
    testTitle: "Testez l'agent",
    testBody: "Parlez à l'agent directement dans l'aperçu du tableau de bord et ajustez-le jusqu'à ce qu'il réponde comme vous le souhaitez.",
    embedTitle: "Ajoutez l'agent à votre site web",
    embedBody: (b) =>
      `Copiez le code ci-dessous et collez-le sur votre site juste avant ${b}. Sur WordPress, Shopify, Wix ou similaire, ajoutez-le comme « code personnalisé » / « HTML personnalisé ».`,
    embedLockedBody:
      "Une fois une offre choisie sous Abonnement dans le tableau de bord, vous trouverez le code pour votre site sous Code d'intégration de votre agent.",
    packageTitle: "Choisissez une offre",
    packageTrialBody: (m, d) =>
      `Vous disposez de ${m} minutes gratuites, valables ${d} jours. Choisissez une offre sous Abonnement avant la fin de l'essai pour que votre agent continue de répondre.`,
    packageNoTrialBody: "Choisissez une offre sous Abonnement pour passer en ligne.",
    codeLabel: "Votre code pour le site web",
    codeHint: "Vous retrouverez toujours le code sous Code d'intégration de votre agent dans le tableau de bord.",
    cta: "Accéder à votre agent",
    footer: (l) => `Des questions ou besoin d'aide pour démarrer ? Répondez à cet e-mail ou écrivez à ${l} — nous vous aiderons avec plaisir.`,
  },
  pt: {
    subject: "Bem-vindo ao AIbooking.dk – como começar",
    heading: "Bem-vindo ao AIbooking.dk 👋",
    intro: (c) =>
      `Obrigado por registar ${c}. A sua conta e o seu primeiro agente de IA estão prontos — veja o que fazer para que ele comece a atender os seus clientes.`,
    loginTitle: "Inicie sessão no seu painel",
    loginBody: (l) => `Use o e-mail e a palavra-passe com que acabou de se registar em ${l}.`,
    customizeTitle: "Personalize o seu agente de IA",
    customizeBody:
      "Já configurámos o seu primeiro agente. Dê-lhe um nome, uma saudação e uma voz, e fale-lhe sobre a sua empresa, o seu horário e os seus serviços.",
    testTitle: "Teste o agente",
    testBody: "Fale com o agente diretamente na pré-visualização do painel e ajuste-o até responder como pretende.",
    embedTitle: "Coloque o agente no seu site",
    embedBody: (b) =>
      `Copie o código abaixo e cole-o no seu site imediatamente antes de ${b}. Em WordPress, Shopify, Wix ou semelhantes, adicione-o como "código personalizado" / "HTML personalizado".`,
    embedLockedBody:
      "Depois de escolher um plano em Subscrição no painel, encontra o código para o seu site em Código de incorporação do seu agente.",
    packageTitle: "Escolha um plano",
    packageTrialBody: (m, d) =>
      `Tem ${m} minutos grátis, válidos durante ${d} dias. Escolha um plano em Subscrição antes de o período de teste terminar para que o seu agente continue a responder.`,
    packageNoTrialBody: "Escolha um plano em Subscrição para entrar em funcionamento.",
    codeLabel: "O seu código para o site",
    codeHint: "Pode sempre encontrar o código novamente em Código de incorporação do seu agente no painel.",
    cta: "Ir para o seu agente",
    footer: (l) => `Dúvidas ou precisa de ajuda para começar? Responda a este e-mail ou escreva para ${l} — teremos todo o gosto em ajudar.`,
  },
  de: {
    subject: "Willkommen bei AIbooking.dk – so legen Sie los",
    heading: "Willkommen bei AIbooking.dk 👋",
    intro: (c) =>
      `Danke, dass Sie ${c} registriert haben. Ihr Konto und Ihr erster KI-Agent sind bereit — so bringen Sie ihn dazu, Ihren Kunden zu antworten.`,
    loginTitle: "Melden Sie sich im Dashboard an",
    loginBody: (l) => `Verwenden Sie die E-Mail-Adresse und das Passwort, mit denen Sie sich gerade registriert haben, auf ${l}.`,
    customizeTitle: "Passen Sie Ihren KI-Agenten an",
    customizeBody:
      "Wir haben Ihren ersten Agenten bereits eingerichtet. Geben Sie ihm einen Namen, eine Begrüßung und eine Stimme, und erzählen Sie ihm von Ihrem Unternehmen, Ihren Öffnungszeiten und Ihren Leistungen.",
    testTitle: "Testen Sie den Agenten",
    testBody: "Sprechen Sie direkt in der Vorschau im Dashboard mit dem Agenten und passen Sie ihn an, bis er so antwortet, wie Sie es möchten.",
    embedTitle: "Binden Sie den Agenten auf Ihrer Website ein",
    embedBody: (b) =>
      `Kopieren Sie den Code unten und fügen Sie ihn auf Ihrer Website direkt vor ${b} ein. Bei WordPress, Shopify, Wix o. Ä. fügen Sie ihn als „benutzerdefinierten Code“ / „Custom HTML“ hinzu.`,
    embedLockedBody:
      "Sobald Sie unter Abonnement im Dashboard ein Paket gewählt haben, finden Sie den Code für Ihre Website unter Einbettungscode bei Ihrem Agenten.",
    packageTitle: "Wählen Sie ein Paket",
    packageTrialBody: (m, d) =>
      `Sie haben ${m} kostenlose Minuten, gültig für ${d} Tage. Wählen Sie vor Ende der Testphase unter Abonnement ein Paket, damit Ihr Agent weiter antwortet.`,
    packageNoTrialBody: "Wählen Sie unter Abonnement ein Paket, um live zu gehen.",
    codeLabel: "Ihr Code für die Website",
    codeHint: "Sie finden den Code jederzeit wieder unter Einbettungscode bei Ihrem Agenten im Dashboard.",
    cta: "Zu Ihrem Agenten",
    footer: (l) => `Fragen oder Hilfe beim Einstieg nötig? Antworten Sie auf diese E-Mail oder schreiben Sie an ${l} — wir helfen gern.`,
  },
};

export function welcomeEmailLocale(language: string): Locale {
  return isLocale(language) ? language : DEFAULT_LOCALE;
}

export function welcomeEmailSubject(language: string): string {
  return COPY[welcomeEmailLocale(language)].subject;
}

export function buildWelcomeEmailHtml(params: WelcomeEmailParams): string {
  const { dashboardUrl, agentUrl, embedSnippet, trialMinutes, trialDays } = params;
  const locale = welcomeEmailLocale(params.language);
  const copy = COPY[locale];

  const dashboardLink = `<a href="${escapeAttribute(dashboardUrl)}" style="color:#264ed1; text-decoration:none;">${escapeHtml(stripScheme(dashboardUrl))}</a>`;
  const bodyTag = `<code style="font-family:Menlo,Consolas,monospace; font-size:13px;">&lt;/body&gt;</code>`;
  const mailLink = `<a href="mailto:mail@aibooking.dk" style="color:#264ed1;">mail@aibooking.dk</a>`;

  // Bodies are escaped here (escapeCopyAround keeps the inline HTML
  // fragments above intact); titles are escaped when rendered below.
  const steps: Array<{ title: string; body: string }> = [
    { title: copy.loginTitle, body: escapeCopyAround(copy.loginBody, dashboardLink) },
    { title: copy.customizeTitle, body: escapeHtml(copy.customizeBody) },
    { title: copy.testTitle, body: escapeHtml(copy.testBody) },
    {
      title: copy.embedTitle,
      body: embedSnippet ? escapeCopyAround(copy.embedBody, bodyTag) : escapeHtml(copy.embedLockedBody),
    },
    {
      title: copy.packageTitle,
      body: escapeHtml(trialMinutes > 0 ? copy.packageTrialBody(trialMinutes, trialDays) : copy.packageNoTrialBody),
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
                <p style="margin:0 0 8px 0; color:#0f172a; font-size:14px; font-weight:600;">${escapeHtml(copy.codeLabel)}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background-color:#0f172a; border-radius:10px; padding:16px;">
                      <code style="font-family:Menlo,Consolas,monospace; font-size:12px; line-height:1.6; color:#e2e8f0; word-break:break-all;">${escapeHtml(embedSnippet)}</code>
                    </td>
                  </tr>
                </table>
                <p style="margin:8px 0 0 0; color:#94a3b8; font-size:12px; line-height:1.6;">
                  ${escapeHtml(copy.codeHint)}
                </p>
              </td>
            </tr>`
    : "";

  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(copy.heading)}</title>
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
                  ${escapeHtml(copy.heading)}
                </h1>
                <p style="margin:0 0 24px 0; color:#475569; font-size:15px; line-height:1.6;">
                  ${escapeCopyAround(copy.intro, escapeHtml(params.companyName))}
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
                  ${escapeHtml(copy.cta)}
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; background-color:#f8fafc; border-top:1px solid #e2e8f0;">
                <p style="margin:0; color:#94a3b8; font-size:12px; line-height:1.6;">
                  ${escapeCopyAround(copy.footer, mailLink)}
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

// Escapes a copy string's own text (quotes, apostrophes) while leaving the
// already-safe HTML fragment it's built around intact.
function escapeCopyAround(template: (fragment: string) => string, fragment: string): string {
  const marker = "\u0000FRAGMENT\u0000";
  return escapeHtml(template(marker)).replace(marker, fragment);
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
