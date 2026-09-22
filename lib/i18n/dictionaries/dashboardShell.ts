import type { Namespace } from "./types";

// components/dashboard/header.tsx + app/dashboard/layout.tsx — the chrome
// wrapping every Dashboard page.
export const dashboardShell: Namespace = {
  "nav.gettingStarted": {
    da: "Kom i gang",
    en: "Getting Started",
    es: "Primeros pasos",
    fr: "Prise en main",
    pt: "Primeiros passos",
    de: "Erste Schritte",
  },
  "nav.dashboard": { da: "Overblik", en: "Dashboard", es: "Panel", fr: "Tableau de bord", pt: "Painel", de: "Dashboard" },

  // Grouping header for the "Agenter" dropdown (Widget/Inbound/Outbound/Dialer)
  // in the header nav — keeps the four agent types together instead of
  // scattered flat in the nav bar, so they read as one family.
  "nav.agentsGroup": { da: "Agenter", en: "Agents", es: "Agentes", fr: "Agents", pt: "Agentes", de: "Agenten" },
  "nav.widgetAgents": {
    da: "Chat-widget",
    en: "Chat widget",
    es: "Widget de chat",
    fr: "Widget de chat",
    pt: "Widget de chat",
    de: "Chat-Widget",
  },
  "nav.inbound": { da: "Indgående opkald", en: "Inbound (incoming calls)", es: "Entrantes (llamadas)", fr: "Entrant (appels)", pt: "Recebidas (chamadas)", de: "Inbound (eingehende Anrufe)" },
  "nav.outbound": { da: "Udgående opkald", en: "Outbound (outgoing calls)", es: "Salientes (llamadas)", fr: "Sortant (appels)", pt: "Efetuadas (chamadas)", de: "Outbound (ausgehende Anrufe)" },
  "nav.dialer": { da: "Manuelle opkald", en: "Dialer", es: "Marcador", fr: "Numéroteur", pt: "Discador", de: "Dialer" },
  "nav.knowledgeBase": {
    da: "Vidensbase",
    en: "Knowledge Base",
    es: "Base de conocimiento",
    fr: "Base de connaissances",
    pt: "Base de conhecimento",
    de: "Wissensdatenbank",
  },
  "nav.analytics": { da: "Statistik", en: "Analytics", es: "Analítica", fr: "Statistiques", pt: "Análises", de: "Analysen" },
  "nav.integrations": {
    da: "Integrationer",
    en: "Integrations",
    es: "Integraciones",
    fr: "Intégrations",
    pt: "Integrações",
    de: "Integrationen",
  },
  "nav.billing": { da: "Betaling", en: "Billing", es: "Facturación", fr: "Facturation", pt: "Faturamento", de: "Abrechnung" },
  "nav.agency": { da: "Bureau", en: "Agency", es: "Agencia", fr: "Agence", pt: "Agência", de: "Agentur" },
  openMenu: { da: "Åbn menu", en: "Open menu", es: "Abrir menú", fr: "Ouvrir le menu", pt: "Abrir menu", de: "Menü öffnen" },
  notifications: {
    da: "Notifikationer",
    en: "Notifications",
    es: "Notificaciones",
    fr: "Notifications",
    pt: "Notificações",
    de: "Benachrichtigungen",
  },
  credits: { da: "Minutter", en: "Credits", es: "Créditos", fr: "Crédits", pt: "Créditos", de: "Guthaben" },
  defaultUserLabel: { da: "Bruger", en: "User", es: "Usuario", fr: "Utilisateur", pt: "Usuário", de: "Benutzer" },
  profile: { da: "Profil", en: "Profile", es: "Perfil", fr: "Profil", pt: "Perfil", de: "Profil" },
  logout: { da: "Log ud", en: "Log out", es: "Cerrar sesión", fr: "Se déconnecter", pt: "Sair", de: "Abmelden" },
  loggingOut: {
    da: "Logger ud…",
    en: "Logging out…",
    es: "Cerrando sesión…",
    fr: "Déconnexion…",
    pt: "Saindo…",
    de: "Wird abgemeldet…",
  },

  // ---------------------------------------------------------------------
  // trial-ended-banner.tsx — shown once hasEmbedCodeAccess (lib/billing/
  // trial.ts) goes false: the free trial is over and nothing has been
  // bought yet. Deliberately short — this renders on every dashboard page.
  // ---------------------------------------------------------------------
  "trialEndedBanner.title": {
    da: "Jeres gratis prøveperiode er slut",
    en: "Your free trial has ended",
    es: "Su periodo de prueba gratuito ha terminado",
    fr: "Votre essai gratuit est terminé",
    pt: "O seu período de teste gratuito terminou",
    de: "Ihre kostenlose Testphase ist abgelaufen",
  },
  "trialEndedBanner.body": {
    da: "Køb en pakke for at gå live: agenten svarer 24/7, håndterer bookinger direkte i kalenderen, og I betaler kun for aktiv taletid.",
    en: "Buy a package to go live: the agent answers 24/7, handles bookings straight into the calendar, and you only pay for active talk time.",
    es: "Compre un paquete para salir en producción: el agente responde 24/7, gestiona reservas directamente en el calendario, y solo paga por el tiempo de conversación activo.",
    fr: "Achetez un forfait pour passer en ligne : l'agent répond 24 h/24 et 7 j/7, gère les réservations directement dans le calendrier, et vous ne payez que le temps de parole actif.",
    pt: "Compre um pacote para entrar em produção: o agente atende 24/7, gere reservas diretamente no calendário, e paga apenas pelo tempo de conversação ativo.",
    de: "Kaufen Sie ein Paket, um live zu gehen: Der Agent antwortet 24/7, verwaltet Buchungen direkt im Kalender, und Sie zahlen nur für aktive Sprechzeit.",
  },
  "trialEndedBanner.cta": {
    da: "Se pakker →",
    en: "See packages →",
    es: "Ver paquetes →",
    fr: "Voir les forfaits →",
    pt: "Ver pacotes →",
    de: "Pakete ansehen →",
  },

  // ---------------------------------------------------------------------
  // support-widget.tsx — the floating onboarding/support voice button.
  // ---------------------------------------------------------------------
  "supportWidget.label": {
    da: "Tal med support",
    en: "Talk to support",
    es: "Hablar con soporte",
    fr: "Parler au support",
    pt: "Falar com o suporte",
    de: "Mit dem Support sprechen",
  },
  "supportWidget.connecting": {
    da: "Forbinder …",
    en: "Connecting …",
    es: "Conectando…",
    fr: "Connexion…",
    pt: "A ligar…",
    de: "Verbindung wird hergestellt …",
  },
  "supportWidget.active": {
    da: "Afslut samtale",
    en: "End call",
    es: "Finalizar llamada",
    fr: "Terminer l'appel",
    pt: "Terminar chamada",
    de: "Anruf beenden",
  },
  "supportWidget.error": {
    da: "Der opstod en fejl — prøv igen",
    en: "Something went wrong — try again",
    es: "Ha ocurrido un error — inténtelo de nuevo",
    fr: "Une erreur est survenue — réessayez",
    pt: "Ocorreu um erro — tente novamente",
    de: "Etwas ist schiefgelaufen — versuchen Sie es erneut",
  },
};
