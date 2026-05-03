export const BAREME: Record<number, { comp: number }> = {
  35: { comp: 60 },
  30: { comp: 50 },
  25: { comp: 40 },
  20: { comp: 30 },
}
export const HYGIENE_BONUS = 50

export const EXCLUDED_NAMES = ['Layal', 'Alexandre', 'Arthur']

export function getBareme(weeklyCapHours: number) {
  const keys = [20, 25, 30, 35] as const
  const key = keys.reduce((prev, curr) =>
    Math.abs(curr - weeklyCapHours) < Math.abs(prev - weeklyCapHours) ? curr : prev
  )
  return BAREME[key]
}

/** Type de contrat configurable dans settings/contrats */
export interface ContractType {
  hours: number
  label?: string
  compMax: number   // prime comportement+ponctualité max total (splitté 50/50 par défaut)
  caMax: number     // prime CA max
}

export const DEFAULT_CONTRACTS: ContractType[] = [
  { hours: 20, label: '20h',  compMax: 30,  caMax: 100 },
  { hours: 25, label: '25h',  compMax: 40,  caMax: 150 },
  { hours: 30, label: '30h',  compMax: 50,  caMax: 200 },
  { hours: 35, label: '35h',  compMax: 60,  caMax: 250 },
]

export function getContractForHours(
  weeklyCapHours: number,
  contracts: ContractType[] = DEFAULT_CONTRACTS,
): ContractType {
  const exact = contracts.find(c => c.hours === weeklyCapHours)
  if (exact) return exact
  if (contracts.length === 0) return { hours: weeklyCapHours, compMax: 0, caMax: 0 }
  return contracts.reduce((prev, curr) =>
    Math.abs(curr.hours - weeklyCapHours) < Math.abs(prev.hours - weeklyCapHours) ? curr : prev
  )
}

export function hygieneBonus(score: number | null): number {
  if (score == null) return 0
  if (score >= 92) return HYGIENE_BONUS
  if (score >= 85) return HYGIENE_BONUS / 2
  return 0
}

/** Palier CA : seuil = ratio CA réalisé/objectif, pct = % du montant max à verser (0-100) */
export interface CaPalier { seuil: number; pct: number }

/** Montant max de prime CA par contrat hebdomadaire (hors prime hygiène) */
export type CaMaxPrimes = Record<number, number>

export const DEFAULT_CA_MAX_PRIMES: CaMaxPrimes = { 20: 100, 25: 150, 30: 200, 35: 250 }

export const DEFAULT_CA_PALIERS: CaPalier[] = [
  { seuil: 0.80, pct: 20 },
  { seuil: 0.90, pct: 40 },
  { seuil: 1.00, pct: 70 },
  { seuil: 1.10, pct: 100 },
]

/** Montant max de prime CA pour un contrat donné */
export function getMaxCaPrime(weeklyCapHours: number, maxPrimes: CaMaxPrimes = DEFAULT_CA_MAX_PRIMES): number {
  const keys = Object.keys(maxPrimes).map(Number).sort((a, b) => a - b)
  const key = keys.reduce((prev, curr) =>
    Math.abs(curr - weeklyCapHours) < Math.abs(prev - weeklyCapHours) ? curr : prev
  )
  return maxPrimes[key] ?? 0
}

/** Calcule la prime CA d'un employé selon son contrat, le CA du mois et le barème */
export function calcCaPrime(
  caRealise: number | null,
  caObjectif: number | null,
  weeklyCapHours: number = 35,
  paliers: CaPalier[] = DEFAULT_CA_PALIERS,
  maxPrimes: CaMaxPrimes = DEFAULT_CA_MAX_PRIMES,
): number {
  if (!caRealise || !caObjectif || caObjectif <= 0) return 0
  const ratio = caRealise / caObjectif
  const sorted = [...paliers].sort((a, b) => b.seuil - a.seuil)
  const matched = sorted.find(p => ratio >= p.seuil)
  if (!matched) return 0
  const max = getMaxCaPrime(weeklyCapHours, maxPrimes)
  return Math.round((matched.pct / 100) * max)
}

export function calcPrime(
  weeklyCapHours: number,
  comportementOk: boolean,
  ponctualiteOk: boolean,
  caPrime: number,
  hygBonus: number,
  primeComportement?: number,
  primePonctualite?: number,
): number {
  const b = getBareme(weeklyCapHours)
  const compAmt  = primeComportement ?? b.comp / 2
  const ponctAmt = primePonctualite  ?? b.comp / 2
  return (
    (comportementOk ? compAmt  : 0) +
    (ponctualiteOk  ? ponctAmt : 0) +
    caPrime +
    hygBonus
  )
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function getContractAt(emp: { weeklyCapHours: number; avenants?: { effectiveDate: string; weeklyCapHours: number }[] }, weekStartDate: Date): number {
  if (!emp.avenants || emp.avenants.length === 0) return emp.weeklyCapHours
  const d = weekStartDate
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const applicable = emp.avenants
    .filter(a => a.effectiveDate && a.effectiveDate <= dateStr)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
  return applicable.length > 0 ? applicable[0].weeklyCapHours : emp.weeklyCapHours
}
