import { useState, type ReactNode } from 'react'
import {
  JALONS, JALON_LABELS, JOURS, enumerer,
  collisionsHebdo, collisionsMensuel,
  type HygieneSettings, type JalonKey, type Collision,
} from '../../utils/hygieneSettings'

type ManagerUser = { email: string; displayName: string; role: string }

type Props = {
  value: HygieneSettings
  onChange: (next: HygieneSettings) => void
  managers: ManagerUser[]
}

/** Heures proposées : 0 à 23, SAUF 2h et 3h.
 *
 *  À Paris, le dernier dimanche d'octobre 2h du matin survient deux fois, et
 *  le dernier dimanche de mars il n'existe pas ; 3h est l'autre borne de cette
 *  fenêtre de bascule. Un jalon réglé là partirait en double en octobre — et
 *  la branche « aucun responsable désigné » n'ayant aucun marqueur
 *  d'idempotence, ce serait bien deux emails identiques aux encadrants — puis
 *  serait purement sauté en mars, sans trace. Les bascules tombent toujours un
 *  dimanche, c'est-à-dire le jour du créneau d'escalade par défaut : le risque
 *  est concret. Restreindre volontairement le choix vaut mieux qu'un
 *  comportement inexplicable deux fois par an. */
const HEURES = Array.from({ length: 24 }, (_, h) => h).filter(h => h !== 2 && h !== 3)

/** Un `<select>` dont la valeur n'est dans aucune option afficherait la
 *  première — soit « 0h » pour un jalon réglé à 2h hors interface. On réinjecte
 *  donc la valeur courante quand elle manque : mieux vaut proposer de la
 *  corriger que mentir sur le réglage en place. */
const heuresAvec = (courante: number) =>
  HEURES.includes(courante) ? HEURES : [...HEURES, courante].sort((a, b) => a - b)

/** Borne haute de `joursAvantFin` à la saisie. 27 et non 28 : en février
 *  (28 jours), le nombre de jours restants plafonne à 27 — un rappel réglé
 *  au-delà disparaîtrait un mois sur douze sans explication. La fusion des
 *  réglages borne plus large (0-30, le maximum atteignable dans un mois de
 *  31 jours) : elle assainit des données arbitraires, la saisie n'offre que
 *  les valeurs qui se déclenchent tous les mois. */
const JOURS_AVANT_FIN_MAX = 27
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

/** Le créneau est nommé, pas seulement le conflit : c'est lui qui permet de
 *  retrouver la ligne fautive dans le bloc au-dessus. */
function Avertissement({ groupes }: { groupes: Collision[] }) {
  if (!groupes.length) return null
  return (
    <>
      {groupes.map(({ jalons, creneau }, i) => (
        <p key={i} style={{ fontSize: 11, color: 'var(--warning)', margin: '10px 0 0' }}>
          ⚠️ {enumerer(jalons.map(c => JALON_LABELS[c]))}{' '}
          {jalons.length === 2 ? 'sont tous deux réglés' : 'sont tous réglés'} sur{' '}
          <strong>{creneau}</strong> — seul « {JALON_LABELS[jalons[jalons.length - 1]]} » partira.
        </p>
      ))}
    </>
  )
}

const selectStyle = { minHeight: 44, padding: '0 8px', flex: 1 } as const
const ligneStyle = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, minHeight: 44 } as const
const jalonLabelStyle = { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minHeight: 44, width: 96, flexShrink: 0 } as const

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
    .map(c => {
      const jourLabel = JOURS[value.hebdo[c].jour]?.label.slice(0, 3).toLowerCase() ?? '?'
      return `${jourLabel} ${value.hebdo[c].heure}h`
    })
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
              <label style={jalonLabelStyle}>
                <input
                  type="checkbox"
                  checked={value.hebdo[cle].actif}
                  onChange={e => setHebdo(cle, { actif: e.target.checked })}
                  style={{ width: 16, height: 16, accentColor: 'var(--primary)', flexShrink: 0 }}
                />
                <span style={{ fontSize: 12, color: 'var(--on-surface)' }}>
                  {JALON_LABELS[cle]}
                </span>
              </label>
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
                {heuresAvec(value.hebdo[cle].heure).map(h => <option key={h} value={h}>{h}h</option>)}
              </select>
            </div>
          ))}
          <Avertissement groupes={collisionsHebdo(value)} />
        </Bloc>

        {/* ── Rappels mensuels ──────────────────────────────────── */}
        <Bloc titre="Rappels mensuels" resume={resumeMensuel}>
          {JALONS.map(cle => (
            <div key={cle} style={ligneStyle}>
              <label style={jalonLabelStyle}>
                <input
                  type="checkbox"
                  checked={value.mensuel[cle].actif}
                  onChange={e => setMensuel(cle, { actif: e.target.checked })}
                  style={{ width: 16, height: 16, accentColor: 'var(--primary)', flexShrink: 0 }}
                />
                <span style={{ fontSize: 12, color: 'var(--on-surface)' }}>
                  {JALON_LABELS[cle]}
                </span>
              </label>
              <input
                type="number" min={0} max={JOURS_AVANT_FIN_MAX}
                className="input-filled" style={{ ...selectStyle, flex: 0, width: 64 }}
                value={value.mensuel[cle].joursAvantFin}
                onChange={e => setMensuel(cle, {
                  joursAvantFin: Math.max(0, Math.min(JOURS_AVANT_FIN_MAX, Math.round(Number(e.target.value) || 0))),
                })}
              />
              <span style={{ fontSize: 11, color: 'var(--on-surface-3)', flex: 1 }}>
                jours avant la fin
              </span>
              <select
                className="input-filled" style={{ ...selectStyle, flex: 0, width: 80 }}
                value={value.mensuel[cle].heure}
                onChange={e => setMensuel(cle, { heure: Number(e.target.value) })}
              >
                {heuresAvec(value.mensuel[cle].heure).map(h => <option key={h} value={h}>{h}h</option>)}
              </select>
            </div>
          ))}
          <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: '4px 0 0' }}>
            0 = le dernier jour du mois. Au-delà de {JOURS_AVANT_FIN_MAX}, le rappel ne
            partirait pas les mois courts (février n'a que 28 jours).
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
              <label style={{ width: 56, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox" checked={value.canaux[cle].email}
                  onChange={e => setCanal(cle, { email: e.target.checked })}
                  style={{ width: 16, height: 16, accentColor: 'var(--primary)', flexShrink: 0 }}
                />
              </label>
              <label style={{ width: 56, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox" checked={value.canaux[cle].push}
                  onChange={e => setCanal(cle, { push: e.target.checked })}
                  style={{ width: 16, height: 16, accentColor: 'var(--primary)', flexShrink: 0 }}
                />
              </label>
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
