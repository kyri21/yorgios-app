import { useEffect, useState } from 'react'
import { getDocs, onSnapshot, orderBy, query, where, collection } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase/config'
import { useAuth } from '../auth/useAuth'
import { useToast } from '../hooks/useToast'
import { POINTAGE_ZONES } from '../config/pointageZones'

type TypePointage = 'arrivée' | 'départ'

type PointageDoc = {
  id: string
  userId: string
  userName: string
  date: string
  typePointage: TypePointage
  zoneId: string
  zoneLabel: string
  timestamp: any
  latitude: number
  longitude: number
  accuracy: number
  distanceToZone: number
  statut: 'validé' | 'refusé'
  deviceInfo?: string
}

type Tab = 'aujourdhui' | 'historique'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function formatHeure(ts: any): string {
  if (!ts?.toDate) return '—'
  return ts.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function calcDuree(arrivee: PointageDoc | null, depart: PointageDoc | null): string {
  if (!arrivee?.timestamp?.toDate || !depart?.timestamp?.toDate) return ''
  const ms = depart.timestamp.toDate().getTime() - arrivee.timestamp.toDate().getTime()
  if (ms <= 0) return ''
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return `${h}h${String(m).padStart(2, '0')}`
}

function getWeekBounds(offset: number): { start: string; end: string; label: string } {
  const now = new Date()
  const day = now.getDay() === 0 ? 7 : now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - day + 1 + offset * 7)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const toStr = (d: Date) => d.toISOString().slice(0, 10)
  return {
    start: toStr(monday),
    end: toStr(sunday),
    label: `${monday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} – ${sunday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`,
  }
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function Pointage() {
  const { user } = useAuth()
  const { show } = useToast()
  const isManager = user?.role === 'manager' || user?.role === 'patron' || user?.role === 'administrateur'

  const [tab, setTab] = useState<Tab>('aujourdhui')
  const [myPointages, setMyPointages] = useState<PointageDoc[] | undefined>(undefined)
  const [allPointages, setAllPointages] = useState<PointageDoc[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [lastType, setLastType] = useState<TypePointage | null>(null)

  // Historique
  const [weekOffset, setWeekOffset] = useState(0)
  const [histDocs, setHistDocs] = useState<PointageDoc[]>([])
  const [histLoading, setHistLoading] = useState(false)
  const weekBounds = getWeekBounds(weekOffset)

  // Charger mes pointages du jour
  useEffect(() => {
    if (!user?.uid) return
    const today = todayStr()
    const q = query(
      collection(db, 'pointages'),
      where('userId', '==', user.uid),
      where('date', '==', today),
    )
    getDocs(q).then(snap => {
      setMyPointages(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
    })
  }, [user?.uid])

  // Charger tous les pointages du jour pour managers (temps réel)
  useEffect(() => {
    if (!isManager) return
    const today = todayStr()
    const q = query(
      collection(db, 'pointages'),
      where('date', '==', today),
      orderBy('timestamp', 'asc'),
    )
    const unsub = onSnapshot(q, snap => {
      setAllPointages(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
    })
    return unsub
  }, [isManager])

  // Charger historique semaine
  useEffect(() => {
    if (tab !== 'historique') return
    setHistLoading(true)
    const q = query(
      collection(db, 'pointages'),
      where('date', '>=', weekBounds.start),
      where('date', '<=', weekBounds.end),
      ...(isManager ? [] : [where('userId', '==', user?.uid ?? '')]),
    )
    getDocs(q).then(snap => {
      setHistDocs(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
      setHistLoading(false)
    }).catch(() => setHistLoading(false))
  }, [tab, weekBounds.start, weekBounds.end, user?.uid])

  // Grouper les docs historique par date → par employé
  function groupHist(): { date: string; employees: { userId: string; userName: string; arrivee: PointageDoc | null; depart: PointageDoc | null }[] }[] {
    const byDate: Record<string, Record<string, { userId: string; userName: string; arrivee: PointageDoc | null; depart: PointageDoc | null }>> = {}
    for (const p of histDocs) {
      if (p.statut !== 'validé') continue
      if (!byDate[p.date]) byDate[p.date] = {}
      if (!byDate[p.date][p.userId]) byDate[p.date][p.userId] = { userId: p.userId, userName: p.userName, arrivee: null, depart: null }
      const emp = byDate[p.date][p.userId]
      if (p.typePointage === 'arrivée') emp.arrivee = p
      if (p.typePointage === 'départ') emp.depart = p
    }
    return Object.entries(byDate)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, emps]) => ({
        date,
        employees: Object.values(emps).sort((a, b) => a.userName.localeCompare(b.userName, 'fr')),
      }))
  }

  const validArrivee = myPointages?.find(p => p.typePointage === 'arrivée' && p.statut === 'validé')
  const validDepart = myPointages?.find(p => p.typePointage === 'départ' && p.statut === 'validé')

  async function handlePointage(type: TypePointage) {
    setStatus('loading')
    setErrorMsg(null)
    setLastType(type)

    if (!navigator.geolocation) {
      setErrorMsg('Géolocalisation non disponible sur cet appareil.')
      setStatus('error')
      return
    }

    const existing = myPointages?.find(p => p.typePointage === type && p.statut === 'validé')
    if (existing) {
      setErrorMsg(`Vous avez déjà pointé votre ${type} aujourd'hui à ${formatHeure(existing.timestamp)}.`)
      setStatus('error')
      return
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords
        try {
          const createPointage = httpsCallable(functions, 'createPointage')
          await createPointage({ latitude, longitude, accuracy, typePointage: type })
          // Recharger les pointages du jour après écriture serveur
          const today = todayStr()
          const snap = await getDocs(query(
            collection(db, 'pointages'),
            where('userId', '==', user?.uid ?? ''),
            where('date', '==', today),
          ))
          setMyPointages(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
          setStatus('success')
          show('Pointage enregistré')
        } catch (e: any) {
          const msg: string = e?.message || 'Erreur lors de l\'enregistrement.'
          setErrorMsg(msg)
          setStatus('error')
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setErrorMsg('Permission de géolocalisation refusée. Activez-la dans les réglages du navigateur.')
        } else if (err.code === err.TIMEOUT) {
          setErrorMsg('Délai dépassé. Vérifiez votre connexion et réessayez.')
        } else {
          setErrorMsg('Impossible d\'obtenir votre position.')
        }
        setStatus('error')
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    )
  }

  const isLoading = myPointages === undefined
  const done = !!validArrivee && !!validDepart
  const histGroups = groupHist()

  return (
    <div className="page" style={{ maxWidth: 520 }}>

      {/* Header éditorial */}
      <div>
        <p className="section-label" style={{ marginBottom: 4 }}>Gestion du temps</p>
        <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 24, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>
          Pointage
        </h1>
        <p style={{ fontSize: 13, color: 'var(--on-surface-2)', marginTop: 4, fontFamily: 'Manrope, sans-serif' }}>
          {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* Tabs */}
      <div className="nav-tabs">
        {([
          { key: 'aujourdhui', label: "Aujourd'hui" },
          { key: 'historique', label: 'Historique' },
        ] as { key: Tab; label: string }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`nav-tab${tab === t.key ? ' active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab Aujourd'hui ─────────────────────────────────────────────────── */}
      {tab === 'aujourdhui' && (
        <>
          {/* Carte pointage personnel */}
          <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
            {isLoading ? (
              <div style={{ color: 'var(--on-surface-3)', fontSize: 14, fontFamily: 'Manrope, sans-serif' }}>
                <div className="spinner" style={{ margin: '0 auto 12px' }} />
                Chargement…
              </div>
            ) : done ? (
              <>
                <div style={{ fontSize: 48, marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--success)', marginBottom: 8, fontFamily: 'Epilogue, sans-serif' }}>
                  Journée complète pointée
                </div>
                <div style={{ fontSize: 13, color: 'var(--on-surface-2)', marginBottom: 4, fontFamily: 'Manrope, sans-serif' }}>
                  Arrivée : <strong style={{ color: 'var(--on-surface)' }}>{formatHeure(validArrivee!.timestamp)}</strong>
                  {validArrivee!.zoneLabel && (
                    <span style={{ marginLeft: 8, padding: '2px 9px', background: 'rgba(0,66,117,0.08)', borderRadius: 99, fontSize: 11, color: 'var(--primary)', fontWeight: 600 }}>
                      {validArrivee!.zoneLabel}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: 'var(--on-surface-2)', fontFamily: 'Manrope, sans-serif' }}>
                  Départ : <strong style={{ color: 'var(--on-surface)' }}>{formatHeure(validDepart!.timestamp)}</strong>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--primary)', marginBottom: 20, fontFamily: 'Epilogue, sans-serif' }}>
                  {user?.displayName || user?.email}
                </div>

                {validArrivee && (
                  <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(45,122,79,0.08)', borderRadius: 10, fontSize: 13, color: 'var(--success)', textAlign: 'left', fontFamily: 'Manrope, sans-serif' }}>
                    ✅ Arrivée pointée à <strong>{formatHeure(validArrivee.timestamp)}</strong>
                    {validArrivee.zoneLabel && (
                      <span style={{ marginLeft: 8, padding: '2px 9px', background: 'rgba(45,122,79,0.12)', borderRadius: 99, fontSize: 11, fontWeight: 600 }}>
                        {validArrivee.zoneLabel}
                      </span>
                    )}
                  </div>
                )}

                {status === 'loading' ? (
                  <div>
                    <div className="spinner" style={{ margin: '0 auto 12px' }} />
                    <div style={{ fontSize: 13, color: 'var(--on-surface-2)', fontFamily: 'Manrope, sans-serif' }}>Localisation en cours…</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {!validArrivee && (
                      <button onClick={() => handlePointage('arrivée')} className="btn-primary" style={{ fontSize: 15, padding: '14px 28px' }}>
                        Pointer mon arrivée
                      </button>
                    )}
                    {validArrivee && !validDepart && (
                      <button onClick={() => handlePointage('départ')} className="btn-secondary" style={{ fontSize: 15, padding: '14px 28px', fontWeight: 700 }}>
                        Pointer mon départ
                      </button>
                    )}
                  </div>
                )}

                {status === 'success' && (
                  <div style={{ marginTop: 16, fontSize: 14, color: 'var(--success)', fontWeight: 600, fontFamily: 'Manrope, sans-serif' }}>
                    ✅ {lastType === 'arrivée' ? 'Arrivée' : 'Départ'} validé !
                  </div>
                )}
                {status === 'error' && errorMsg && (
                  <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(192,57,43,0.08)', borderRadius: 12, fontSize: 13, color: 'var(--danger)', textAlign: 'left', fontFamily: 'Manrope, sans-serif', border: '1px solid rgba(192,57,43,0.15)' }}>
                    ⚠️ {errorMsg}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Zones de référence */}
          <div className="card" style={{ padding: '14px 16px' }}>
            <p className="section-label" style={{ marginBottom: 10 }}>Zones autorisées</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {POINTAGE_ZONES.map(zone => (
                <div key={zone.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                  <span style={{ padding: '2px 10px', borderRadius: 99, background: 'rgba(0,66,117,0.08)', color: 'var(--primary)', fontWeight: 700, fontSize: 11 }}>
                    {zone.label}
                  </span>
                  <span style={{ color: 'var(--on-surface-2)', fontFamily: 'Manrope, sans-serif' }}>{zone.address}</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--on-surface-3)', fontSize: 11, fontFamily: 'Manrope, sans-serif' }}>±{zone.radiusMeters} m</span>
                </div>
              ))}
            </div>
          </div>

          {/* Vue manager — tous les pointages du jour */}
          {isManager && (
            <div>
              <p className="section-label" style={{ marginBottom: 10 }}>
                Pointages du jour ({allPointages.filter(p => p.statut === 'validé').length} validés)
              </p>
              {allPointages.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--on-surface-3)', fontSize: 14, fontFamily: 'Manrope, sans-serif' }}>
                  Aucun pointage aujourd'hui
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {allPointages.map(p => (
                    <div key={p.id} className="card" style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif' }}>{p.userName}</div>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                          background: p.statut === 'validé' ? 'rgba(45,122,79,0.10)' : 'rgba(192,57,43,0.10)',
                          color: p.statut === 'validé' ? 'var(--success)' : 'var(--danger)',
                        }}>
                          {p.statut === 'validé' ? '✓ Validé' : '✗ Refusé'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 11, padding: '1px 8px', borderRadius: 99, fontWeight: 700,
                          background: p.typePointage === 'arrivée' ? 'rgba(0,66,117,0.08)' : 'rgba(84,101,30,0.08)',
                          color: p.typePointage === 'arrivée' ? 'var(--primary)' : 'var(--secondary)',
                        }}>
                          {p.typePointage === 'arrivée' ? '▶ Arrivée' : '■ Départ'}
                        </span>
                        {p.zoneLabel && p.statut === 'validé' && (
                          <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 99, background: 'rgba(45,122,79,0.08)', color: 'var(--success)', fontWeight: 600 }}>
                            {p.zoneLabel}
                          </span>
                        )}
                        <span style={{ fontSize: 12, color: 'var(--on-surface-2)', fontFamily: 'Manrope, sans-serif' }}>{formatHeure(p.timestamp)}</span>
                        <span style={{ fontSize: 11, color: 'var(--on-surface-3)', marginLeft: 'auto', fontFamily: 'Manrope, sans-serif' }}>{p.distanceToZone} m · ±{p.accuracy} m</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Tab Historique ──────────────────────────────────────────────────── */}
      {tab === 'historique' && (
        <div>
          {/* Week navigator */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'var(--surface-low)', borderRadius: 12, padding: '10px 14px',
            border: '1px solid var(--border)', marginBottom: 16,
          }}>
            <button onClick={() => setWeekOffset(o => o - 1)} style={{
              background: 'var(--surface-mid)', border: 'none', borderRadius: 8,
              padding: '6px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 14, color: 'var(--on-surface)',
            }}>‹</button>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif' }}>
                {weekBounds.label}
              </div>
              {weekOffset === 0 && (
                <div style={{ fontSize: 10, color: 'var(--primary)', fontWeight: 700, marginTop: 2, letterSpacing: '0.04em' }}>SEMAINE EN COURS</div>
              )}
            </div>
            <button
              onClick={() => setWeekOffset(o => o + 1)}
              disabled={weekOffset >= 0}
              style={{
                background: weekOffset >= 0 ? 'var(--surface-low)' : 'var(--surface-mid)',
                border: 'none', borderRadius: 8,
                padding: '6px 12px', cursor: weekOffset >= 0 ? 'default' : 'pointer',
                fontWeight: 700, fontSize: 14, color: weekOffset >= 0 ? 'var(--on-surface-3)' : 'var(--on-surface)',
              }}
            >›</button>
          </div>

          {histLoading && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--on-surface-3)', fontSize: 14, fontFamily: 'Manrope, sans-serif' }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              Chargement…
            </div>
          )}

          {!histLoading && histGroups.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--on-surface-3)', fontSize: 14, fontFamily: 'Manrope, sans-serif' }}>
              Aucun pointage cette semaine.
            </div>
          )}

          {!histLoading && histGroups.map(day => (
            <div key={day.date} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, paddingLeft: 2, fontFamily: 'Manrope, sans-serif' }}>
                {formatDateLabel(day.date)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {day.employees.map(emp => (
                  <div key={emp.userId} className="card" style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      {isManager && (
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', minWidth: 80, fontFamily: 'Manrope, sans-serif' }}>{emp.userName}</div>
                      )}
                      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flex: 1, justifyContent: isManager ? 'flex-start' : 'space-around' }}>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'var(--on-surface-3)', marginBottom: 1, fontFamily: 'Manrope, sans-serif' }}>Arrivée</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: emp.arrivee ? 'var(--success)' : 'var(--on-surface-3)' }}>
                            {emp.arrivee ? formatHeure(emp.arrivee.timestamp) : '—'}
                          </div>
                        </div>
                        <div style={{ color: 'var(--border)', fontSize: 16 }}>→</div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'var(--on-surface-3)', marginBottom: 1, fontFamily: 'Manrope, sans-serif' }}>Départ</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: emp.depart ? 'var(--on-surface)' : 'var(--on-surface-3)' }}>
                            {emp.depart ? formatHeure(emp.depart.timestamp) : '—'}
                          </div>
                        </div>
                        {emp.arrivee && emp.depart && (
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 10, color: 'var(--on-surface-3)', marginBottom: 1, fontFamily: 'Manrope, sans-serif' }}>Durée</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>
                              {calcDuree(emp.arrivee, emp.depart)}
                            </div>
                          </div>
                        )}
                      </div>
                      {emp.arrivee && !emp.depart && (
                        <span style={{ fontSize: 10, color: 'var(--warning)', fontWeight: 700, background: 'rgba(180,83,9,0.08)', borderRadius: 6, padding: '2px 8px', fontFamily: 'Manrope, sans-serif' }}>
                          Sans départ
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
