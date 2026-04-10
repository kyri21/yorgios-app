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

export function hygieneBonus(score: number | null): number {
  if (score == null) return 0
  if (score >= 92) return HYGIENE_BONUS
  if (score >= 85) return HYGIENE_BONUS / 2
  return 0
}

export function calcCaPrime(caRealise: number | null, caObjectif: number | null): number {
  if (!caRealise || !caObjectif || caObjectif <= 0) return 0
  const ratio = caRealise / caObjectif
  if (ratio >= 1.10) return 250
  if (ratio >= 1.00) return 175
  if (ratio >= 0.90) return 100
  if (ratio >= 0.80) return 50
  return 0
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
