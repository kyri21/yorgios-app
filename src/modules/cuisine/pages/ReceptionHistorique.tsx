import { useState, useEffect } from 'react'
import { collection, getDocs, orderBy, query, Timestamp } from 'firebase/firestore'
import { db } from '../../../firebase/config'

type Reception = {
  id: string
  fournisseur: string
  receivedAt: Timestamp
  productName: string
  temperatureC: number
  decision: 'ACCEPTE' | 'REFUSE' | 'A_VERIFIER'
  photoUrl: string | null
  commentaire: string | null
  category: string
}

function pad(n: number) { return String(n).padStart(2, '0') }

function formatDate(ts: Timestamp): string {
  const d = ts.toDate()
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDateISO(ts: Timestamp): string {
  const d = ts.toDate()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function decisionBadge(decision: Reception['decision']) {
  if (decision === 'ACCEPTE') return { label: 'Accepté', bg: 'rgba(84,101,30,0.15)', color: 'var(--success)', border: 'rgba(84,101,30,0.3)' }
  if (decision === 'REFUSE')  return { label: 'Refusé',  bg: 'rgba(136,0,20,0.15)',  color: 'var(--danger)', border: 'rgba(136,0,20,0.3)' }
  return { label: 'À vérifier', bg: 'rgba(180,83,9,0.15)', color: 'var(--warning)', border: 'rgba(180,83,9,0.3)' }
}

export default function ReceptionHistorique() {
  const [all, setAll] = useState<Reception[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [fournisseurFilter, setFournisseurFilter] = useState('')
  const [modalPhoto, setModalPhoto] = useState<string | null>(null)

  useEffect(() => {
    getDocs(query(collection(db, 'receptions'), orderBy('receivedAt', 'desc')))
      .then(snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Reception[]
        setAll(list)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const fournisseurs = Array.from(new Set(all.map(r => r.fournisseur))).sort()

  const filtered = all.filter(r => {
    if (fournisseurFilter && r.fournisseur !== fournisseurFilter) return false
    const dateStr = formatDateISO(r.receivedAt)
    if (dateFrom && dateStr < dateFrom) return false
    if (dateTo && dateStr > dateTo) return false
    return true
  })

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
      <div className="spinner" />
    </div>
  )

  return (
    <div style={{ padding: '16px', maxWidth: 640, margin: '0 auto' }} id="reception-historique-print">

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }} className="no-print-flex">
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--on-surface)', margin: 0 }}>Photos réceptions</h1>
          <p style={{ fontSize: 12, color: 'var(--on-surface-3)', margin: '2px 0 0' }}>{filtered.length} entrée{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => window.print()}
          style={{ padding: '8px 16px', borderRadius: 10, background: 'var(--surface-mid)', border: 'none', color: 'var(--on-surface)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'Manrope, sans-serif' }}
          className="no-print"
        >
          🖨️ Imprimer
        </button>
      </div>

      {/* Filtres */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }} className="no-print">
        <div>
          <label style={{ fontSize: 11, color: 'var(--on-surface-3)', fontWeight: 600, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Du</label>
          <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--on-surface-3)', fontWeight: 600, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Au</label>
          <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
      </div>
      <div style={{ marginBottom: 16 }} className="no-print">
        <label style={{ fontSize: 11, color: 'var(--on-surface-3)', fontWeight: 600, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fournisseur</label>
        <select className="input" value={fournisseurFilter} onChange={e => setFournisseurFilter(e.target.value)}>
          <option value="">Tous les fournisseurs</option>
          {fournisseurs.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--on-surface-3)', padding: 40, fontSize: 14 }}>Aucune réception trouvée</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(r => {
            const badge = decisionBadge(r.decision)
            return (
              <div key={r.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                {/* Card header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--on-surface)' }}>{r.productName}</div>
                    <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 2 }}>{r.fournisseur} · {formatDate(r.receivedAt)}</div>
                  </div>
                  <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`, whiteSpace: 'nowrap' }}>
                    {badge.label}
                  </span>
                </div>

                {/* Card body */}
                <div style={{ display: 'flex', gap: 12, padding: '10px 14px', alignItems: 'flex-start' }}>
                  {/* Infos */}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Temp.</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: r.decision === 'REFUSE' ? 'var(--danger)' : r.decision === 'A_VERIFIER' ? 'var(--warning)' : 'var(--success)' }}>
                          {r.temperatureC}°C
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Catégorie</div>
                        <div style={{ fontSize: 13, color: 'var(--on-surface)' }}>{r.category}</div>
                      </div>
                    </div>
                    {r.commentaire && (
                      <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 8, fontSize: 12, color: 'var(--on-surface-3)' }}>
                        {r.commentaire}
                      </div>
                    )}
                  </div>

                  {/* Photo */}
                  {r.photoUrl ? (
                    <button
                      onClick={() => setModalPhoto(r.photoUrl)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}
                    >
                      <img
                        src={r.photoUrl}
                        alt="Photo réception"
                        style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
                      />
                    </button>
                  ) : (
                    <div style={{ width: 72, height: 72, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 20 }}>📷</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal photo plein écran */}
      {modalPhoto && (
        <div
          onClick={() => setModalPhoto(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
          className="no-print"
        >
          <img
            src={modalPhoto}
            alt="Photo plein écran"
            style={{ maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain', borderRadius: 12 }}
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setModalPhoto(null)}
            style={{
              position: 'fixed', top: 20, right: 20,
              background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%',
              width: 40, height: 40, color: '#fff', fontSize: 20, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >✕</button>
        </div>
      )}

      {/* CSS print */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .no-print-flex { display: block !important; }
          body { background: white !important; color: black !important; }
          #reception-historique-print { padding: 0 !important; max-width: 100% !important; }
          [style*="background: var(--surface)"] { background: white !important; border: 1px solid #ccc !important; }
        }
      `}</style>
    </div>
  )
}
