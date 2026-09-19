import type { Namespace } from "./types";

// components/dashboard/header.tsx + app/dashboard/layout.tsx — the chrome
// wrapping every Dashboard page.
export const dashboardShell: Namespace = {
  "nav.gettingStarted": {
    da: "Getting Started",
    en: "Getting Started",
    es: "Primeros pasos",
    fr: "Prise en main",
    pt: "Primeiros passos",
    de: "Erste Schritte",
  },
  "nav.dashboard": { da: "Dashboard", en: "Dashboard", es: "Panel", fr: "Tableau de bord", pt: "Painel", de: "Dashboard" },
  "nav.widgetAgents": {
    da: "Widget Agents",
    en: "Widget Agents",
    es: "Agentes de widget",
    fr: "Agents widget",
    pt: "Agentes de widget",
    de: "Widget-Agenten",
  },
  "nav.inbound": { da: "Inbound", en: "Inbound", es: "Entrantes", fr: "Entrant", pt: "Recebidas", de: "Eingehend" },
  "nav.outbound": { da: "Outbound", en: "Outbound", es: "Salientes", fr: "Sortant", pt: "Efetuadas", de: "Ausgehend" },
  "nav.dialer": { da: "Dialer", en: "Dialer", es: "Marcador", fr: "Numéroteur", pt: "Discador", de: "Dialer" },
  "nav.knowledgeBase": {
    da: "Knowledge Base",
    en: "Knowledge Base",
    es: "Base de conocimiento",
    fr: "Base de connaissances",
    pt: "Base de conhecimento",
    de: "Wissensdatenbank",
  },
  "nav.analytics": { da: "Analytics", en: "Analytics", es: "Analítica", fr: "Statistiques", pt: "Análises", de: "Analysen" },
  "nav.integrations": {
    da: "Integrations",
    en: "Integrations",
    es: "Integraciones",
    fr: "Intégrations",
    pt: "Integrações",
    de: "Integrationen",
  },
  "nav.billing": { da: "Billing", en: "Billing", es: "Facturación", fr: "Facturation", pt: "Faturamento", de: "Abrechnung" },
  "nav.agency": { da: "Agency", en: "Agency", es: "Agencia", fr: "Agence", pt: "Agência", de: "Agentur" },
  openMenu: { da: "Åbn menu", en: "Open menu", es: "Abrir menú", fr: "Ouvrir le menu", pt: "Abrir menu", de: "Menü öffnen" },
  notifications: {
    da: "Notifikationer",
    en: "Notifications",
    es: "Notificaciones",
    fr: "Notifications",
    pt: "Notificações",
    de: "Benachrichtigungen",
  },
  credits: { da: "Credits", en: "Credits", es: "Créditos", fr: "Crédits", pt: "Créditos", de: "Guthaben" },
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
};
