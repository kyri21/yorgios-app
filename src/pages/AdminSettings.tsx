import { useRef, useState, useEffect } from 'react'
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { db, functions } from '../firebase/config'
import { httpsCallable } from 'firebase/functions'
import { useNavigate } from 'react-router-dom'

/* ─── Types ─────────────────────────────────────────── */
interface NotifConfig {
  inbox: boolean
  push: boolean
  email?: boolean
}
interface NotificationsSettings {
  lateThresholdMinutes: number
  retardPointage: NotifConfig
  temperatures: NotifConfig
  tooGoodToGo: NotifConfig
  platsJour: NotifConfig
  urgences: NotifConfig
  commandeJour: NotifConfig
  livraisonTemperature: NotifConfig
  congesDemande: NotifConfig
}
interface EmailsSettings {
  retardDestinataire: string
  congesDestinataires: string
}
interface ExportsSettings {
  hygieneFormat: 'pdf' | 'csv'
  hygienePeriode: 'jour' | 'semaine' | 'mois'
}
interface ReceptionSettings {
  fournisseurs: string[]
}
interface TemperaturesSettings {
  alertMinC: number
}
interface RupturesSettings {
  produits: string[]
}
export interface PriorityLevel {
  level: number
  name: string
  color: string
}
export const DEFAULT_PRIORITY_LEVELS: PriorityLevel[] = [
  { level: 1, name: 'Best Seller',      color: '#c0392b' },
  { level: 2, name: 'Grande priorité',  color: '#e67e22' },
  { level: 3, name: 'Priorité moyenne', color: '#b45309' },
  { level: 4, name: 'Faible priorité',  color: '#2d7a4f' },
]

const DEFAULT_NOTIFS: NotificationsSettings = {
  lateThresholdMinutes: 10,
  retardPointage:       { inbox: true,  push: true,  email: true },
  temperatures:         { inbox: true,  push: true },
  tooGoodToGo:          { inbox: true,  push: true },
  platsJour:            { inbox: true,  push: true },
  urgences:             { inbox: true,  push: true },
  commandeJour:         { inbox: true,  push: true },
  livraisonTemperature: { inbox: true,  push: true },
  congesDemande:        { inbox: false, push: false, email: true },
}
const DEFAULT_EMAILS: EmailsSettings = {
  retardDestinataire:  'a.cozzika@gmail.com',
  congesDestinataires: 'a.cozzika@gmail.com,kyriazis@outlook.fr',
}
const DEFAULT_EXPORTS: ExportsSettings = {
  hygieneFormat:  'pdf',
  hygienePeriode: 'semaine',
}
const DEFAULT_RECEPTION: ReceptionSettings = {
  fournisseurs: ['Foodflow'],
}
const DEFAULT_TEMPERATURES: TemperaturesSettings = {
  alertMinC: -3,
}
const DEFAULT_RUPTURES: RupturesSettings = {
  produits: ['Briam', 'Moussaka', 'Brochette de Poulet Mariné au Citron', 'Boulette Kefta', 'Riz Épinard', 'Orzo Nature', 'Tzatziki', 'Houmous Classique', 'Tiropita épinards, Olives de Kalamata & Feta', 'Tiropita Menthe, Feta'],
}

/* ─── Composants UI ─────────────────────────────────── */
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} style={{
      width: 44, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer',
      background: value ? 'var(--primary)' : 'var(--surface-high)',
      transition: 'background 0.2s', padding: 2,
      display: 'flex', alignItems: 'center',
      justifyContent: value ? 'flex-end' : 'flex-start',
      flexShrink: 0,
    }}>
      <div style={{ width: 22, height: 22, borderRadius: 11, background: value ? '#fff' : 'var(--on-surface-3)' }} />
    </button>
  )
}

/* ─── Ligne notification ──────────────────────────────── */
function NotifRow({
  label, config, hasEmail, onChange, last,
}: {
  label: string
  config: NotifConfig
  hasEmail?: boolean
  onChange: (c: NotifConfig) => void
  last?: boolean
}) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: last ? 'none' : '1px solid var(--border-soft)' }}>
      <div style={{ fontSize: 14, color: 'var(--on-surface)', marginBottom: 10, fontWeight: 500 }}>{label}</div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--on-surface-3)' }}>Inbox</span>
          <Toggle value={config.inbox} onChange={v => onChange({ ...config, inbox: v })} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--on-surface-3)' }}>Push</span>
          <Toggle value={config.push} onChange={v => onChange({ ...config, push: v })} />
        </div>
        {hasEmail && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--on-surface-3)' }}>Email</span>
            <Toggle value={config.email ?? false} onChange={v => onChange({ ...config, email: v })} />
          </div>
        )}
      </div>
    </div>
  )
}

function NavRow({ label, sub, onClick, last }: { label: string; sub: string; onClick: () => void; last?: boolean }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 16px', background: 'transparent', border: 'none', cursor: 'pointer',
      borderBottom: last ? 'none' : '1px solid var(--border-soft)',
    }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-mid)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
    >
      <div>
        <div style={{ fontSize: 15, color: 'var(--on-surface)', fontWeight: 500, textAlign: 'left' }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 2, textAlign: 'left' }}>{sub}</div>
      </div>
      <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
        <path d="M1 1l5 5-5 5" stroke="var(--on-surface-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  )
}

/* ─── Page principale ─────────────────────────────────── */
function TestRupturesButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  async function send() {
    setStatus('loading')
    try {
      await httpsCallable(functions, 'sendNightlyRupturesNow')({})
      setStatus('ok')
      setTimeout(() => setStatus('idle'), 4000)
    } catch { setStatus('error'); setTimeout(() => setStatus('idle'), 4000) }
  }
  return (
    <button onClick={send} disabled={status === 'loading'} className="btn-secondary"
      style={{ width: 'auto', padding: '10px 18px', fontSize: 13 }}>
      {status === 'loading' ? '⏳ Envoi…' : status === 'ok' ? '✓ Email envoyé à Timour' : status === 'error' ? '✗ Erreur' : '📧 Tester l\'envoi maintenant'}
    </button>
  )
}

export default function AdminSettings() {
  const navigate = useNavigate()
  const [notifs, setNotifs] = useState<NotificationsSettings>(DEFAULT_NOTIFS)
  const [emails, setEmails] = useState<EmailsSettings>(DEFAULT_EMAILS)
  const [exports, setExports] = useState<ExportsSettings>(DEFAULT_EXPORTS)
  const [reception, setReception] = useState<ReceptionSettings>(DEFAULT_RECEPTION)
  const [newFournisseur, setNewFournisseur] = useState('')
  const fournisseurInputRef = useRef<HTMLInputElement>(null)
  const [temperatures, setTemperatures] = useState<TemperaturesSettings>(DEFAULT_TEMPERATURES)
  const [ruptures, setRuptures] = useState<RupturesSettings>(DEFAULT_RUPTURES)
  const [ruptureCatalogueSearch, setRuptureCatalogueSearch] = useState('')
  const [catalogueProduits, setCatalogueProduits] = useState<{ id: string; name: string; priority: number | null }[]>([])
  const [priorityLevels, setPriorityLevels] = useState<PriorityLevel[]>(DEFAULT_PRIORITY_LEVELS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [nSnap, eSnap, xSnap, rSnap, tSnap, rupSnap, plSnap, catSnap] = await Promise.all([
          getDoc(doc(db, 'settings', 'notifications')),
          getDoc(doc(db, 'settings', 'emails')),
          getDoc(doc(db, 'settings', 'exports')),
          getDoc(doc(db, 'settings', 'reception')),
          getDoc(doc(db, 'settings', 'temperatures')),
          getDoc(doc(db, 'settings', 'ruptures')),
          getDoc(doc(db, 'settings', 'priority_levels')),
          getDocs(query(collection(db, 'catalogue'), where('active', '==', true))),
        ])
        if (nSnap.exists()) setNotifs({ ...DEFAULT_NOTIFS, ...nSnap.data() } as NotificationsSettings)
        if (eSnap.exists()) setEmails({ ...DEFAULT_EMAILS, ...eSnap.data() } as EmailsSettings)
        if (xSnap.exists()) setExports({ ...DEFAULT_EXPORTS, ...xSnap.data() } as ExportsSettings)
        if (rSnap.exists()) setReception({ ...DEFAULT_RECEPTION, ...rSnap.data() } as ReceptionSettings)
        if (tSnap.exists()) setTemperatures({ ...DEFAULT_TEMPERATURES, ...tSnap.data() } as TemperaturesSettings)
        if (rupSnap.exists()) setRuptures({ ...DEFAULT_RUPTURES, ...rupSnap.data() } as RupturesSettings)
        if (plSnap.exists()) {
          const lvls = (plSnap.data() as any).levels
          if (Array.isArray(lvls) && lvls.length > 0) setPriorityLevels(lvls)
        }
        const catItems = catSnap.docs
          .map(d => ({ id: d.id, name: (d.data() as any).name as string, priority: (d.data() as any).priority ?? null }))
          .filter(p => p.name)
          .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
        setCatalogueProduits(catItems)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function save() {
    setSaving(true)
    try {
      await Promise.all([
        setDoc(doc(db, 'settings', 'notifications'), notifs),
        setDoc(doc(db, 'settings', 'emails'), emails),
        setDoc(doc(db, 'settings', 'exports'), exports),
        setDoc(doc(db, 'settings', 'reception'), reception),
        setDoc(doc(db, 'settings', 'temperatures'), temperatures),
        setDoc(doc(db, 'settings', 'ruptures'), ruptures),
        setDoc(doc(db, 'settings', 'priority_levels'), { levels: priorityLevels }),
      ])
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  function updateNotif(key: keyof Omit<NotificationsSettings, 'lateThresholdMinutes'>, v: NotifConfig) {
    setNotifs(n => ({ ...n, [key]: v }))
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
      <div className="spinner" />
    </div>
  )

  return (
    <div className="page">

      {/* Header */}
      <div>
        <p className="section-label">Administration</p>
        <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 24, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>
          Paramètres
        </h1>
        <p style={{ fontSize: 13, color: 'var(--on-surface-3)', marginTop: 4 }}>Administration de Matias</p>
      </div>

      {/* ── Section : Notifications ── */}
      <div>
        <p className="section-label" style={{ marginBottom: 8 }}>Notifications</p>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Seuil retard */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-soft)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div>
                <div style={{ fontSize: 14, color: 'var(--on-surface)', fontWeight: 500 }}>Seuil de retard</div>
                <div style={{ fontSize: 12, color: 'var(--on-surface-3)' }}>Email envoyé si retard supérieur à</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number" min={0} max={60} value={notifs.lateThresholdMinutes}
                  onChange={e => setNotifs(n => ({ ...n, lateThresholdMinutes: parseInt(e.target.value) || 0 }))}
                  style={{ width: 56, background: 'var(--surface-high)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--on-surface)', fontSize: 14, fontWeight: 700, textAlign: 'center', padding: '6px 8px', outline: 'none' }}
                />
                <span style={{ fontSize: 13, color: 'var(--on-surface-3)' }}>min</span>
              </div>
            </div>
          </div>
          <NotifRow label="Retard de pointage" config={notifs.retardPointage} hasEmail onChange={v => updateNotif('retardPointage', v)} />
          <NotifRow label="Températures frigo (8h30)" config={notifs.temperatures} onChange={v => updateNotif('temperatures', v)} />
          <NotifRow label="TooGoodToGo (9h00)" config={notifs.tooGoodToGo} onChange={v => updateNotif('tooGoodToGo', v)} />
          <NotifRow label="Plats du jour (11h00)" config={notifs.platsJour} onChange={v => updateNotif('platsJour', v)} />
          <NotifRow label="Urgences corner (15h00)" config={notifs.urgences} onChange={v => updateNotif('urgences', v)} />
          <NotifRow label="Commande du jour" config={notifs.commandeJour} onChange={v => updateNotif('commandeJour', v)} />
          <NotifRow label="Relevé température livraison" config={notifs.livraisonTemperature} onChange={v => updateNotif('livraisonTemperature', v)} />
          <NotifRow label="Demande de congés" config={notifs.congesDemande} hasEmail onChange={v => updateNotif('congesDemande', v)} last />
        </div>
      </div>

      {/* ── Section : Emails ── */}
      <div>
        <p className="section-label" style={{ marginBottom: 8 }}>Destinataires email</p>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-soft)' }}>
            <label style={{ fontSize: 12, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6 }}>
              Retards pointage (email principal)
            </label>
            <input className="input-filled" type="email" value={emails.retardDestinataire}
              onChange={e => setEmails(em => ({ ...em, retardDestinataire: e.target.value }))} />
          </div>
          <div style={{ padding: '14px 16px' }}>
            <label style={{ fontSize: 12, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6 }}>
              Demandes de congés (séparés par une virgule)
            </label>
            <input className="input-filled" type="text" value={emails.congesDestinataires}
              placeholder="email1@gmail.com,email2@outlook.fr"
              onChange={e => setEmails(em => ({ ...em, congesDestinataires: e.target.value }))} />
            <p style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 6 }}>
              Actuellement : {emails.congesDestinataires.split(',').filter(Boolean).join(' + ')}
            </p>
          </div>
        </div>
      </div>

      {/* ── Section : Export hygiène ── */}
      <div>
        <p className="section-label" style={{ marginBottom: 8 }}>Export contrôle hygiène</p>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-soft)' }}>
            <label style={{ fontSize: 12, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6 }}>Format d'export</label>
            <select className="input-filled" value={exports.hygieneFormat}
              onChange={e => setExports(x => ({ ...x, hygieneFormat: e.target.value as 'pdf' | 'csv' }))}>
              <option value="pdf">PDF</option>
              <option value="csv">CSV</option>
            </select>
          </div>
          <div style={{ padding: '14px 16px' }}>
            <label style={{ fontSize: 12, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6 }}>Période par défaut</label>
            <select className="input-filled" value={exports.hygienePeriode}
              onChange={e => setExports(x => ({ ...x, hygienePeriode: e.target.value as 'jour' | 'semaine' | 'mois' }))}>
              <option value="jour">Jour</option>
              <option value="semaine">Semaine</option>
              <option value="mois">Mois</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Section : Températures ── */}
      <div>
        <p className="section-label" style={{ marginBottom: 8 }}>Températures frigos</p>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 14, color: 'var(--on-surface)', fontWeight: 500 }}>Seuil alarme minimum</div>
              <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 2 }}>Alerte si température inférieure à</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="number" step="0.5" min={-20} max={0}
                value={temperatures.alertMinC}
                onChange={e => setTemperatures(t => ({ ...t, alertMinC: parseFloat(e.target.value) || -3 }))}
                style={{ width: 64, background: 'var(--surface-high)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--on-surface)', fontSize: 14, fontWeight: 700, textAlign: 'center', padding: '6px 8px', outline: 'none' }}
              />
              <span style={{ fontSize: 13, color: 'var(--on-surface-3)' }}>°C</span>
            </div>
          </div>
          <p style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 8, marginBottom: 0 }}>
            Le seuil maximum reste fixé à 4°C. Le seuil minimum par défaut est −3°C.
          </p>
        </div>
      </div>

      {/* ── Section : Fournisseurs réception ── */}
      <div>
        <p className="section-label" style={{ marginBottom: 8 }}>Fournisseurs réception cuisine</p>
        <div className="card">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {reception.fournisseurs.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0 }}>Aucun fournisseur configuré.</p>
            )}
            {reception.fournisseurs.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--surface-low)', borderRadius: 10 }}>
                <span style={{ flex: 1, fontSize: 14, color: 'var(--on-surface)', fontWeight: 500 }}>{f}</span>
                <button
                  onClick={() => setReception(r => ({ ...r, fournisseurs: r.fournisseurs.filter((_, j) => j !== i) }))}
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                >✕</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={fournisseurInputRef}
              className="input-filled"
              placeholder="Ajouter un fournisseur…"
              value={newFournisseur}
              onChange={e => setNewFournisseur(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newFournisseur.trim()) {
                  e.preventDefault()
                  const val = newFournisseur.trim()
                  if (!reception.fournisseurs.includes(val))
                    setReception(r => ({ ...r, fournisseurs: [...r.fournisseurs, val] }))
                  setNewFournisseur('')
                }
              }}
              style={{ flex: 1 }}
            />
            <button
              onClick={() => {
                const val = newFournisseur.trim()
                if (!val) return
                if (!reception.fournisseurs.includes(val))
                  setReception(r => ({ ...r, fournisseurs: [...r.fournisseurs, val] }))
                setNewFournisseur('')
                fournisseurInputRef.current?.focus()
              }}
              className="btn-primary"
              style={{ padding: '0 16px', fontSize: 20, lineHeight: 1 }}
            >+</button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 8, marginBottom: 0 }}>
            Appuie sur Entrée ou + pour ajouter. N'oublie pas de sauvegarder.
          </p>
        </div>
      </div>

      {/* ── Section : Plats disponibilité (Ruptures) ── */}
      <div>
        <p className="section-label" style={{ marginBottom: 8 }}>Plats disponibilité (Ruptures)</p>
        <div className="card">
          <p style={{ fontSize: 12, color: 'var(--on-surface-3)', margin: '0 0 12px' }}>
            Produits affichés en priorité dans la section "Disponibilité" des Ruptures. Liés au catalogue — le nom exact est utilisé pour le tri par priorité dans le Dashboard cuisine.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {ruptures.produits.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0 }}>Aucun produit configuré.</p>
            )}
            {ruptures.produits.map((p, i) => {
              const cat = catalogueProduits.find(c => c.name === p)
              const lvl = cat?.priority != null ? priorityLevels.find(l => l.level === cat.priority) : null
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--surface-low)', borderRadius: 10 }}>
                  {lvl && (
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: lvl.color, flexShrink: 0 }} />
                  )}
                  {!lvl && cat && (
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--on-surface-3)', flexShrink: 0 }} />
                  )}
                  {!cat && (
                    <span style={{ fontSize: 11, color: 'var(--warning)', flexShrink: 0 }}>⚠️</span>
                  )}
                  <span style={{ flex: 1, fontSize: 14, color: cat ? 'var(--on-surface)' : 'var(--warning)', fontWeight: 500 }}>{p}</span>
                  {!cat && (
                    <span style={{ fontSize: 10, color: 'var(--warning)' }}>hors catalogue</span>
                  )}
                  <button
                    onClick={() => setRuptures(r => ({ ...r, produits: r.produits.filter((_, j) => j !== i) }))}
                    style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                  >✕</button>
                </div>
              )
            })}
          </div>
          {/* Picker catalogue */}
          {(() => {
            const available = catalogueProduits.filter(c => !ruptures.produits.includes(c.name))
            const filtered = ruptureCatalogueSearch.trim()
              ? available.filter(c => c.name.toLowerCase().includes(ruptureCatalogueSearch.toLowerCase()))
              : available
            return (
              <div>
                <input
                  className="input-filled"
                  placeholder="Rechercher un produit du catalogue…"
                  value={ruptureCatalogueSearch}
                  onChange={e => setRuptureCatalogueSearch(e.target.value)}
                  style={{ marginBottom: ruptureCatalogueSearch ? 6 : 0 }}
                />
                {ruptureCatalogueSearch.trim() && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                    {filtered.length === 0 && (
                      <p style={{ fontSize: 12, color: 'var(--on-surface-3)', margin: '4px 0' }}>Aucun résultat.</p>
                    )}
                    {filtered.slice(0, 20).map(c => {
                      const lvl = c.priority != null ? priorityLevels.find(l => l.level === c.priority) : null
                      return (
                        <button
                          key={c.id}
                          onClick={() => {
                            setRuptures(r => ({ ...r, produits: [...r.produits, c.name] }))
                            setRuptureCatalogueSearch('')
                          }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border-soft)',
                            background: 'var(--surface)', cursor: 'pointer', textAlign: 'left',
                          }}
                        >
                          {lvl
                            ? <div style={{ width: 8, height: 8, borderRadius: '50%', background: lvl.color, flexShrink: 0 }} />
                            : <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--on-surface-3)', flexShrink: 0 }} />
                          }
                          <span style={{ flex: 1, fontSize: 13, color: 'var(--on-surface)' }}>{c.name}</span>
                          {lvl && <span style={{ fontSize: 11, color: lvl.color, fontWeight: 600 }}>{lvl.name}</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}
          <p style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 8, marginBottom: 0 }}>
            Recherche dans le catalogue · N'oublie pas de sauvegarder.
          </p>
        </div>
      </div>

      {/* ── Section : Niveaux de priorité catalogue ── */}
      <div>
        <p className="section-label" style={{ marginBottom: 4 }}>Niveaux de priorité catalogue</p>
        <p style={{ fontSize: 12, color: 'var(--on-surface-3)', margin: '0 0 10px' }}>
          Attribuez une priorité à chaque produit dans le Catalogue. Utilisée pour trier les ruptures dans le Dashboard cuisine.
        </p>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {priorityLevels.sort((a, b) => a.level - b.level).map((lvl, i) => (
            <div key={lvl.level} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                background: lvl.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800, color: '#fff',
              }}>{lvl.level}</div>
              <input
                className="input-filled"
                value={lvl.name}
                onChange={e => setPriorityLevels(prev => prev.map((l, j) => j === i ? { ...l, name: e.target.value } : l))}
                style={{ flex: 1, fontSize: 13 }}
              />
              <input
                type="color"
                value={lvl.color}
                onChange={e => setPriorityLevels(prev => prev.map((l, j) => j === i ? { ...l, color: e.target.value } : l))}
                style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', padding: 2, flexShrink: 0 }}
                title="Changer la couleur"
              />
              <button
                onClick={() => setPriorityLevels(prev => prev.filter((_, j) => j !== i))}
                style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16, padding: '0 2px', flexShrink: 0 }}
                title="Supprimer ce niveau"
              >✕</button>
            </div>
          ))}
          <button
            onClick={() => {
              const maxLevel = priorityLevels.reduce((m, l) => Math.max(m, l.level), 0)
              setPriorityLevels(prev => [...prev, { level: maxLevel + 1, name: `Priorité ${maxLevel + 1}`, color: '#9a9a94' }])
            }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              fontSize: 12, fontWeight: 700, color: 'var(--primary)',
              background: 'rgba(0,66,117,0.06)', border: '1.5px dashed rgba(0,66,117,0.25)',
              borderRadius: 10, padding: '8px 14px', cursor: 'pointer', marginTop: 2,
            }}
          >+ Ajouter un niveau</button>
        </div>
      </div>

      {/* ── Section : Administration ── */}
      <div>
        <p className="section-label" style={{ marginBottom: 8 }}>Administration</p>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <NavRow label="Gérer les utilisateurs" sub="Créer, modifier, lier au planning, supprimer" onClick={() => navigate('/admin/users')} />
          <NavRow label="Catalogue produits" sub="Ajouter, catégoriser, DLC — fabrication & réception" onClick={() => navigate('/admin/produits')} last />
        </div>
      </div>

      {/* ── Section : Comptes iPad (informatif) ── */}
      <div>
        <p className="section-label" style={{ marginBottom: 8 }}>Comptes iPad</p>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-soft)' }}>
            <div style={{ fontSize: 14, color: 'var(--on-surface)', fontWeight: 500, marginBottom: 2 }}>iPad Corner</div>
            <div style={{ fontSize: 12, color: 'var(--on-surface-3)' }}>ipad@yorgios.fr</div>
          </div>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 14, color: 'var(--on-surface)', fontWeight: 500, marginBottom: 2 }}>iPad Cuisine</div>
            <div style={{ fontSize: 12, color: 'var(--on-surface-3)' }}>ipad.cuisine@yorgios.fr</div>
          </div>
        </div>
      </div>

      {/* ── Email récap ruptures Timour ── */}
      <div>
        <p className="section-label" style={{ marginBottom: 8 }}>Email récap nuit — Timour</p>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 14, color: 'var(--on-surface)', fontWeight: 500, marginBottom: 4 }}>
            Ruptures + Commandes — envoi automatique à 21h30
          </div>
          <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginBottom: 14 }}>
            Destinataire : ytimour86@gmail.com · Trié par priorité catalogue, sans doublons
          </div>
          <TestRupturesButton />
        </div>
      </div>

      {/* ── Bouton Sauvegarder ── */}
      <button className="btn-primary" onClick={save} disabled={saving}
        style={{ fontSize: 15, padding: '14px 0' }}>
        {saved ? '✓ Sauvegardé' : saving ? 'Sauvegarde…' : 'Sauvegarder les paramètres'}
      </button>

    </div>
  )
}
