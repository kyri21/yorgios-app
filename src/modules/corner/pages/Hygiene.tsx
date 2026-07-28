import { useEffect, useState } from 'react'
import { Timestamp, doc, getDoc, setDoc } from 'firebase/firestore'
import { db, auth } from '../../../firebase/config'
import { useToast } from '../../../hooks/useToast'
import { useAuth } from '../../../auth/useAuth'
import { usePermissions } from '../../../contexts/PermissionsContext'
import ResponsableSelector from '../components/ResponsableSelector'
import {
  ITEMS_ORIGINE_IDS,
  getISOWeek, getPeriodId,
} from '../utils/hygiene'
import {
  ITEMS_ORIGINE, mergeHygieneItems, itemsPourPeriode, idsAttendus,
  type HygieneItemsSettings, type ChecklistKind,
} from '../../../utils/hygieneItems'
import { loadResponsableHistory, type HygieneResponsable } from '../firebase/hygieneResponsables'
import { JALON_LABELS, type JalonKey } from '../../../utils/hygieneSettings'

/** Plancher de rôle du droit de désigner, DÉLIBÉRÉMENT dupliqué depuis la
 *  règle Firestore (`isPatronOrManager()` sur `hygiene_responsables`).
 *
 *  Ce n'est pas un doublon à supprimer : la permission configurable ne peut
 *  que RETIRER le droit au manager, jamais l'accorder à corner ou cuisine.
 *  Sans ce plancher côté interface, cocher `action_designer_responsable_hygiene`
 *  pour le rôle corner afficherait le sélecteur à un salarié corner, dont
 *  l'écriture serait ensuite refusée par le serveur : il verrait un bouton,
 *  cliquerait, et recevrait un refus incompréhensible. Les deux couches
 *  doivent toujours rendre le même verdict. */
const ROLES_DESIGNATION_HYGIENE = ['patron', 'administrateur', 'manager']

type CheckType = 'quotidien' | 'hebdo' | 'mensuel' | 'historique' | 'historique'
type SavedCheck = {
  items: Record<string, boolean>; createdAt: any; createdBy: string
  // Liste des identifiants demandés au moment de la première sauvegarde de
  // la période — absente sur les documents antérieurs à cette évolution.
  itemsAttendus?: string[]
}

const TAB_CONFIG: Partial<Record<CheckType, { label: string; icon: string; desc: string }>> = {
  quotidien: { label: 'Quotidien',  icon: '📋', desc: '13 points à vérifier chaque jour' },
  hebdo:     { label: 'Hebdo',      icon: '📅', desc: '5 points à vérifier chaque semaine' },
  mensuel:   { label: 'Mensuel',    icon: '📆', desc: '1 point à vérifier chaque mois' },
}

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

function getWeekDates(offset: number): string[] {
  const now = new Date()
  const dow = now.getDay() === 0 ? 6 : now.getDay() - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - dow + offset * 7)
  monday.setHours(0, 0, 0, 0)
  const p = (n: number) => String(n).padStart(2, '0')
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  })
}

function getWeekLabel(offset: number): string {
  const dates = getWeekDates(offset)
  const [startY, startM, startD] = dates[0].split('-')
  const [, endM, endD] = dates[6].split('-')
  if (startM === endM) return `${parseInt(startD)}–${parseInt(endD)} ${new Date(dates[0] + 'T12:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`
  return `${parseInt(startD)} ${new Date(dates[0] + 'T12:00:00').toLocaleDateString('fr-FR', { month: 'short' })} – ${parseInt(endD)} ${new Date(dates[6] + 'T12:00:00').toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}`
}

const DAY_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

function todayISO() {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function getDocId(type: CheckType, dateStr: string): string {
  if (type === 'quotidien') return `${dateStr}_quotidien`
  // hebdo / mensuel : délégué à getPeriodId (module partagé) pour garantir
  // que l'identifiant construit ici correspond toujours à celui stocké en
  // base par hygieneResponsables.ts — une seule source de vérité.
  return getPeriodId(type as 'hebdo' | 'mensuel', new Date(dateStr + 'T12:00:00'))
}

function getDateLabel(type: CheckType, dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  if (type === 'quotidien') {
    const [y, m, day] = dateStr.split('-')
    return `Checklist du ${day}/${m}/${y}`
  }
  if (type === 'hebdo') {
    const week = getISOWeek(d)
    return `Semaine ${week} — ${d.getFullYear()}`
  }
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

export default function Hygiene() {
  const { show } = useToast()
  const { user, loading: authLoading } = useAuth()
  const { can } = usePermissions()
  // can() renvoie toujours true pour patron et administrateur ; seul le
  // manager est réglable. Le plancher de rôle ci-dessous reproduit celui de la
  // règle Firestore : la permission peut retirer le droit, jamais l'étendre.
  const canEditResponsable =
    ROLES_DESIGNATION_HYGIENE.includes(user?.role ?? '') &&
    can(user?.role, 'action_designer_responsable_hygiene')
  const currentUserName = user?.displayName || user?.email || '—'
  const today = todayISO()
  const [tab, setTab]                   = useState<CheckType>('quotidien')
  const [selectedDate, setSelectedDate] = useState(today)
  const [saved, setSaved]               = useState<SavedCheck | null>(null)
  const [checked, setChecked]           = useState<Record<string, boolean>>({})
  const [saving, setSaving]             = useState(false)
  const [saveError, setSaveError]       = useState('')
  const [loadingTab, setLoadingTab]     = useState(false)
  const [itemsSettings, setItemsSettings] = useState<HygieneItemsSettings>(ITEMS_ORIGINE)

  useEffect(() => {
    getDoc(doc(db, 'settings', 'hygiene_items'))
      .then(snap => { if (snap.exists()) setItemsSettings(mergeHygieneItems(snap.data())) })
      // Repli silencieux sur les items d'origine : la checklist doit rester
      // utilisable même si les réglages sont illisibles.
      .catch(e => console.error('[hygiene] réglages des items illisibles', e))
  }, [])

  // Historique state
  const [weekOffset, setWeekOffset]     = useState(0)
  const [histLoading, setHistLoading]   = useState(false)
  const [histDays, setHistDays]         = useState<Record<string, { total: number; done: number } | null>>({})
  const [histHebdo, setHistHebdo]       = useState<{ total: number; done: number } | null>(null)
  const [histMensuel, setHistMensuel]   = useState<{ total: number; done: number } | null>(null)
  const [respHist, setRespHist]         = useState<HygieneResponsable[]>([])
  const [respHistOpen, setRespHistOpen] = useState(false)
  const [respHistDone, setRespHistDone] = useState<Record<string, { done: number; total: number }>>({})
  const [respHistLoaded, setRespHistLoaded] = useState(false)
  const [respHistErreur, setRespHistErreur] = useState('')

  async function loadTab(type: CheckType, dateStr: string) {
    setLoadingTab(true); setSaved(null); setChecked({})
    try {
      const snap = await getDoc(doc(db, 'hygiene_corner', getDocId(type, dateStr)))
      if (snap.exists()) {
        const data = snap.data() as SavedCheck
        setSaved(data); setChecked(data.items || {})
      }
    } finally { setLoadingTab(false) }
  }

  useEffect(() => { if (tab !== 'historique') loadTab(tab, selectedDate) }, [tab, selectedDate])

  async function loadHistorique(offset: number) {
    setHistLoading(true)
    setHistDays({}); setHistHebdo(null); setHistMensuel(null)
    try {
      const dates = getWeekDates(offset)

      // Load 7 daily docs
      const dayResults: Record<string, { total: number; done: number } | null> = {}
      await Promise.all(dates.map(async (dateStr) => {
        const snap = await getDoc(doc(db, 'hygiene_corner', `${dateStr}_quotidien`))
        if (snap.exists()) {
          const data = snap.data() as SavedCheck
          const items = data.items || {}
          const attendus = data.itemsAttendus ?? ITEMS_ORIGINE_IDS.quotidien
          const done = attendus.filter(id => items[id]).length
          dayResults[dateStr] = { total: attendus.length, done }
        } else {
          dayResults[dateStr] = null
        }
      }))
      setHistDays(dayResults)

      // Load hebdo for this week
      const weekDocId = getDocId('hebdo', dates[0])
      const hebdoSnap = await getDoc(doc(db, 'hygiene_corner', weekDocId))
      if (hebdoSnap.exists()) {
        const data = hebdoSnap.data() as SavedCheck
        const items = data.items || {}
        const attendus = data.itemsAttendus ?? ITEMS_ORIGINE_IDS.hebdo
        setHistHebdo({ total: attendus.length, done: attendus.filter(id => items[id]).length })
      } else {
        setHistHebdo(null)
      }

      // Load mensuel for the month of Monday
      const mensuelDocId = getDocId('mensuel', dates[0])
      const mensuelSnap = await getDoc(doc(db, 'hygiene_corner', mensuelDocId))
      if (mensuelSnap.exists()) {
        const data = mensuelSnap.data() as SavedCheck
        const items = data.items || {}
        const attendus = data.itemsAttendus ?? ITEMS_ORIGINE_IDS.mensuel
        setHistMensuel({ total: attendus.length, done: attendus.filter(id => items[id]).length })
      } else {
        setHistMensuel(null)
      }
    } finally {
      setHistLoading(false)
    }
  }

  // Historique des responsables : indépendant de la semaine affichée (les
  // désignations couvrent 12 périodes glissantes, pas la semaine du
  // sélecteur ← →). Chargé une seule fois à l'ouverture de l'onglet
  // Historique — jamais relancé sur simple navigation de semaine, pour ne
  // pas clignoter une section déjà dépliée ni refaire ~24 lectures inutiles.
  async function loadResponsableHistorique() {
    setRespHistErreur('')
    try {
      const [histH, histM] = await Promise.all([
        loadResponsableHistory('hebdo', 12),
        loadResponsableHistory('mensuel', 12),
      ])
      const toutes = [...histH, ...histM].sort(
        (a, b) => b.periodStart.toMillis() - a.periodStart.toMillis()
      )
      setRespHist(toutes)

      // Statut de chaque période : lecture des documents hygiene_corner
      // correspondants. Chaque lecture est isolée via allSettled — l'échec
      // d'UNE période ne doit jamais faire disparaître le statut des
      // ~23 autres (Promise.all aurait rejeté en bloc et laissé
      // respHistDone vide, affichant à tort ❌ partout). Une période dont
      // la lecture échoue reste simplement absente de `statuts` : le
      // rendu la traite comme "statut indisponible", pas comme "non fait".
      const statuts: Record<string, { done: number; total: number }> = {}
      const results = await Promise.allSettled(toutes.map(async r => {
        const origine = r.kind === 'hebdo' ? ITEMS_ORIGINE_IDS.hebdo : ITEMS_ORIGINE_IDS.mensuel
        const snap = await getDoc(doc(db, 'hygiene_corner', r.periodId))
        const data = snap.exists() ? (snap.data() as SavedCheck) : undefined
        const ids = data?.itemsAttendus ?? origine
        return {
          periodId: r.periodId,
          done: ids.filter(id => data?.items?.[id]).length,
          total: ids.length,
        }
      }))
      for (const res of results) {
        if (res.status === 'fulfilled') {
          statuts[res.value.periodId] = { done: res.value.done, total: res.value.total }
        }
        // rejected → aucune entrée pour cette période, rendu neutre côté UI
      }
      setRespHistDone(statuts)
      setRespHistLoaded(true)
    } catch (e: any) {
      // Même principe que « – statut indisponible » plus bas : une donnée
      // illisible ne doit pas se faire passer pour une donnée absente.
      // « Aucune désignation enregistrée » sur un index composite pas encore
      // construit répondait au patron qu'aucun responsable n'a jamais existé.
      console.error('loadResponsableHistorique: historique des responsables illisible', e)
      setRespHist([]); setRespHistDone({})
      setRespHistErreur(e?.message || 'lecture impossible')
      // respHistLoaded reste false : revenir sur l'onglet Historique réessaie
      // (l'index composite finit par être construit). Pas de boucle : l'effet
      // ne dépend que de `tab` et `respHistLoaded`, tous deux inchangés ici.
    }
  }

  useEffect(() => { if (tab === 'historique') loadHistorique(weekOffset) }, [tab, weekOffset])
  useEffect(() => { if (tab === 'historique' && !respHistLoaded) loadResponsableHistorique() }, [tab, respHistLoaded])

  function toggle(id: string) { setChecked(p => ({ ...p, [id]: !p[id] })) }

  async function saveCheck() {
    setSaving(true)
    setSaveError('')
    try {
      const uid = auth.currentUser?.uid || ''
      // Écrit une seule fois, à la première sauvegarde de la période : une
      // resauvegarde ne doit pas rebattre les cartes en cours de semaine.
      const attendus = saved?.itemsAttendus ?? idsAttendus(
        itemsSettings,
        tab as ChecklistKind,
        new Date(selectedDate + 'T12:00:00'),
      )
      const data: SavedCheck = {
        items: checked,
        createdAt: Timestamp.now(),
        createdBy: uid,
        itemsAttendus: attendus,
      }
      await setDoc(doc(db, 'hygiene_corner', getDocId(tab, selectedDate)), data)
      setSaved(data)
      show('Checklist sauvegardée')
    } catch (e: any) {
      // Le bandeau rouge est la seule preuve visible qu'une écriture a été
      // refusée — une alerte native se perd sur mobile.
      setSaveError(e?.message || 'Enregistrement impossible')
    } finally { setSaving(false) }
  }

  const histWeekDates = getWeekDates(weekOffset)
  const items = tab !== 'historique'
    ? itemsPourPeriode(
        itemsSettings,
        tab as ChecklistKind,
        new Date(selectedDate + 'T12:00:00'),
        saved?.itemsAttendus,
      )
    : []
  const doneCount = items.filter(i => checked[i.id]).length
  const allDone = items.length > 0 && doneCount === items.length
  const pct = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0

  return (
    <div className="page">

      {/* ── Header ───────────────────────────────────────────────── */}
      <div>
        <p className="section-label" style={{ marginBottom: 2 }}>HACCP Ledger</p>
        <h1 style={{
          fontFamily: 'Epilogue, sans-serif',
          fontSize: 24, fontWeight: 800,
          color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0,
        }}>
          Check-list hygiène
        </h1>
      </div>

      {/* ── Sélecteur de date (masqué en mode Historique) ─────────── */}
      {tab !== 'historique' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="date"
            className="input-filled"
            style={{ flex: 1 }}
            value={selectedDate}
            max={today}
            onChange={e => setSelectedDate(e.target.value)}
          />
          {selectedDate !== today && (
            <button
              onClick={() => setSelectedDate(today)}
              style={{
                fontSize: 12, color: 'var(--primary)', background: 'rgba(0,66,117,0.08)',
                border: 'none', borderRadius: 8, cursor: 'pointer',
                fontWeight: 700, whiteSpace: 'nowrap', padding: '8px 12px',
                fontFamily: 'Manrope, sans-serif',
              }}
            >
              Aujourd'hui
            </button>
          )}
        </div>
      )}

      {/* ── Période ciblée ───────────────────────────────────────── */}
      {tab !== 'historique' && (
        <p style={{ fontSize: 12, color: 'var(--on-surface-3)', margin: 0 }}>
          {getDateLabel(tab, selectedDate)}
        </p>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 4, padding: 4,
        background: 'var(--surface-mid)', borderRadius: 14,
      }}>
        {(['quotidien', 'hebdo', 'mensuel', 'historique'] as CheckType[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '9px 4px', borderRadius: 10, border: 'none',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'Manrope, sans-serif',
            background: tab === t ? 'var(--surface)' : 'transparent',
            color: tab === t ? 'var(--primary)' : 'var(--on-surface-3)',
            boxShadow: tab === t ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
            transition: 'all 0.15s',
          }}>
            {t === 'quotidien' ? 'Quotidien' : t === 'hebdo' ? 'Hebdo' : t === 'mensuel' ? 'Mensuel' : 'Historique'}
          </button>
        ))}
      </div>

      {/* ── Historique ──────────────────────────────────────────── */}
      {tab === 'historique' && (
        histLoading ? (
          <div style={{ padding: '48px 20px', textAlign: 'center' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
          </div>
        ) : (
          <>
            {/* Navigation semaine */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button onClick={() => setWeekOffset(w => w - 1)} style={{ background: 'var(--surface-low)', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 18, cursor: 'pointer', color: 'var(--on-surface)' }}>←</button>
              <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif' }}>
                {histWeekDates.length > 0 ? (() => {
                  const [, m1, d1] = histWeekDates[0].split('-')
                  const [, m2, d2] = histWeekDates[6].split('-')
                  const months = ['jan','fév','mar','avr','mai','juin','jul','aoû','sep','oct','nov','déc']
                  return `${parseInt(d1)} ${months[parseInt(m1)-1]} – ${parseInt(d2)} ${months[parseInt(m2)-1]}`
                })() : ''}
              </span>
              <button onClick={() => setWeekOffset(w => Math.min(w + 1, 0))} disabled={weekOffset >= 0} style={{ background: weekOffset >= 0 ? 'var(--surface-mid)' : 'var(--surface-low)', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 18, cursor: weekOffset >= 0 ? 'default' : 'pointer', color: weekOffset >= 0 ? 'var(--on-surface-3)' : 'var(--on-surface)' }}>→</button>
            </div>
            {/* Grille 7 jours */}
            <div className="card" style={{ padding: '12px 14px' }}>
              <p className="section-label" style={{ marginBottom: 10 }}>Quotidien — Semaine</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                {histWeekDates.map((dateStr, i) => {
                  const data = histDays[dateStr]
                  const isFuture = dateStr > today
                  const isToday = dateStr === today
                  const isDone = data && data.done === data.total
                  const isPartial = data && data.done > 0 && data.done < data.total
                  const [, , dd] = dateStr.split('-')
                  return (
                    <div key={dateStr} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 2px', borderRadius: 10, background: isToday ? 'rgba(0,66,117,0.08)' : 'var(--surface-low)', border: isToday ? '1.5px solid rgba(0,66,117,0.22)' : '1.5px solid transparent' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: isToday ? 'var(--primary)' : 'var(--on-surface-3)', textTransform: 'uppercase' }}>{DAY_SHORT[i]}</span>
                      <span style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>{parseInt(dd)}</span>
                      <span style={{ fontSize: 16 }}>
                        {isFuture ? '·' : isDone ? '✅' : isPartial ? '🟡' : data === null ? '❌' : '·'}
                      </span>
                      {!isFuture && data && (
                        <span style={{ fontSize: 9, color: isDone ? 'var(--success)' : isPartial ? 'var(--warning)' : 'var(--on-surface-3)' }}>{data.done}/{data.total}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            {/* Hebdo + Mensuel */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="card" style={{ padding: '14px 16px', textAlign: 'center' }}>
                <p className="section-label" style={{ marginBottom: 8 }}>Hebdo</p>
                {histHebdo ? (
                  <>
                    <div style={{ fontSize: 22 }}>{histHebdo.done === histHebdo.total ? '✅' : histHebdo.done > 0 ? '🟡' : '❌'}</div>
                    <div style={{ fontSize: 12, color: 'var(--on-surface-2)', marginTop: 4 }}>{histHebdo.done}/{histHebdo.total}</div>
                  </>
                ) : <div style={{ fontSize: 22 }}>❌</div>}
                {(() => {
                  // Le responsable est désigné indépendamment de l'existence
                  // d'une checklist — l'afficher même quand rien n'est
                  // encore coché (l'état le plus fréquent en début de
                  // période) : ne dépend donc PAS de histHebdo.
                  const r = respHist.find(x => x.kind === 'hebdo' && x.periodId === getDocId('hebdo', histWeekDates[0]))
                  return r ? (
                    <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 4 }}>{r.assigneeName}</div>
                  ) : null
                })()}
              </div>
              <div className="card" style={{ padding: '14px 16px', textAlign: 'center' }}>
                <p className="section-label" style={{ marginBottom: 8 }}>Mensuel</p>
                {histMensuel ? (
                  <>
                    <div style={{ fontSize: 22 }}>{histMensuel.done === histMensuel.total ? '✅' : histMensuel.done > 0 ? '🟡' : '❌'}</div>
                    <div style={{ fontSize: 12, color: 'var(--on-surface-2)', marginTop: 4 }}>{histMensuel.done}/{histMensuel.total}</div>
                  </>
                ) : <div style={{ fontSize: 22 }}>❌</div>}
                {(() => {
                  // Idem : indépendant de l'existence d'un document mensuel.
                  const r = respHist.find(x => x.kind === 'mensuel' && x.periodId === getDocId('mensuel', histWeekDates[0]))
                  return r ? (
                    <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 4 }}>{r.assigneeName}</div>
                  ) : null
                })()}
              </div>
            </div>

            {/* Historique des responsables */}
            <div className="card" style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <p className="section-label" style={{ margin: 0 }}>Historique des responsables</p>
                <button
                  onClick={() => setRespHistOpen(o => !o)}
                  style={{
                    minHeight: 44, padding: '0 12px', border: 'none', background: 'transparent',
                    color: 'var(--primary)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'Manrope, sans-serif',
                  }}
                >
                  {respHistOpen ? '▲ Rétracter' : respHistErreur ? '▼ Afficher' : `▼ Afficher (${respHist.length})`}
                </button>
              </div>

              {respHistOpen && (
                respHistErreur ? (
                  // Échec de lecture : ni « aucune désignation » (faux), ni
                  // silence. L'historique sert de preuve — il doit dire quand
                  // il ne peut pas répondre.
                  <p style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600, margin: '8px 0 0' }}>
                    ⚠️ Historique des responsables indisponible — {respHistErreur}
                  </p>
                ) : respHist.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--on-surface-3)', margin: '8px 0 0' }}>
                    Aucune désignation enregistrée.
                  </p>
                ) : (
                  <div style={{ overflowX: 'auto', marginTop: 10 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ color: 'var(--on-surface-3)', textAlign: 'left' }}>
                          <th style={{ padding: '6px 8px', fontWeight: 700 }}>Période</th>
                          <th style={{ padding: '6px 8px', fontWeight: 700 }}>Responsable</th>
                          <th style={{ padding: '6px 8px', fontWeight: 700 }}>Statut</th>
                          <th style={{ padding: '6px 8px', fontWeight: 700 }}>Suivi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {respHist.map(r => {
                          const s = respHistDone[r.periodId]
                          const complet = !!s && s.done === s.total
                          const rappels = r.remindersSent ?? []
                          return (
                            <tr key={r.periodId} style={{ borderTop: '1px solid var(--border-soft)' }}>
                              <td style={{ padding: '8px', color: 'var(--on-surface-2)', whiteSpace: 'nowrap' }}>
                                {r.periodId.replace('_hebdo', '').replace('_mensuel', '')}
                                <span style={{ color: 'var(--on-surface-3)', marginLeft: 4 }}>
                                  {r.kind === 'hebdo' ? 'hebdo' : 'mensuel'}
                                </span>
                              </td>
                              <td style={{ padding: '8px', color: 'var(--on-surface)', fontWeight: 600 }}>
                                {r.assigneeName}
                                {(r.previousAssignees?.length ?? 0) > 0 && (
                                  <span style={{ fontSize: 10, color: 'var(--on-surface-3)', marginLeft: 5 }}>
                                    (réaffecté)
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '8px', whiteSpace: 'nowrap', color: s ? undefined : 'var(--on-surface-3)' }}>
                                {/* s absent = lecture du statut échouée pour CETTE période
                                    uniquement (isolée via allSettled dans loadResponsableHistorique) —
                                    rendu neutre qui n'affirme ni "fait" ni "pas fait". */}
                                {s ? `${complet ? '✅' : '❌'} ${s.done}/${s.total}` : '– statut indisponible'}
                              </td>
                              <td style={{ padding: '8px', color: 'var(--on-surface-3)' }}>
                                {/* Libellés lisibles plutôt que les clés stockées
                                    (« rappel1 ») : ce tableau sert de preuve qu'un
                                    salarié a bien été prévenu, il doit se lire sans
                                    connaître le code. Repli sur la clé brute si une
                                    valeur inconnue apparaît. */}
                                {rappels.length === 0
                                  ? '—'
                                  : rappels.map(r => JALON_LABELS[r as JalonKey] ?? r).join(', ')}
                                {r.escalatedAt ? ' · escaladé' : ''}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          </>
        )
      )}

      {loadingTab ? (
        <div style={{ padding: '48px 20px', textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          <p style={{ color: 'var(--on-surface-3)', margin: 0, fontSize: 13 }}>Chargement…</p>
        </div>
      ) : tab !== 'historique' ? (
        <>
          {/* `!authLoading` : tant que le profil n'est pas résolu, `user` est
              null et le bloc s'afficherait en lecture seule à un encadrant,
              avant de gagner ses contrôles une fraction de seconde plus tard. */}
          {(tab === 'hebdo' || tab === 'mensuel') && !authLoading && (
            <ResponsableSelector
              kind={tab}
              date={new Date(selectedDate + 'T12:00:00')}
              canEdit={canEditResponsable}
              currentUserName={currentUserName}
              // Une réaffectation périme l'historique déjà chargé : sans ce
              // reset, l'onglet Historique continuait d'afficher l'ancien nom
              // jusqu'au rechargement complet de la page.
              onAssigned={() => setRespHistLoaded(false)}
            />
          )}

          {/* ── Barre de progression ─────────────────────────────── */}
          <div className="card" style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)', margin: 0 }}>
                  {doneCount}/{items.length} effectués
                </p>
                <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: '2px 0 0' }}>
                  {(TAB_CONFIG as any)[tab]?.desc ?? ''}
                </p>
              </div>
              {saved
                ? <span className="chip-ok">Sauvegardé</span>
                : allDone
                  ? <span className="chip-warn">Non sauvegardé</span>
                  : null
              }
            </div>

            {/* Progress bar */}
            <div style={{
              height: 6, background: 'var(--surface-mid)', borderRadius: 99, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: 99,
                background: allDone ? 'var(--success)' : 'var(--primary)',
                width: `${pct}%`,
                transition: 'width 0.3s ease, background 0.3s ease',
              }} />
            </div>
          </div>

          {/* ── Liste des items ───────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map((item, idx) => {
              const isChecked = !!checked[item.id]
              return (
                <div
                  key={item.id}
                  onClick={() => toggle(item.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '13px 14px', borderRadius: 12, cursor: 'pointer',
                    background: isChecked ? 'var(--haccp-ok-bg)' : 'var(--surface-low)',
                    transition: 'background 0.15s',
                    userSelect: 'none',
                    WebkitTapHighlightColor: 'transparent',
                    animationDelay: `${idx * 0.02}s`,
                  }}
                >
                  {/* Checkbox HACCP style */}
                  <div style={{
                    width: 24, height: 24, borderRadius: 7, flexShrink: 0,
                    background: isChecked ? 'var(--secondary)' : 'var(--surface)',
                    border: `2px solid ${isChecked ? 'var(--secondary)' : 'var(--border)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.15s, border-color 0.15s',
                  }}>
                    {isChecked && (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>

                  <span style={{
                    flex: 1, fontSize: 14, fontWeight: isChecked ? 500 : 600,
                    color: isChecked ? 'var(--haccp-ok-text)' : 'var(--on-surface)',
                    textDecoration: isChecked ? 'line-through' : 'none',
                    transition: 'color 0.15s',
                  }}>
                    {item.label}
                  </span>

                  {isChecked && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--secondary)" strokeWidth="2.5">
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Bouton sauvegarde ─────────────────────────────────── */}
          <button onClick={saveCheck} disabled={saving} className="btn-primary">
            {saving ? 'Sauvegarde…' : 'Sauvegarder la check-list'}
          </button>

          {saveError && (
            <div style={{
              padding: '10px 12px', borderRadius: 10,
              background: 'rgba(192,57,43,0.08)', color: 'var(--danger)',
              fontSize: 12, fontWeight: 600,
            }}>
              ⚠️ {saveError}
            </div>
          )}

          {saved?.createdAt && (
            <p style={{ textAlign: 'center', color: 'var(--on-surface-3)', fontSize: 12, margin: 0 }}>
              Sauvegardé le {saved.createdAt?.toDate?.().toLocaleString?.() || '—'}
            </p>
          )}
        </>
      ) : null}
    </div>
  )
}
