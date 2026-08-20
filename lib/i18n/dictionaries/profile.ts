import type { Namespace } from "./types";

// The shared account/profile settings surface (app/(account)/profile —
// reachable from both the Dashboard and Admin headers) — the only place a
// signed-in user changes their own Dashboard/Admin UI language after
// signup. See lib/i18n/locales.ts and app/api/profile/language/route.ts.
export const profile: Namespace = {
  title: { da: "Profil", en: "Profile", es: "Perfil", fr: "Profil", pt: "Perfil", de: "Profil" },
  subtitle: {
    da: "Dine personlige indstillinger.",
    en: "Your personal settings.",
    es: "Su configuración personal.",
    fr: "Vos paramètres personnels.",
    pt: "Suas configurações pessoais.",
    de: "Ihre persönlichen Einstellungen.",
  },
  languageSectionTitle: {
    da: "Sprog",
    en: "Language",
    es: "Idioma",
    fr: "Langue",
    pt: "Idioma",
    de: "Sprache",
  },
  languageSectionDescription: {
    da: "Sproget Dashboard/Admin vises på for dig. Påvirker ikke jeres widgets' eget sprog.",
    en: "The language the Dashboard/Admin is shown in for you. Does not affect your widgets' own language.",
    es: "El idioma en el que se muestra el Panel/Admin para usted. No afecta al idioma propio de sus widgets.",
    fr: "La langue dans laquelle le Tableau de bord/Admin vous est présenté. N'affecte pas la langue propre de vos widgets.",
    pt: "O idioma em que o Painel/Admin é exibido para você. Não afeta o idioma próprio dos seus widgets.",
    de: "Die Sprache, in der Dashboard/Admin für Sie angezeigt wird. Hat keinen Einfluss auf die eigene Sprache Ihrer Widgets.",
  },
  languageLabel: {
    da: "Sprog",
    en: "Language",
    es: "Idioma",
    fr: "Langue",
    pt: "Idioma",
    de: "Sprache",
  },
};
