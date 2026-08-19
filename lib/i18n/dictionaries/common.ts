import type { Namespace } from "./types";

// Generic, widely-reused strings (buttons, states) — component-specific
// copy belongs in its own namespace file instead.
export const common: Namespace = {
  save: { da: "Gem", en: "Save", es: "Guardar", fr: "Enregistrer", pt: "Salvar" },
  saving: { da: "Gemmer…", en: "Saving…", es: "Guardando…", fr: "Enregistrement…", pt: "Salvando…" },
  saved: { da: "Gemt.", en: "Saved.", es: "Guardado.", fr: "Enregistré.", pt: "Salvo." },
  saveFailed: {
    da: "Kunne ikke gemme.",
    en: "Could not save.",
    es: "No se pudo guardar.",
    fr: "Impossible d'enregistrer.",
    pt: "Não foi possível salvar.",
  },
  cancel: { da: "Annuller", en: "Cancel", es: "Cancelar", fr: "Annuler", pt: "Cancelar" },
  close: { da: "Luk", en: "Close", es: "Cerrar", fr: "Fermer", pt: "Fechar" },
  delete: { da: "Slet", en: "Delete", es: "Eliminar", fr: "Supprimer", pt: "Excluir" },
  edit: { da: "Rediger", en: "Edit", es: "Editar", fr: "Modifier", pt: "Editar" },
  next: { da: "Næste", en: "Next", es: "Siguiente", fr: "Suivant", pt: "Próximo" },
  back: { da: "Tilbage", en: "Back", es: "Atrás", fr: "Retour", pt: "Voltar" },
  skip: { da: "Spring over", en: "Skip", es: "Omitir", fr: "Passer", pt: "Pular" },
  loading: { da: "Indlæser…", en: "Loading…", es: "Cargando…", fr: "Chargement…", pt: "Carregando…" },
  yes: { da: "Ja", en: "Yes", es: "Sí", fr: "Oui", pt: "Sim" },
  no: { da: "Nej", en: "No", es: "No", fr: "Non", pt: "Não" },
  none: { da: "Ingen", en: "None", es: "Ninguno", fr: "Aucun", pt: "Nenhum" },
  noneSelected: {
    da: "Ingen valgt",
    en: "None selected",
    es: "Ninguno seleccionado",
    fr: "Aucun sélectionné",
    pt: "Nenhum selecionado",
  },
  unknownError: {
    da: "Ukendt fejl",
    en: "Unknown error",
    es: "Error desconocido",
    fr: "Erreur inconnue",
    pt: "Erro desconhecido",
  },
  tryAgain: {
    da: "Prøv igen.",
    en: "Try again.",
    es: "Inténtalo de nuevo.",
    fr: "Réessayez.",
    pt: "Tente novamente.",
  },
};
