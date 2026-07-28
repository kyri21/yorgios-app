import { useState, type ReactNode } from 'react'
import {
  JALONS, JALON_LABELS, JOURS,
  collisionsHebdo, collisionsMensuel,
  type HygieneSettings, type JalonKey,
} from '../../utils/hygieneSettings'

type ManagerUser = { email: string; displayName: string; role: string }

type Props = {
  value: HygieneSettings
  onChange: (next: HygieneSettings) => void
  managers: ManagerUser[]
}

const HEURES = Array.from({ length: 24 }, (_, h) => h)
const CANAUX: { cle: 'designation' | 'rappel' | 'escalade'; label: string }[] = [
  { cle: 'designation', label: 'Désignation' },
  { cle: 'rappel',      label: 'Rappels' },
  { cle: 'escalade',    label: 'Escalade' },
]

/** Bloc repliable affichant son réglage courant en résumé quand il est fermé.
 *  Replié, l'ensemble de la section ne fait que cinq lignes — c'est ce qui rend
 *  acceptable qu'elle soit la plus dense de la page. */
function Bloc({ titre, resume, children }: { titre: string; resume: string; children: ReactNode }) {
  const [ouvert, setOuvert] = useState(false)
  return (
    <div style={{ borderTop: '1px solid var(--border-soft)' }}>
      <button
        onClick={() => setOuvert(o => !o)}
        style={{
          width: '100%', minHeight: 44, padding: '10px 0', border: 'none',
          background: 'transparent', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', gap: 12,
          fontFamily: 'Manrope, sans-serif', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)' }}>
          {ouvert ? '▾' : '▸'} {titre}
        </span>
        {!ouvert && (
          <span style={{
            fontSize: 11, color: 'var(--on-surface-3)', textAlign: 'right',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {resume}
          </span>
        )}
      </button>
      {ouvert && <div style={{ paddingBottom: 12 }}>{children}</div>}
    </div>
  )
}

function Avertissement({ groupes }: { groupes: JalonKey[][] }) {
  if (!groupes.length) return null
  return (
    <>
      {groupes.map((groupe, i) => (
        <p key={i} style={{ fontSize: 11, color: 'var(--warning)', margin: '10px 0 0' }}>
          ⚠️ {groupe.map(c => JALON_LABELS[c]).join(' et ')} sont réglés sur le même créneau —
          seul « {JALON_LABELS[groupe[groupe.length - 1]]} » partira.
        </p>
      ))}
    </>
  )
}

const selectStyle = { minHeight: 44, padding: '0 8px', flex: 1 } as const
const ligneStyle = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } as const

export default function HygieneResponsablesSection({ value, onChange, managers }: Props) {
  const set = (patch: Partial<HygieneSettings>) => onChange({ ...value, ...patch })

  const setHebdo = (cle: JalonKey, patch: Partial<HygieneSettings['hebdo'][JalonKey]>) =>
    set({ hebdo: { ...value.hebdo, [cle]: { ...value.hebdo[cle], ...patch } } })

  const setMensuel = (cle: JalonKey, patch: Partial<HygieneSettings['mensuel'][JalonKey]>) =>
    set({ mensuel: { ...value.mensuel, [cle]: { ...value.mensuel[cle], ...patch } } })

  const setCanal = (cle: 'designation' | 'rappel' | 'escalade', patch: Partial<{ email: boolean; push: boolean }>) =>
    set({ canaux: { ...value.canaux, [cle]: { ...value.canaux[cle], ...patch } } })

  const resumeHebdo = JALONS
    .filter(c => value.hebdo[c].actif)
    .map(c => `${JOURS[value.hebdo[c].jour].label.slice(0, 3).toLowerCase()} ${value.hebdo[c].heure}h`)
    .join(' · ') || 'aucun rappel actif'

  const resumeMensuel = JALONS
    .filter(c => value.mensuel[c].actif)
    .map(c => {
      const j = value.mensuel[c]
      return `${j.joursAvantFin === 0 ? 'dernier jour' : `J-${j.joursAvantFin}`} ${j.heure}h`
    })
    .join(' · ') || 'aucun rappel actif'

  const resumeCanaux = CANAUX
    .map(({ cle }) => {
      const c = value.canaux[cle]
      const actifs = [c.email && 'email', c.push && 'push'].filter(Boolean)
      return actifs.length ? actifs.join('+') : 'aucun'
    })
    .join(' · ')

  return (
    <div>
      <p className="section-label" style={{ marginBottom: 8 }}>Nettoyage — responsables</p>
      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginBottom: 12 }}>
          Rappels envoyés au salarié désigné responsable des checklists d'hygiène
          hebdomadaire et mensuelle, puis escalade s'ils restent sans effet.
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minHeight: 44 }}>
          <input
            type="checkbox"
            checked={value.rappelsEnabled}
            onChange={e => set({ rappelsEnabled: e.target.checked })}
            style={{ width: 16, height: 16, accentColor: 'var(--primary)', flexShrink: 0 }}
          />
          <span style={{ fontSize: 13, color: 'var(--on-surface)', fontWeight: 600 }}>
            Rappels automatiques activés
          </span>
        </label>

        {/* ── Rappels hebdomadaires ─────────────────────────────── */}
        <Bloc titre="Rappels hebdomadaires" resume={resumeHebdo}>
          {JALONS.map(cle => (
            <div key={cle} style={ligneStyle}>
              <input
                type="checkbox"
                checked={value.hebdo[cle].actif}
                onChange={e => setHebdo(cle, { actif: e.target.checked })}
                style={{ width: 16, height: 16, accentColor: 'var(--primary)', flexShrink: 0 }}
              />
              <span style={{ fontSize: 12, color: 'var(--on-surface)', width: 88, flexShrink: 0 }}>
                {JALON_LABELS[cle]}
              </span>
              <select
                className="input-filled" style={selectStyle}
                value={value.hebdo[cle].jour}
                onChange={e => setHebdo(cle, { jour: Number(e.target.value) })}
              >
                {JOURS.map(j => <option key={j.valeur} value={j.valeur}>{j.label}</option>)}
              </select>
              <select
                className="input-filled" style={{ ...selectStyle, flex: 0, width: 80 }}
                value={value.hebdo[cle].heure}
                onChange={e => setHebdo(cle, { heure: Number(e.target.value) })}
              >
                {HEURES.map(h => <option key={h} value={h}>{h}h</option>)}
              </select>
            </div>
          ))}
          <Avertissement groupes={collisionsHebdo(value)} />
        </Bloc>

        {/* ── Rappels mensuels ──────────────────────────────────── */}
        <Bloc titre="Rappels mensuels" resume={resumeMensuel}>
          {JALONS.map(cle => (
            <div key={cle} style={ligneStyle}>
              <input
                type="checkbox"
                checked={value.mensuel[cle].actif}
                onChange={e => setMensuel(cle, { actif: e.target.checked })}
                style={{ width: 16, height: 16, accentColor: 'var(--primary)', flexShrink: 0 }}
              />
              <span style={{ fontSize: 12, color: 'var(--on-surface)', width: 88, flexShrink: 0 }}>
                {JALON_LABELS[cle]}
              </span>
              <input
                type="number" min={0} max={28}
                className="input-filled" style={{ ...selectStyle, flex: 0, width: 64 }}
                value={value.mensuel[cle].joursAvantFin}
                onChange={e => setMensuel(cle, { joursAvantFin: Math.max(0, Math.min(28, Number(e.target.value) || 0)) })}
              />
              <span style={{ fontSize: 11, color: 'var(--on-surface-3)', flex: 1 }}>
                jours avant la fin
              </span>
              <select
                className="input-filled" style={{ ...selectStyle, flex: 0, width: 80 }}
                value={value.mensuel[cle].heure}
                onChange={e => setMensuel(cle, { heure: Number(e.target.value) })}
              >
                {HEURES.map(h => <option key={h} value={h}>{h}h</option>)}
              </select>
            </div>
          ))}
          <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: '4px 0 0' }}>
            0 = le dernier jour du mois.
          </p>
          <Avertissement groupes={collisionsMensuel(value)} />
        </Bloc>

        {/* ── Canaux ────────────────────────────────────────────── */}
        <Bloc titre="Canaux de notification" resume={resumeCanaux}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <span style={{ flex: 1 }} />
            <span style={{ width: 56, fontSize: 11, color: 'var(--on-surface-3)', textAlign: 'center' }}>Email</span>
            <span style={{ width: 56, fontSize: 11, color: 'var(--on-surface-3)', textAlign: 'center' }}>Push</span>
          </div>
          {CANAUX.map(({ cle, label }) => (
            <div key={cle} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--on-surface)' }}>{label}</span>
              <span style={{ width: 56, textAlign: 'center' }}>
                <input
                  type="checkbox" checked={value.canaux[cle].email}
                  onChange={e => setCanal(cle, { email: e.target.checked })}
                  style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                />
              </span>
              <span style={{ width: 56, textAlign: 'center' }}>
                <input
                  type="checkbox" checked={value.canaux[cle].push}
                  onChange={e => setCanal(cle, { push: e.target.checked })}
                  style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                />
              </span>
            </div>
          ))}
          <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: '8px 0 0' }}>
            Sur iPhone, le push n'arrive que si l'application est installée sur l'écran
            d'accueil et que la permission a été accordée. L'email arrive toujours.
          </p>
        </Bloc>

        {/* ── Destinataires escalade ────────────────────────────── */}
        <Bloc titre="Destinataires de l'escalade" resume={`${value.escaladeDestinataires.length} personne(s)`}>
          <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginBottom: 10 }}>
            Alertés si la checklist n'est toujours pas faite en fin de période,
            ou si personne n'a été désigné.
          </div>
          {managers.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {managers.map(u => {
                const checked = value.escaladeDestinataires.includes(u.email)
                return (
                  <label key={u.email} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minHeight: 44 }}>
                    <input
                      type="checkbox" checked={checked}
                      onChange={e => set({
                        escaladeDestinataires: e.target.checked
                          ? [...value.escaladeDestinataires, u.email]
                          : value.escaladeDestinataires.filter(x => x !== u.email),
                      })}
                      style={{ width: 16, height: 16, accentColor: 'var(--primary)', flexShrink: 0 }}
                    />
                    <span style={{ fontSize: 13, color: 'var(--on-surface)' }}>
                      {u.displayName}
                      <span style={{ fontSize: 11, color: 'var(--on-surface-3)', marginLeft: 6 }}>
                        {u.email} · {u.role}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--on-surface-3)', margin: 0 }}>Chargement des utilisateurs…</p>
          )}
          {value.escaladeDestinataires.length === 0 && managers.length > 0 && (
            <p style={{ fontSize: 11, color: 'var(--warning)', marginTop: 10, marginBottom: 0 }}>
              Aucune personne sélectionnée — repli sur les responsables des alertes,
              puis sur la liste par défaut.
            </p>
          )}
        </Bloc>
      </div>
    </div>
  )
}
