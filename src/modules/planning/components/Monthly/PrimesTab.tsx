import React, { useState, useEffect } from 'react'
import { getDoc, doc, setDoc } from 'firebase/firestore'
import { db } from '../../../../firebase/config'
import type { Employee, MonthlyEmployeeStats } from '../../types'
import { loadPrimeMois, savePrimeMois, loadPrimesEmployes, savePrimesEmployes } from '../../firebase/primes'
import type { PrimeMois, PrimeEmploye } from '../../firebase/primes'
import { calcPrime, calcCaPrime, getBareme, hygieneBonus, monthKey, HYGIENE_BONUS, EXCLUDED_NAMES, DEFAULT_CA_PALIERS, DEFAULT_CA_MAX_PRIMES, getMaxCaPrime } from '../../utils/primes'
import type { CaPalier, CaMaxPrimes } from '../../utils/primes'

interface Props {
  month: Date
  employees: Employee[]
  stats: MonthlyEmployeeStats[]
  canEdit: boolean
  uid: string
  onPrimesChange: (mois: PrimeMois | null, employes: PrimeEmploye[], settings: { paliers: CaPalier[]; maxPrimes: CaMaxPrimes }) => void
}

export function PrimesTab({ month, employees, stats, canEdit, uid, onPrimesChange }: Props) {
  const [primeMois, setPrimeMois]     = useState<PrimeMois>({
    month: monthKey(month), caObjectif: null, caRealise: null, hygieneActif: false, hygieneScore: null,
  })
  const [caObjectif, setCaObjectif]   = useState<number | null>(null)
  const [caRealise, setCaRealise]     = useState<number | null>(null)
  const [empMap, setEmpMap]           = useState<Record<string, PrimeEmploye>>({})
  const [caPaliers, setCaPaliers]     = useState<CaPalier[]>(DEFAULT_CA_PALIERS)
  const [caMaxPrimes, setCaMaxPrimes] = useState<CaMaxPrimes>(DEFAULT_CA_MAX_PRIMES)
  const [showSettings, setShowSettings] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [saved, setSaved]             = useState(false)
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    setLoading(true)
    const mk = monthKey(month)
    Promise.all([
      loadPrimeMois(month),
      loadPrimesEmployes(month),
      getDoc(doc(db, 'objectifs_ca', mk)),
      getDoc(doc(db, 'settings', 'primes_ca')),
    ]).then(([mois, emps, caSnap, caSettingsSnap]) => {
      if (caSettingsSnap.exists()) {
        const d = caSettingsSnap.data() as any
        // Migration : anciens paliers avec `prime` (€ fixe) → ignorer, utiliser defaults
        if (Array.isArray(d.paliers) && d.paliers.every((p: any) => 'pct' in p)) setCaPaliers(d.paliers)
        if (d.maxPrimes && typeof d.maxPrimes === 'object') setCaMaxPrimes(d.maxPrimes)
      }
      let loadedCaObjectif: number | null = null
      let loadedCaRealise: number | null = null
      if (caSnap.exists()) {
        const d = caSnap.data() as any
        loadedCaObjectif = d.objectif != null ? Number(d.objectif) : null
        loadedCaRealise  = d.resultat != null ? Number(d.resultat) : null
        setCaObjectif(loadedCaObjectif)
        setCaRealise(loadedCaRealise)
      } else {
        setCaObjectif(null)
        setCaRealise(null)
      }
      const base: PrimeMois = { month: mk, caObjectif: null, caRealise: null, hygieneActif: false, hygieneScore: null }
      const pm: PrimeMois = { ...(mois ?? base), caObjectif: loadedCaObjectif, caRealise: loadedCaRealise }
      setPrimeMois(pm)
      // Build empMap with defaults for employees not yet saved
      const map: Record<string, PrimeEmploye> = {}
      const excludedIds = new Set(
        employees.filter(e => EXCLUDED_NAMES.includes(e.name)).map(e => e.id)
      )
      emps.filter(e => !excludedIds.has(e.empId)).forEach(e => { map[e.empId] = e })
      employees.filter(e => !EXCLUDED_NAMES.includes(e.name)).forEach(emp => {
        if (!map[emp.id]) {
          const retard = stats.find(s => s.empId === emp.id)?.total.retardMinutes ?? 0
          map[emp.id] = { empId: emp.id, month: mk, comportementOk: true, ponctualiteOk: retard === 0 }
        }
      })
      setEmpMap(map)
      onPrimesChange(pm, Object.values(map), { paliers: DEFAULT_CA_PALIERS, maxPrimes: DEFAULT_CA_MAX_PRIMES })
      setLoading(false)
    })
  }, [month])

  const hygBonus = primeMois.hygieneActif ? hygieneBonus(primeMois.hygieneScore) : 0
  const caRatio = caRealise && caObjectif && caObjectif > 0 ? caRealise / caObjectif : null

  function updateMois(patch: Partial<PrimeMois>) {
    setPrimeMois(prev => {
      const next = { ...prev, ...patch }
      onPrimesChange(next, Object.values(empMap), { paliers: caPaliers, maxPrimes: caMaxPrimes })
      return next
    })
  }

  function updateEmp(empId: string, patch: Partial<PrimeEmploye>) {
    setEmpMap(prev => {
      const next = { ...prev, [empId]: { ...prev[empId], ...patch } }
      onPrimesChange(primeMois, Object.values(next), { paliers: caPaliers, maxPrimes: caMaxPrimes })
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    await savePrimeMois(primeMois, uid)
    await savePrimesEmployes(Object.values(empMap), uid)
    await setDoc(doc(db, 'settings', 'primes_ca'), { paliers: caPaliers, maxPrimes: caMaxPrimes })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-surface-3)', fontSize: '13px' }}>
      Chargement…
    </div>
  )

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px' }}>

      {/* ── Paramètres globaux du mois ── */}
      <div style={{ background: 'var(--surface-low)', borderRadius: '10px', padding: '12px 14px', marginBottom: '14px', display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-end' }}>
        <div>
          <div style={labelSt}>Objectif CA</div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif', padding: '4px 0' }}>
            {caObjectif != null ? `${caObjectif.toLocaleString('fr-FR')} €` : <span style={{ color: 'var(--on-surface-3)', fontWeight: 400 }}>—</span>}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif' }}>depuis l'onglet CA</div>
        </div>
        <div>
          <div style={labelSt}>CA réalisé</div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif', padding: '4px 0' }}>
            {caRealise != null ? `${caRealise.toLocaleString('fr-FR')} €` : <span style={{ color: 'var(--on-surface-3)', fontWeight: 400 }}>—</span>}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif' }}>depuis l'onglet CA</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '2px' }}>
          <div style={labelSt}>Mois contrôle hygiène</div>
          <Toggle checked={primeMois.hygieneActif} disabled={!canEdit} onChange={v => updateMois({ hygieneActif: v })} />
        </div>
        {primeMois.hygieneActif && (
          <div>
            <div style={labelSt}>Score hygiène</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input type="number" disabled={!canEdit} value={primeMois.hygieneScore ?? ''} min={0} max={100}
                onChange={e => updateMois({ hygieneScore: e.target.value ? Number(e.target.value) : null })}
                style={{ ...inputSt, width: 60 }} />
              <span style={{
                fontSize: '10px', fontWeight: 700, borderRadius: '4px', padding: '2px 6px',
                background: hygBonus === HYGIENE_BONUS ? 'rgba(45,122,79,0.12)' : hygBonus > 0 ? 'rgba(180,83,9,0.12)' : 'rgba(28,28,24,0.06)',
                color: hygBonus === HYGIENE_BONUS ? '#2d7a4f' : hygBonus > 0 ? '#b45309' : 'var(--on-surface-3)',
              }}>
                {hygBonus === HYGIENE_BONUS ? `100% → +${HYGIENE_BONUS}€` : hygBonus > 0 ? `50% → +${hygBonus}€` : '0%'}
              </span>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingBottom: '2px' }}>
          <span style={{
            fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '5px',
            background: caRatio && caRatio >= 0.80 ? 'rgba(45,122,79,0.12)' : 'rgba(28,28,24,0.06)',
            color: caRatio && caRatio >= 0.80 ? '#2d7a4f' : 'var(--on-surface-3)',
          }}>
            📈 CA {caRatio ? `${Math.round(caRatio * 100)}%` : '—'} · prime pro-rata contrat
          </span>
          {canEdit && (
            <button onClick={() => setShowSettings(s => !s)} style={{ fontSize: '11px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', color: 'var(--on-surface-2)' }}>
              ⚙️ Barème
            </button>
          )}
        </div>
      </div>

      {/* ── Panneau paramètres barème ── */}
      {showSettings && canEdit && (
        <div style={{ background: 'var(--surface-low)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--on-surface)', marginBottom: 12 }}>⚙️ Paramètres du barème CA</div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {/* Paliers % CA → % prime max */}
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Paliers (seuil CA → % du max)</div>
              {caPaliers.slice().sort((a, b) => a.seuil - b.seuil).map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>≥</span>
                  <input type="number" min={50} max={200} step={1} value={Math.round(p.seuil * 100)}
                    onChange={e => setCaPaliers(prev => prev.map((x, j) => j === i ? { ...x, seuil: (parseInt(e.target.value)||80)/100 } : x))}
                    style={{ width: 52, border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', fontSize: 12, textAlign: 'center', background: 'var(--surface)', color: 'var(--on-surface)' }} />
                  <span style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>% →</span>
                  <input type="number" min={0} max={100} step={5} value={p.pct}
                    onChange={e => setCaPaliers(prev => prev.map((x, j) => j === i ? { ...x, pct: parseInt(e.target.value)||0 } : x))}
                    style={{ width: 52, border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', fontSize: 12, textAlign: 'center', background: 'var(--surface)', color: 'var(--on-surface)' }} />
                  <span style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>%</span>
                  <button onClick={() => setCaPaliers(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}>✕</button>
                </div>
              ))}
              <button onClick={() => setCaPaliers(prev => [...prev, { seuil: 1.20, pct: 100 }])} style={{ fontSize: 11, padding: '4px 10px', border: '1px dashed var(--border)', borderRadius: 6, background: 'none', cursor: 'pointer', color: 'var(--on-surface-2)' }}>+ Palier</button>
            </div>
            {/* Max prime par contrat */}
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Prime max par contrat</div>
              {[20, 25, 30, 35].map(h => (
                <div key={h} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, width: 32, color: 'var(--on-surface)' }}>{h}h</span>
                  <input type="number" min={0} max={1000} step={10} value={caMaxPrimes[h] ?? 0}
                    onChange={e => setCaMaxPrimes(prev => ({ ...prev, [h]: parseInt(e.target.value)||0 }))}
                    style={{ width: 64, border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', fontSize: 12, textAlign: 'center', background: 'var(--surface)', color: 'var(--on-surface)' }} />
                  <span style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>€</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--on-surface-3)', marginTop: 8 }}>Enregistré avec le bouton 💾 ci-dessous.</div>
        </div>
      )}

      {/* ── Cards par employé ── */}
      {employees.filter(e => !EXCLUDED_NAMES.includes(e.name)).map(emp => {
        const ep = empMap[emp.id]
        if (!ep) return null
        const retard = stats.find(s => s.empId === emp.id)?.total.retardMinutes ?? 0
        const b = getBareme(emp.weeklyCapHours)
        const compAmt  = emp.primeComportement ?? b.comp / 2
        const ponctAmt = emp.primePonctualite  ?? b.comp / 2
        const caPrime = calcCaPrime(caRealise, caObjectif, emp.weeklyCapHours, caPaliers, caMaxPrimes)
        const maxCa = getMaxCaPrime(emp.weeklyCapHours, caMaxPrimes)
        const prime = calcPrime(emp.weeklyCapHours, ep.comportementOk, ep.ponctualiteOk, caPrime, hygBonus, emp.primeComportement, emp.primePonctualite)

        return (
          <div key={emp.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px', marginBottom: '10px' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ background: emp.color, color: '#fff', borderRadius: '7px', padding: '3px 8px', fontSize: '12px', fontWeight: 800 }}>{emp.initials}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '13px' }}>{emp.name}</div>
                  <div style={{ fontSize: '10px', color: 'var(--on-surface-3)' }}>Contrat {emp.weeklyCapHours}h · comp. max {b.comp}€ · CA max {maxCa}€{primeMois.hygieneActif ? ` + ${hygBonus}€ hyg.` : ''}</div>
                </div>
              </div>
              <div style={{ fontSize: '17px', fontWeight: 800, color: prime > 0 ? 'var(--primary)' : 'var(--on-surface-3)' }}>
                {prime}€ <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--on-surface-3)' }}>brut</span>
              </div>
            </div>

            {/* Critères */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              <CriteriaRow
                emoji="🎭" label="Comportement en stand" tag="Manuel"
                amount={compAmt} earned={ep.comportementOk}
                checked={ep.comportementOk} disabled={!canEdit}
                onChange={v => updateEmp(emp.id, { comportementOk: v })}
              />
              <CriteriaRow
                emoji="⏰" label="Ponctualité"
                tag={retard > 0 ? `${retard}min de retard` : 'Aucun retard ✓'}
                tagWarn={retard > 0}
                amount={ponctAmt} earned={ep.ponctualiteOk}
                checked={ep.ponctualiteOk} disabled={!canEdit}
                onChange={v => updateEmp(emp.id, { ponctualiteOk: v })}
              />
              <CriteriaRow
                emoji="📈" label={`Performance CA (max ${maxCa}€)`}
                tag={caRatio ? `${Math.round(caRatio * 100)}%${caPrime > 0 ? ' ✓' : ''}` : 'CA non renseigné'}
                tagWarn={caPrime === 0}
                amount={caPrime} earned={caPrime > 0}
                checked={caPrime > 0} disabled={true}
                onChange={() => {}}
              />
              {primeMois.hygieneActif && (
                <CriteriaRow
                  emoji="🧹" label={`Hygiène · score ${primeMois.hygieneScore ?? '—'}`}
                  tag="Auto"
                  amount={hygBonus} earned={hygBonus > 0}
                  checked={hygBonus > 0} disabled={true}
                  onChange={() => {}}
                />
              )}
            </div>

            <div style={{ borderTop: '1px solid var(--border-soft)', marginTop: '8px', paddingTop: '8px', display: 'flex', justifyContent: 'flex-end', gap: '12px', alignItems: 'center' }}>
              <span style={{ fontSize: '10px', color: 'var(--on-surface-3)' }}>
                comp. {compAmt + ponctAmt}€ + CA {caPrime}€{primeMois.hygieneActif ? ` + ${hygBonus}€ hyg.` : ''}
              </span>
              <span style={{ fontSize: '14px', fontWeight: 800, color: prime > 0 ? 'var(--primary)' : 'var(--on-surface-3)' }}>= {prime}€ brut</span>
            </div>
          </div>
        )
      })}

      {canEdit && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px', marginBottom: '16px' }}>
          <button onClick={handleSave} disabled={saving}
            style={{ background: saved ? '#2d7a4f' : 'var(--primary)', border: 'none', color: '#fff', borderRadius: '10px', padding: '9px 20px', fontSize: '12px', fontWeight: 700, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? 'Enregistrement…' : saved ? '✓ Enregistré' : '💾 Enregistrer les primes'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Sous-composants ───────────────────────────────────────────────────────────

function CriteriaRow({ emoji, label, tag, tagWarn, amount, earned, checked, disabled, onChange }: {
  emoji: string; label: string; tag?: string; tagWarn?: boolean
  amount: number; earned: boolean; checked: boolean; disabled: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--border-soft)' }}>
      <span style={{ fontSize: '14px', width: '20px', flexShrink: 0 }}>{emoji}</span>
      <span style={{ flex: 1, fontSize: '11px', color: 'var(--on-surface-2)' }}>
        {label}
        {tag && <span style={{ marginLeft: 5, fontSize: '9px', fontWeight: 700, borderRadius: '3px', padding: '1px 4px', background: tagWarn ? 'rgba(192,57,43,0.1)' : 'rgba(0,66,117,0.08)', color: tagWarn ? '#c0392b' : 'var(--primary)' }}>{tag}</span>}
      </span>
      <Toggle checked={checked} disabled={disabled} onChange={onChange} />
      <span style={{ fontSize: '11px', fontWeight: 700, width: '44px', textAlign: 'right', color: earned ? '#2d7a4f' : 'var(--on-surface-3)' }}>
        {earned ? `+${amount}€` : '+0€'}
      </span>
    </div>
  )
}

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 32, height: 18, borderRadius: 9, flexShrink: 0, cursor: disabled ? 'default' : 'pointer',
        background: checked ? '#2d7a4f' : 'var(--surface-mid)',
        position: 'relative', transition: 'background 0.15s', opacity: disabled ? 0.7 : 1,
      }}
    >
      <div style={{
        position: 'absolute', width: 14, height: 14, borderRadius: '50%', background: '#fff',
        top: 2, left: checked ? 16 : 2, transition: 'left 0.15s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </div>
  )
}

const labelSt: React.CSSProperties = { fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--on-surface-3)', marginBottom: '4px' }
const inputSt: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--on-surface)', borderRadius: '7px', padding: '5px 8px', fontSize: '12px' }
