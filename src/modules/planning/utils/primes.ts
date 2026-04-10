export const BAREME: Record<number, { comp: number; perf: number }> = {
  35: { comp: 60, perf: 240 },
  30: { comp: 50, perf: 200 },
  25: { comp: 40, perf: 160 },
  20: { comp: 30, perf: 120 },
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

export function calcPrime(
  weeklyCapHours: number,
  comportementOk: boolean,
  ponctualiteOk: boolean,
  performanceOk: boolean,
  hygBonus: number,
): number {
  const b = getBareme(weeklyCapHours)
  return (
    (comportementOk ? b.comp / 2 : 0) +
    (ponctualiteOk  ? b.comp / 2 : 0) +
    (performanceOk  ? b.perf     : 0) +
    hygBonus
  )
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
