import type { Namespace } from "./types";

// Generic, widely-reused strings (buttons, states) — component-specific
// copy belongs in its own namespace file instead.
export const common: Namespace = {
  save: { da: "Gem", en: "Save", es: "Guardar", fr: "Enregistrer", pt: "Salvar", de: "Speichern" },
  saving: { da: "Gemmer…", en: "Saving…", es: "Guardando…", fr: "Enregistrement…", pt: "Salvando…", de: "Wird gespeichert…" },
  saved: { da: "Gemt.", en: "Saved.", es: "Guardado.", fr: "Enregistré.", pt: "Salvo.", de: "Gespeichert." },
  saveFailed: {
    da: "Kunne ikke gemme.",
    en: "Could not save.",
    es: "No se pudo guardar.",
    fr: "Impossible d'enregistrer.",
    pt: "Não foi possível salvar.",
    de: "Speichern fehlgeschlagen.",
  },
  cancel: { da: "Annuller", en: "Cancel", es: "Cancelar", fr: "Annuler", pt: "Cancelar", de: "Abbrechen" },
  close: { da: "Luk", en: "Close", es: "Cerrar", fr: "Fermer", pt: "Fechar", de: "Schließen" },
  delete: { da: "Slet", en: "Delete", es: "Eliminar", fr: "Supprimer", pt: "Excluir", de: "Löschen" },
  edit: { da: "Rediger", en: "Edit", es: "Editar", fr: "Modifier", pt: "Editar", de: "Bearbeiten" },
  next: { da: "Næste", en: "Next", es: "Siguiente", fr: "Suivant", pt: "Próximo", de: "Weiter" },
  back: { da: "Tilbage", en: "Back", es: "Atrás", fr: "Retour", pt: "Voltar", de: "Zurück" },
  skip: { da: "Spring over", en: "Skip", es: "Omitir", fr: "Passer", pt: "Pular", de: "Überspringen" },
  loading: { da: "Indlæser…", en: "Loading…", es: "Cargando…", fr: "Chargement…", pt: "Carregando…", de: "Wird geladen…" },
  yes: { da: "Ja", en: "Yes", es: "Sí", fr: "Oui", pt: "Sim", de: "Ja" },
  no: { da: "Nej", en: "No", es: "No", fr: "Non", pt: "Não", de: "Nein" },
  none: { da: "Ingen", en: "None", es: "Ninguno", fr: "Aucun", pt: "Nenhum", de: "Keine" },
  noneSelected: {
    da: "Ingen valgt",
    en: "None selected",
    es: "Ninguno seleccionado",
    fr: "Aucun sélectionné",
    pt: "Nenhum selecionado",
    de: "Keine Auswahl",
  },
  unknownError: {
    da: "Ukendt fejl",
    en: "Unknown error",
    es: "Error desconocido",
    fr: "Erreur inconnue",
    pt: "Erro desconhecido",
    de: "Unbekannter Fehler",
  },
  tryAgain: {
    da: "Prøv igen.",
    en: "Try again.",
    es: "Inténtalo de nuevo.",
    fr: "Réessayez.",
    pt: "Tente novamente.",
    de: "Bitte versuchen Sie es erneut.",
  },
};
