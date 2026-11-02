import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/locales";

// The two automatic follow-up mails a self-signup customer gets during the
// free trial (see lib/email/trial-followups.ts for when they go out):
//
//   "day1" — the day after signup: thanks for the interest, here's the
//            step-by-step guide in your dashboard, book a meeting if you
//            have questions.
//   "day6" — the day before the trial ends, only to customers who haven't
//            paid: how has it gone, do you need help — book an onboarding
//            meeting.
//
// Same table-based layout and inline styles as templates/welcome.ts — the
// only thing Gmail, Outlook and Apple Mail all render consistently — and
// written in the language the customer picked on /signup.

export type TrialFollowupKind = "day1" | "day6";

export interface TrialFollowupEmailParams {
  kind: TrialFollowupKind;
  // Anything outside LOCALES falls back to Danish, like the rest of the
  // platform.
  language: string;
  companyName: string;
  guideUrl: string;
  meetingUrl: string;
  billingUrl: string;
}

interface FollowupCopy {
  subject: string;
  heading: string;
  // companyName is already HTML-escaped when these are called.
  intro: (companyName: string) => string;
  points: Array<{ title: string; body: string }>;
  primaryCta: string;
  secondaryCta: string;
}

interface LocaleCopy {
  day1: FollowupCopy;
  day6: FollowupCopy;
  signoff: string;
  footer: (mailLink: string) => string;
}

const COPY: Record<Locale, LocaleCopy> = {
  da: {
    day1: {
      subject: "Tak for din interesse i AIbooking.dk 💙",
      heading: "Vi er glade for, at du er med",
      intro: (c) =>
        `Tak fordi ${c} har valgt at prøve AIbooking.dk. Vi glæder os til at hjælpe jer med at få en AI-agent, der svarer jeres kunder døgnet rundt — også når I selv har travlt.`,
      points: [
        {
          title: "Følg step-by-step guiden",
          body: "Inde på din bruger finder du en step-by-step guide under \"Kom i gang\", som tager dig igennem opsætningen af din agent — fra navn og stemme til at sætte den på din hjemmeside.",
        },
        {
          title: "Har du spørgsmål? Book et møde",
          body: "Sidder du fast, eller vil du bare gerne have en snak om, hvordan AIbooking.dk passer til jeres forretning? Så kan du altid booke et møde med os.",
        },
      ],
      primaryCta: "Åbn step-by-step guiden",
      secondaryCta: "Book et møde",
    },
    day6: {
      subject: "Hvordan har din oplevelse med AIbooking.dk været?",
      heading: "Hvordan går det med din AI-agent?",
      intro: (c) =>
        `Det er snart en uge siden, ${c} oprettede sig hos AIbooking.dk, og din gratis prøveperiode udløber i morgen. Vi vil rigtig gerne høre, hvordan din oplevelse har været indtil nu.`,
      points: [
        {
          title: "Brug for hjælp? Book et onboarding-møde",
          body: "Har du ikke nået at få agenten helt på plads, eller er der noget, der driller? Book et gratis onboarding-møde, så sætter vi det op sammen med dig.",
        },
        {
          title: "Klar til at fortsætte?",
          body: "Vælg en pakke under Abonnement, så din agent bliver ved med at svare dine kunder, når prøveperioden udløber.",
        },
      ],
      primaryCta: "Book et onboarding-møde",
      secondaryCta: "Vælg en pakke",
    },
    signoff: "Venlige hilsner\nTeamet bag AIbooking.dk",
    footer: (l) => `Du kan også bare svare på denne mail eller skrive til ${l} — vi hjælper gerne.`,
  },
  en: {
    day1: {
      subject: "Thanks for your interest in AIbooking.dk 💙",
      heading: "We're glad to have you on board",
      intro: (c) =>
        `Thanks for choosing to try AIbooking.dk with ${c}. We look forward to helping you get an AI agent that answers your customers around the clock — even when you're busy.`,
      points: [
        {
          title: "Follow the step-by-step guide",
          body: "In your account you'll find a step-by-step guide under \"Getting started\" that walks you through setting up your agent — from name and voice to putting it on your website.",
        },
        {
          title: "Questions? Book a meeting",
          body: "Stuck, or just want to talk about how AIbooking.dk fits your business? You can always book a meeting with us.",
        },
      ],
      primaryCta: "Open the step-by-step guide",
      secondaryCta: "Book a meeting",
    },
    day6: {
      subject: "How has your AIbooking.dk experience been?",
      heading: "How's it going with your AI agent?",
      intro: (c) =>
        `It's almost a week since ${c} signed up for AIbooking.dk, and your free trial ends tomorrow. We'd love to hear how your experience has been so far.`,
      points: [
        {
          title: "Need help? Book an onboarding meeting",
          body: "Haven't quite got the agent set up, or is something giving you trouble? Book a free onboarding meeting and we'll set it up together with you.",
        },
        {
          title: "Ready to continue?",
          body: "Choose a package under Subscription so your agent keeps answering your customers after the trial ends.",
        },
      ],
      primaryCta: "Book an onboarding meeting",
      secondaryCta: "Choose a package",
    },
    signoff: "Best regards\nThe AIbooking.dk team",
    footer: (l) => `You can also just reply to this email or write to ${l} — we're happy to help.`,
  },
  es: {
    day1: {
      subject: "Gracias por tu interés en AIbooking.dk 💙",
      heading: "Nos alegra tenerte con nosotros",
      intro: (c) =>
        `Gracias por elegir probar AIbooking.dk con ${c}. Estamos deseando ayudarte a tener un agente de IA que atienda a tus clientes las 24 horas, incluso cuando estás ocupado.`,
      points: [
        {
          title: "Sigue la guía paso a paso",
          body: "En tu cuenta encontrarás una guía paso a paso en \"Primeros pasos\" que te lleva por la configuración de tu agente, desde el nombre y la voz hasta ponerlo en tu sitio web.",
        },
        {
          title: "¿Tienes preguntas? Reserva una reunión",
          body: "¿Te has atascado o quieres hablar de cómo encaja AIbooking.dk en tu negocio? Siempre puedes reservar una reunión con nosotros.",
        },
      ],
      primaryCta: "Abrir la guía paso a paso",
      secondaryCta: "Reservar una reunión",
    },
    day6: {
      subject: "¿Qué tal tu experiencia con AIbooking.dk?",
      heading: "¿Cómo va tu agente de IA?",
      intro: (c) =>
        `Hace casi una semana que ${c} se registró en AIbooking.dk y tu prueba gratuita termina mañana. Nos encantaría saber qué tal ha sido tu experiencia hasta ahora.`,
      points: [
        {
          title: "¿Necesitas ayuda? Reserva una reunión de onboarding",
          body: "¿No has terminado de configurar el agente o algo no funciona como esperabas? Reserva una reunión de onboarding gratuita y lo configuramos contigo.",
        },
        {
          title: "¿Listo para continuar?",
          body: "Elige un plan en Suscripción para que tu agente siga atendiendo a tus clientes cuando termine la prueba.",
        },
      ],
      primaryCta: "Reservar reunión de onboarding",
      secondaryCta: "Elegir un plan",
    },
    signoff: "Un saludo\nEl equipo de AIbooking.dk",
    footer: (l) => `También puedes responder a este correo o escribir a ${l}; te ayudaremos encantados.`,
  },
  fr: {
    day1: {
      subject: "Merci pour votre intérêt pour AIbooking.dk 💙",
      heading: "Ravis de vous compter parmi nous",
      intro: (c) =>
        `Merci d'avoir choisi d'essayer AIbooking.dk avec ${c}. Nous avons hâte de vous aider à disposer d'un agent IA qui répond à vos clients jour et nuit — même quand vous êtes occupé.`,
      points: [
        {
          title: "Suivez le guide étape par étape",
          body: "Dans votre compte, vous trouverez un guide étape par étape sous « Démarrer » qui vous accompagne dans la configuration de votre agent — du nom et de la voix jusqu'à son ajout sur votre site.",
        },
        {
          title: "Des questions ? Réservez un rendez-vous",
          body: "Vous êtes bloqué ou souhaitez discuter de la place d'AIbooking.dk dans votre activité ? Vous pouvez toujours réserver un rendez-vous avec nous.",
        },
      ],
      primaryCta: "Ouvrir le guide étape par étape",
      secondaryCta: "Réserver un rendez-vous",
    },
    day6: {
      subject: "Comment se passe votre expérience avec AIbooking.dk ?",
      heading: "Comment se porte votre agent IA ?",
      intro: (c) =>
        `Cela fait bientôt une semaine que ${c} s'est inscrit sur AIbooking.dk, et votre essai gratuit se termine demain. Nous aimerions beaucoup savoir comment s'est passée votre expérience jusqu'ici.`,
      points: [
        {
          title: "Besoin d'aide ? Réservez un rendez-vous d'onboarding",
          body: "Vous n'avez pas encore tout configuré, ou quelque chose coince ? Réservez un rendez-vous d'onboarding gratuit et nous le configurerons avec vous.",
        },
        {
          title: "Prêt à continuer ?",
          body: "Choisissez une offre sous Abonnement pour que votre agent continue de répondre à vos clients après l'essai.",
        },
      ],
      primaryCta: "Réserver un rendez-vous d'onboarding",
      secondaryCta: "Choisir une offre",
    },
    signoff: "Bien cordialement\nL'équipe AIbooking.dk",
    footer: (l) => `Vous pouvez aussi simplement répondre à cet e-mail ou écrire à ${l} — nous vous aiderons avec plaisir.`,
  },
  pt: {
    day1: {
      subject: "Obrigado pelo seu interesse no AIbooking.dk 💙",
      heading: "Ficamos contentes por tê-lo connosco",
      intro: (c) =>
        `Obrigado por escolher experimentar o AIbooking.dk com ${c}. Estamos ansiosos por ajudá-lo a ter um agente de IA que atende os seus clientes a qualquer hora — mesmo quando está ocupado.`,
      points: [
        {
          title: "Siga o guia passo a passo",
          body: "Na sua conta encontra um guia passo a passo em \"Primeiros passos\" que o acompanha na configuração do seu agente — do nome e da voz até colocá-lo no seu site.",
        },
        {
          title: "Tem dúvidas? Marque uma reunião",
          body: "Ficou bloqueado ou quer conversar sobre como o AIbooking.dk se encaixa no seu negócio? Pode sempre marcar uma reunião connosco.",
        },
      ],
      primaryCta: "Abrir o guia passo a passo",
      secondaryCta: "Marcar uma reunião",
    },
    day6: {
      subject: "Como tem sido a sua experiência com o AIbooking.dk?",
      heading: "Como está a correr o seu agente de IA?",
      intro: (c) =>
        `Já passou quase uma semana desde que ${c} se registou no AIbooking.dk, e o seu período de teste gratuito termina amanhã. Gostaríamos muito de saber como tem sido a sua experiência até agora.`,
      points: [
        {
          title: "Precisa de ajuda? Marque uma reunião de onboarding",
          body: "Ainda não conseguiu configurar o agente, ou há algo que não funciona? Marque uma reunião de onboarding gratuita e configuramos tudo consigo.",
        },
        {
          title: "Pronto para continuar?",
          body: "Escolha um plano em Subscrição para que o seu agente continue a atender os seus clientes depois do período de teste.",
        },
      ],
      primaryCta: "Marcar reunião de onboarding",
      secondaryCta: "Escolher um plano",
    },
    signoff: "Com os melhores cumprimentos\nA equipa AIbooking.dk",
    footer: (l) => `Também pode simplesmente responder a este e-mail ou escrever para ${l} — teremos todo o gosto em ajudar.`,
  },
  de: {
    day1: {
      subject: "Danke für Ihr Interesse an AIbooking.dk 💙",
      heading: "Schön, dass Sie dabei sind",
      intro: (c) =>
        `Danke, dass Sie AIbooking.dk mit ${c} ausprobieren. Wir freuen uns darauf, Ihnen zu einem KI-Agenten zu verhelfen, der Ihren Kunden rund um die Uhr antwortet — auch wenn Sie selbst viel zu tun haben.`,
      points: [
        {
          title: "Folgen Sie der Schritt-für-Schritt-Anleitung",
          body: "In Ihrem Konto finden Sie unter „Erste Schritte“ eine Schritt-für-Schritt-Anleitung, die Sie durch die Einrichtung Ihres Agenten führt — von Name und Stimme bis zur Einbindung auf Ihrer Website.",
        },
        {
          title: "Fragen? Buchen Sie einen Termin",
          body: "Kommen Sie nicht weiter, oder möchten Sie besprechen, wie AIbooking.dk zu Ihrem Unternehmen passt? Sie können jederzeit einen Termin mit uns buchen.",
        },
      ],
      primaryCta: "Anleitung öffnen",
      secondaryCta: "Termin buchen",
    },
    day6: {
      subject: "Wie war Ihre Erfahrung mit AIbooking.dk?",
      heading: "Wie läuft es mit Ihrem KI-Agenten?",
      intro: (c) =>
        `Es ist fast eine Woche her, dass sich ${c} bei AIbooking.dk registriert hat, und Ihre kostenlose Testphase endet morgen. Wir würden gern hören, wie Ihre Erfahrung bisher war.`,
      points: [
        {
          title: "Brauchen Sie Hilfe? Buchen Sie ein Onboarding-Gespräch",
          body: "Ist der Agent noch nicht ganz eingerichtet, oder hakt etwas? Buchen Sie ein kostenloses Onboarding-Gespräch, und wir richten ihn gemeinsam mit Ihnen ein.",
        },
        {
          title: "Bereit, weiterzumachen?",
          body: "Wählen Sie unter Abonnement ein Paket, damit Ihr Agent Ihren Kunden auch nach der Testphase weiter antwortet.",
        },
      ],
      primaryCta: "Onboarding-Gespräch buchen",
      secondaryCta: "Paket wählen",
    },
    signoff: "Viele Grüße\nIhr AIbooking.dk-Team",
    footer: (l) => `Sie können auch einfach auf diese E-Mail antworten oder an ${l} schreiben — wir helfen gern.`,
  },
};

export function trialFollowupLocale(language: string): Locale {
  return isLocale(language) ? language : DEFAULT_LOCALE;
}

export function trialFollowupSubject(kind: TrialFollowupKind, language: string): string {
  return COPY[trialFollowupLocale(language)][kind].subject;
}

export function buildTrialFollowupEmailHtml(params: TrialFollowupEmailParams): string {
  const locale = trialFollowupLocale(params.language);
  const localeCopy = COPY[locale];
  const copy = localeCopy[params.kind];

  // day1 leads with the guide and offers the meeting second; day6 leads with
  // the onboarding meeting and offers choosing a package second.
  const primaryHref = params.kind === "day1" ? params.guideUrl : params.meetingUrl;
  const secondaryHref = params.kind === "day1" ? params.meetingUrl : params.billingUrl;
  const mailLink = `<a href="mailto:mail@aibooking.dk" style="color:#264ed1;">mail@aibooking.dk</a>`;

  const pointsHtml = copy.points
    .map(
      (point) => `
              <tr>
                <td style="padding:0 0 16px 0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc; border:1px solid #e2e8f0; border-radius:12px;">
                    <tr>
                      <td style="padding:16px 18px;">
                        <p style="margin:0 0 4px 0; color:#0f172a; font-size:15px; font-weight:600;">${escapeHtml(point.title)}</p>
                        <p style="margin:0; color:#475569; font-size:14px; line-height:1.6;">${escapeHtml(point.body)}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`
    )
    .join("");

  const signoffHtml = escapeHtml(localeCopy.signoff).replace(/\n/g, "<br />");

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
                  ${escapeCopyAround(copy.intro, `<strong style="color:#0f172a;">${escapeHtml(params.companyName)}</strong>`)}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${pointsHtml}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 12px 32px;" align="center">
                <a href="${escapeAttribute(primaryHref)}" style="display:inline-block; background-color:#264ed1; color:#ffffff; font-size:15px; font-weight:600; text-decoration:none; padding:13px 28px; border-radius:10px;">
                  ${escapeHtml(copy.primaryCta)}
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px 32px;" align="center">
                <a href="${escapeAttribute(secondaryHref)}" style="display:inline-block; color:#264ed1; font-size:14px; font-weight:600; text-decoration:none; padding:10px 20px; border:1px solid #c7d2fe; border-radius:10px;">
                  ${escapeHtml(copy.secondaryCta)}
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px 32px;">
                <p style="margin:0; color:#475569; font-size:14px; line-height:1.6;">${signoffHtml}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; background-color:#f8fafc; border-top:1px solid #e2e8f0;">
                <p style="margin:0; color:#94a3b8; font-size:12px; line-height:1.6;">
                  ${escapeCopyAround(localeCopy.footer, mailLink)}
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Links are either the platform's own https URLs or a mailto: fallback for
// the meeting link (see lib/email/trial-followups.ts) — anything else is
// replaced rather than rendered.
function escapeAttribute(href: string): string {
  const safe = /^(https?:\/\/|mailto:)/i.test(href) ? href : "#";
  return escapeHtml(safe);
}
