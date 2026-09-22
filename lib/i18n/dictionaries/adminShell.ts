import type { Namespace } from "./types";

// components/admin/header.tsx + app/admin/layout.tsx.
export const adminShell: Namespace = {
  badge: { da: "Master Admin", en: "Master Admin", es: "Administrador principal", fr: "Administrateur principal", pt: "Administrador principal", de: "Hauptadministrator" },
  "nav.dashboard": { da: "Overblik", en: "Dashboard", es: "Panel", fr: "Tableau de bord", pt: "Painel", de: "Dashboard" },

  // Section header shown above Widgets + Inbound — these are the two agent
  // types customers actually talk to (chat vs. phone).
  "nav.groupAgents": { da: "Agenter (kundevendte)", en: "Agents (customer-facing)", es: "Agentes (cara al cliente)", fr: "Agents (côté client)", pt: "Agentes (voltados ao cliente)", de: "Agenten (kundenseitig)" },
  "nav.widgets": { da: "Widgets (chat-agenter)", en: "Widgets (chat agents)", es: "Widgets (agentes de chat)", fr: "Widgets (agents de chat)", pt: "Widgets (agentes de chat)", de: "Widgets (Chat-Agenten)" },
  "nav.inbound": { da: "Telefonagenter (ind- og udgående)", en: "Inbound (phone agents)", es: "Entrante (agentes telefónicos)", fr: "Entrant (agents téléphoniques)", pt: "Entrada (agentes telefônicos)", de: "Inbound (Telefon-Agenten)" },

  // Section header shown above Wapi Agents — a technical, admin-only cache
  // of the underlying Vapi assistants. Deliberately kept separate from the
  // "Agenter" group above so it isn't mistaken for a third agent type.
  "nav.groupVapi": { da: "Vapi-forbindelse (teknisk)", en: "Vapi connection (technical)", es: "Conexión Vapi (técnico)", fr: "Connexion Vapi (technique)", pt: "Conexão Vapi (técnico)", de: "Vapi-Verbindung (technisch)" },
  "nav.wapiAgents": { da: "Wapi Agents", en: "Wapi Agents", es: "Agentes Wapi", fr: "Agents Wapi", pt: "Agentes Wapi", de: "Wapi-Agenten" },

  // Section header for the remaining, non-agent admin pages.
  "nav.groupAdmin": { da: "Administration", en: "Administration", es: "Administración", fr: "Administration", pt: "Administração", de: "Verwaltung" },
  "nav.customers": { da: "Kunder", en: "Customers", es: "Clientes", fr: "Clients", pt: "Clientes", de: "Kunden" },
  "nav.integrations": { da: "Integrationer", en: "Integrations", es: "Integraciones", fr: "Intégrations", pt: "Integrações", de: "Integrationen" },
  "nav.phoneNumbers": {
    da: "Telefonnumre",
    en: "Phone numbers",
    es: "Números de teléfono",
    fr: "Numéros de téléphone",
    pt: "Números de telefone",
    de: "Telefonnummern",
  },
  "nav.settings": {
    da: "Indstillinger",
    en: "Settings",
    es: "Configuración",
    fr: "Paramètres",
    pt: "Configurações",
    de: "Einstellungen",
  },
  menu: { da: "Menu", en: "Menu", es: "Menú", fr: "Menu", pt: "Menu", de: "Menü" },
  toggleNav: { da: "Skift navigation", en: "Toggle navigation", es: "Alternar navegación", fr: "Basculer la navigation", pt: "Alternar navegação", de: "Navigation umschalten" },
};
