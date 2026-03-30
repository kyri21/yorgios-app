export type HaccpCategory =
  | "VIANDE"
  | "VIANDE_HACHEE"
  | "POISSON"
  | "LAITIER"
  | "PLAT_CUISINE"
  | "LEGUMES"
  | "AUTRE";

export type Decision = "ACCEPTE" | "REFUSE" | "A_VERIFIER";

/**
 * Règles simples V1 (à valider/ajuster selon ton PMS).
 * Références utiles :
 * - Arrêté du 21/12/2009 (Annexe I) + renvoi au règlement CE 853/2004
 * - Viande hachée < 2°C mentionnée dans une ressource officielle (chaîne du froid).
 *
 * Ici on fait volontairement SIMPLE pour le démarrage.
 * Ensuite on rendra ça configurable dans Firestore (pms_config).
 */
export const TEMP_RULES_V1: Record<HaccpCategory, { maxC: number }> = {
  VIANDE: { maxC: 4 },
  VIANDE_HACHEE: { maxC: 2 },
  POISSON: { maxC: 2 },
  LAITIER: { maxC: 6 },
  PLAT_CUISINE: { maxC: 4 },
  LEGUMES: { maxC: 8 },
  AUTRE: { maxC: 8 },
};

export function photoIsRequired(category: HaccpCategory) {
  return category === "VIANDE" || category === "VIANDE_HACHEE";
}

export function computeDecisionV1(category: HaccpCategory, temperatureC: number): Decision {
  if (!Number.isFinite(temperatureC)) return "A_VERIFIER";
  const rule = TEMP_RULES_V1[category];
  if (!rule) return "A_VERIFIER";
  return temperatureC <= rule.maxC ? "ACCEPTE" : "REFUSE";
}
