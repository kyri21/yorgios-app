// Paliers de fidélité Yorgios — constantes métier

export type LoyaltyTier = 'none' | 'bronze' | 'silver' | 'gold'

export interface TierDef {
  minOrders: number
  discountPercent: number
  validityDays: number | null  // null = illimité
  tier: Exclude<LoyaltyTier, 'none'>
}

export const LOYALTY_TIERS: TierDef[] = [
  { minOrders: 10, discountPercent: 5,  validityDays: 60,   tier: 'bronze' },
  { minOrders: 25, discountPercent: 10, validityDays: 90,   tier: 'silver' },
  { minOrders: 50, discountPercent: 15, validityDays: null, tier: 'gold'   },
]

/** Retourne le palier atteint exactement par orderCount (pour déclencher la récompense une seule fois) */
export function getNewTier(orderCount: number): TierDef | null {
  return LOYALTY_TIERS.find(t => t.minOrders === orderCount) ?? null
}

/** Retourne le palier courant (le plus élevé atteint) */
export function getCurrentTier(orderCount: number): LoyaltyTier {
  let tier: LoyaltyTier = 'none'
  for (const t of LOYALTY_TIERS) {
    if (orderCount >= t.minOrders) tier = t.tier
  }
  return tier
}
