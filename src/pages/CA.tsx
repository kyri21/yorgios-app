import { useEffect, useState } from 'react'
import { Timestamp, doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../auth/useAuth'

const MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

type MoisData = {
  objectif: string
  resultat: string
  notes: string
}

type AllData = Record<string, MoisData>

function docId(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

export default function CA() {
  const { user } = useAuth()
  const readOnly = ['corner', 'cuisine'].includes(user?.role ?? '')
  const year = new Date().getFullYear()
  const [data, setData] = useState<AllData>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadAll() {
      setLoading(true)
      try {
        const result: AllData = {}
        for (let m = 0; m < 12; m++) {
          const id = docId(year, m)
          const snap = await getDoc(doc(db, 'objectifs_ca', id))
          if (snap.exists()) {
            const d = snap.data() as any
            result[id] = {
              objectif: d.objectif != null ? String(d.objectif) : '',
              resultat: d.resultat != null ? String(d.resultat) : '',
              notes: d.notes || '',
            }
          } else {
            result[id] = { objectif: '', resultat: '', notes: '' }
          }
        }
        setData(result)
      } catch (e: any) {
        setError(e?.message)
      } finally {
        setLoading(false)
      }
    }
    loadAll()
  }, [year])

  function setField(id: string, field: keyof MoisData, val: string) {
    setData(prev => ({ ...prev, [id]: { ...prev[id], [field]: val } }))
  }

  async function saveMois(id: string) {
    const row = data[id]
    if (!row) return
    setSaving(id)
    setError(null)
    try {
      await setDoc(doc(db, 'objectifs_ca', id), {
        objectif: row.objectif ? parseFloat(row.objectif) : null,
        resultat: row.resultat ? parseFloat(row.resultat) : null,
        notes: row.notes.trim(),
        updatedAt: Timestamp.now(),
      }, { merge: true })
      setSaved(id)
      setTimeout(() => setSaved(null), 1500)
    } catch (e: any) {
      setError(e?.message)
    } finally {
      setSaving(null)
    }
  }

  const totObjectif = Object.values(data).reduce((s, r) => s + (r.objectif ? parseFloat(r.objectif) : 0), 0)
  const totResultat = Object.values(data).reduce((s, r) => s + (r.resultat ? parseFloat(r.resultat) : 0), 0)
  const pct = totObjectif > 0 ? Math.round((totResultat / totObjectif) * 100) : null

  return (
    <div className="page">

      {/* Header éditorial */}
      <div>
        <p className="section-label" style={{ marginBottom: 4 }}>Gestion financière</p>
        <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 24, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>
          Objectifs CA — {year}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--on-surface-2)', marginTop: 4, fontFamily: 'Manrope, sans-serif' }}>
          Saisie mensuelle objectif / résultat.
        </p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: 10, fontSize: 13, color: 'var(--danger)', fontWeight: 500, fontFamily: 'Manrope, sans-serif' }}>
          {error}
        </div>
      )}

      {/* Totaux */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <div className="card" style={{ textAlign: 'center', padding: '14px 8px' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary)', fontFamily: 'Epilogue, sans-serif', letterSpacing: '-0.02em' }}>
            {totObjectif > 0 ? `${totObjectif.toLocaleString('fr-FR')} €` : '—'}
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', marginTop: 4, letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'Manrope, sans-serif' }}>Objectif annuel</div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '14px 8px' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--secondary)', fontFamily: 'Epilogue, sans-serif', letterSpacing: '-0.02em' }}>
            {totResultat > 0 ? `${totResultat.toLocaleString('fr-FR')} €` : '—'}
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', marginTop: 4, letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'Manrope, sans-serif' }}>Résultat cumulé</div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '14px 8px' }}>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'Epilogue, sans-serif', letterSpacing: '-0.02em', color: pct != null && pct >= 100 ? 'var(--secondary)' : pct != null && pct >= 80 ? 'var(--warning)' : pct != null ? 'var(--tertiary)' : 'var(--on-surface-3)' }}>
            {pct != null ? `${pct} %` : '—'}
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', marginTop: 4, letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'Manrope, sans-serif' }}>Taux atteinte</div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--on-surface-2)' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13 }}>Chargement…</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {MOIS.map((nomMois, idx) => {
            const id = docId(year, idx)
            const row = data[id] || { objectif: '', resultat: '', notes: '' }
            const obj = row.objectif ? parseFloat(row.objectif) : null
            const res = row.resultat ? parseFloat(row.resultat) : null
            const moisPct = obj && res != null ? Math.round((res / obj) * 100) : null
            const isCurrentMonth = idx === new Date().getMonth()

            return (
              <div key={id} className="card" style={{
                outline: isCurrentMonth ? `2px solid var(--primary)` : 'none',
                outlineOffset: -1,
              }}>
                {/* Mois header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--on-surface)', fontFamily: 'Epilogue, sans-serif' }}>
                      {nomMois}
                    </span>
                    {isCurrentMonth && (
                      <span style={{ fontSize: 10, background: 'var(--primary)', color: '#fff', borderRadius: 99, padding: '2px 8px', fontFamily: 'Manrope, sans-serif', fontWeight: 700, letterSpacing: '0.02em' }}>
                        En cours
                      </span>
                    )}
                  </div>
                  {moisPct != null && (
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                      fontFamily: 'Manrope, sans-serif',
                      background: moisPct >= 100 ? 'var(--haccp-ok-bg)' : moisPct >= 80 ? 'var(--haccp-warn-bg)' : 'rgba(192,57,43,0.10)',
                      color: moisPct >= 100 ? 'var(--haccp-ok-text)' : moisPct >= 80 ? 'var(--haccp-warn-text)' : 'var(--danger)',
                    }}>
                      {moisPct} %
                    </span>
                  )}
                </div>

                {readOnly ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', marginBottom: 4, fontFamily: 'Manrope, sans-serif', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Objectif</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--on-surface)', fontFamily: 'Epilogue, sans-serif' }}>{obj != null ? `${obj.toLocaleString('fr-FR')} €` : '—'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', marginBottom: 4, fontFamily: 'Manrope, sans-serif', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Résultat</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--on-surface)', fontFamily: 'Epilogue, sans-serif' }}>{res != null ? `${res.toLocaleString('fr-FR')} €` : '—'}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', marginBottom: 4, fontFamily: 'Manrope, sans-serif', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Prime</div>
                      <span style={{ fontSize: 22 }}>{obj != null && res != null ? (res >= obj ? '✅' : '❌') : '—'}</span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, marginBottom: 10, alignItems: 'end' }}>
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', display: 'block', marginBottom: 4, fontFamily: 'Manrope, sans-serif', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Objectif (€)</label>
                        <input className="input" type="number" min="0" step="100" placeholder="0" value={row.objectif} onChange={e => setField(id, 'objectif', e.target.value)} />
                      </div>
                      <div>
                        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', display: 'block', marginBottom: 4, fontFamily: 'Manrope, sans-serif', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Résultat (€)</label>
                        <input className="input" type="number" min="0" step="100" placeholder="0" value={row.resultat} onChange={e => setField(id, 'resultat', e.target.value)} />
                      </div>
                      <div style={{ textAlign: 'center', paddingBottom: 2 }}>
                        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', display: 'block', marginBottom: 4, fontFamily: 'Manrope, sans-serif', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Prime</label>
                        <span style={{ fontSize: 22 }}>{obj != null && res != null ? (res >= obj ? '✅' : '❌') : '—'}</span>
                      </div>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', display: 'block', marginBottom: 4, fontFamily: 'Manrope, sans-serif', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Notes</label>
                      <input className="input" placeholder="Commentaire optionnel…" value={row.notes} onChange={e => setField(id, 'notes', e.target.value)} />
                    </div>
                    <button onClick={() => saveMois(id)} disabled={saving === id} className="btn-secondary" style={{ fontSize: 12 }}>
                      {saved === id ? '✅ Enregistré' : saving === id ? 'Sauvegarde…' : 'Enregistrer'}
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
