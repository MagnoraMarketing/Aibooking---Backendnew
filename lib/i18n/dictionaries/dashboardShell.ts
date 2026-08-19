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
  },
  "nav.dashboard": { da: "Dashboard", en: "Dashboard", es: "Panel", fr: "Tableau de bord", pt: "Painel" },
  "nav.widgetAgents": {
    da: "Widget Agents",
    en: "Widget Agents",
    es: "Agentes de widget",
    fr: "Agents widget",
    pt: "Agentes de widget",
  },
  "nav.inbound": { da: "Inbound", en: "Inbound", es: "Entrantes", fr: "Entrant", pt: "Recebidas" },
  "nav.outbound": { da: "Outbound", en: "Outbound", es: "Salientes", fr: "Sortant", pt: "Efetuadas" },
  "nav.knowledgeBase": {
    da: "Knowledge Base",
    en: "Knowledge Base",
    es: "Base de conocimiento",
    fr: "Base de connaissances",
    pt: "Base de conhecimento",
  },
  "nav.analytics": { da: "Analytics", en: "Analytics", es: "Analítica", fr: "Statistiques", pt: "Análises" },
  "nav.integrations": {
    da: "Integrations",
    en: "Integrations",
    es: "Integraciones",
    fr: "Intégrations",
    pt: "Integrações",
  },
  "nav.billing": { da: "Billing", en: "Billing", es: "Facturación", fr: "Facturation", pt: "Faturamento" },
  "nav.agency": { da: "Agency", en: "Agency", es: "Agencia", fr: "Agence", pt: "Agência" },
  openMenu: { da: "Åbn menu", en: "Open menu", es: "Abrir menú", fr: "Ouvrir le menu", pt: "Abrir menu" },
  notifications: {
    da: "Notifikationer",
    en: "Notifications",
    es: "Notificaciones",
    fr: "Notifications",
    pt: "Notificações",
  },
  credits: { da: "Credits", en: "Credits", es: "Créditos", fr: "Crédits", pt: "Créditos" },
  defaultUserLabel: { da: "Bruger", en: "User", es: "Usuario", fr: "Utilisateur", pt: "Usuário" },
  profile: { da: "Profil", en: "Profile", es: "Perfil", fr: "Profil", pt: "Perfil" },
  logout: { da: "Log ud", en: "Log out", es: "Cerrar sesión", fr: "Se déconnecter", pt: "Sair" },
  loggingOut: {
    da: "Logger ud…",
    en: "Logging out…",
    es: "Cerrando sesión…",
    fr: "Déconnexion…",
    pt: "Saindo…",
  },
};
