import { useRef, useState, useEffect } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
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
  produits: ['Briam', 'Moussaka', 'Brochette poulet', 'Kefta', 'Riz épinard', 'Orzo nature', 'Tzatziki', 'Houmous', 'Tiropita épinard', 'Tiropita menthe'],
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
  const [newRuptureProduit, setNewRuptureProduit] = useState('')
  const ruptureProduitInputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [nSnap, eSnap, xSnap, rSnap, tSnap, rupSnap] = await Promise.all([
          getDoc(doc(db, 'settings', 'notifications')),
          getDoc(doc(db, 'settings', 'emails')),
          getDoc(doc(db, 'settings', 'exports')),
          getDoc(doc(db, 'settings', 'reception')),
          getDoc(doc(db, 'settings', 'temperatures')),
          getDoc(doc(db, 'settings', 'ruptures')),
        ])
        if (nSnap.exists()) setNotifs({ ...DEFAULT_NOTIFS, ...nSnap.data() } as NotificationsSettings)
        if (eSnap.exists()) setEmails({ ...DEFAULT_EMAILS, ...eSnap.data() } as EmailsSettings)
        if (xSnap.exists()) setExports({ ...DEFAULT_EXPORTS, ...xSnap.data() } as ExportsSettings)
        if (rSnap.exists()) setReception({ ...DEFAULT_RECEPTION, ...rSnap.data() } as ReceptionSettings)
        if (tSnap.exists()) setTemperatures({ ...DEFAULT_TEMPERATURES, ...tSnap.data() } as TemperaturesSettings)
        if (rupSnap.exists()) setRuptures({ ...DEFAULT_RUPTURES, ...rupSnap.data() } as RupturesSettings)
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
            Liste des plats affichés dans la section "Est-ce que j'ai du stock ?" des Ruptures.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {ruptures.produits.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0 }}>Aucun plat configuré.</p>
            )}
            {ruptures.produits.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--surface-low)', borderRadius: 10 }}>
                <span style={{ flex: 1, fontSize: 14, color: 'var(--on-surface)', fontWeight: 500 }}>{p}</span>
                <button
                  onClick={() => setRuptures(r => ({ ...r, produits: r.produits.filter((_, j) => j !== i) }))}
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                >✕</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={ruptureProduitInputRef}
              className="input-filled"
              placeholder="Ajouter un plat…"
              value={newRuptureProduit}
              onChange={e => setNewRuptureProduit(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newRuptureProduit.trim()) {
                  e.preventDefault()
                  const val = newRuptureProduit.trim()
                  if (!ruptures.produits.includes(val))
                    setRuptures(r => ({ ...r, produits: [...r.produits, val] }))
                  setNewRuptureProduit('')
                }
              }}
              style={{ flex: 1 }}
            />
            <button
              onClick={() => {
                const val = newRuptureProduit.trim()
                if (!val) return
                if (!ruptures.produits.includes(val))
                  setRuptures(r => ({ ...r, produits: [...r.produits, val] }))
                setNewRuptureProduit('')
                ruptureProduitInputRef.current?.focus()
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

      {/* ── Bouton Sauvegarder ── */}
      <button className="btn-primary" onClick={save} disabled={saving}
        style={{ fontSize: 15, padding: '14px 0' }}>
        {saved ? '✓ Sauvegardé' : saving ? 'Sauvegarde…' : 'Sauvegarder les paramètres'}
      </button>

    </div>
  )
}
