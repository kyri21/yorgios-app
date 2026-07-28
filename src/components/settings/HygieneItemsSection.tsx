import { useState, type ReactNode } from 'react'
import { Timestamp } from 'firebase/firestore'
import {
  CHECKLIST_KINDS, slugPourLabel,
  type ChecklistKind, type HygieneItem, type HygieneItemsSettings,
} from '../../utils/hygieneItems'

type Props = {
  value: HygieneItemsSettings
  onChange: (next: HygieneItemsSettings) => void
}

const TITRES: Record<ChecklistKind, string> = {
  quotidien: 'Quotidien',
  hebdo:     'Hebdomadaire',
  mensuel:   'Mensuel',
}

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
          <span style={{ fontSize: 11, color: 'var(--on-surface-3)', whiteSpace: 'nowrap' }}>
            {resume}
          </span>
        )}
      </button>
      {ouvert && <div style={{ paddingBottom: 12 }}>{children}</div>}
    </div>
  )
}

const btnOrdre = {
  width: 44, minHeight: 44, border: 'none', background: 'transparent',
  color: 'var(--primary)', fontSize: 15, cursor: 'pointer', flexShrink: 0,
} as const

export default function HygieneItemsSection({ value, onChange }: Props) {
  const [nouveaux, setNouveaux] = useState<Record<string, string>>({})

  const setListe = (kind: ChecklistKind, liste: HygieneItem[]) =>
    onChange({ ...value, [kind]: liste.map((it, i) => ({ ...it, ordre: i })) })

  const majItem = (kind: ChecklistKind, id: string, patch: Partial<HygieneItem>) =>
    setListe(kind, value[kind].map(it => (it.id === id ? { ...it, ...patch } : it)))

  /** Retirer un item pose sa date de désactivation ; le réactiver l'efface.
   *
   *  Cette date est ce qui fait qu'un item retiré continue de compter pour une
   *  période déjà commencée : retirer un point de contrôle ne doit pas alléger
   *  rétroactivement une semaine en cours, sinon on peut effacer une exigence
   *  après coup sur un registre sanitaire. */
  function basculerActif(kind: ChecklistKind, it: HygieneItem, actif: boolean) {
    if (actif) {
      // Jamais `undefined` dans Firestore : on reconstruit l'objet sans la clé.
      const { desactiveLe, ...reste } = it
      void desactiveLe
      setListe(kind, value[kind].map(x => (x.id === it.id ? { ...reste, actif: true } : x)))
    } else {
      majItem(kind, it.id, { actif: false, desactiveLe: Timestamp.now() })
    }
  }

  function deplacer(kind: ChecklistKind, index: number, delta: number) {
    const actifs = value[kind].filter(i => i.actif)
    const cible = index + delta
    if (cible < 0 || cible >= actifs.length) return
    const reordonne = [...actifs]
    ;[reordonne[index], reordonne[cible]] = [reordonne[cible], reordonne[index]]
    // Les items retirés restent à la fin, hors du réordonnancement.
    setListe(kind, [...reordonne, ...value[kind].filter(i => !i.actif)])
  }

  function ajouter(kind: ChecklistKind) {
    const label = (nouveaux[kind] ?? '').trim()
    if (!label) return
    const tousIds = CHECKLIST_KINDS.flatMap(k => value[k].map(i => i.id))
    const nouvel: HygieneItem = {
      id: slugPourLabel(label, tousIds),
      label,
      actif: true,
      ordre: value[kind].length,
      // Posé automatiquement : c'est lui qui garantit que l'item ne compte
      // qu'à partir de la période suivante.
      creeLe: Timestamp.now(),
    }
    const actifs = value[kind].filter(i => i.actif)
    setListe(kind, [...actifs, nouvel, ...value[kind].filter(i => !i.actif)])
    setNouveaux(n => ({ ...n, [kind]: '' }))
  }

  return (
    <div>
      <p className="section-label" style={{ marginBottom: 8 }}>Nettoyage — items des checklists</p>
      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginBottom: 4 }}>
          Les points de contrôle affichés dans l'onglet Nettoyage du corner.
        </div>

        {CHECKLIST_KINDS.map(kind => {
          const actifs = value[kind].filter(i => i.actif)
          const retires = value[kind].filter(i => !i.actif)
          return (
            <Bloc
              key={kind}
              titre={TITRES[kind]}
              resume={`${actifs.length} item${actifs.length > 1 ? 's' : ''}`}
            >
              {actifs.map((it, i) => (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                  <button onClick={() => deplacer(kind, i, -1)} disabled={i === 0}
                    style={{ ...btnOrdre, opacity: i === 0 ? 0.25 : 1 }} title="Monter">↑</button>
                  <button onClick={() => deplacer(kind, i, 1)} disabled={i === actifs.length - 1}
                    style={{ ...btnOrdre, opacity: i === actifs.length - 1 ? 0.25 : 1 }} title="Descendre">↓</button>
                  <input
                    className="input-filled"
                    style={{ flex: 1, minHeight: 44 }}
                    value={it.label}
                    onChange={e => majItem(kind, it.id, { label: e.target.value })}
                  />
                  <button
                    onClick={() => basculerActif(kind, it, false)}
                    title="Retirer des prochaines checklists"
                    style={{ ...btnOrdre, color: 'var(--danger)' }}
                  >✕</button>
                </div>
              ))}

              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <input
                  className="input-filled"
                  style={{ flex: 1, minHeight: 44 }}
                  placeholder="Nouveau point de contrôle…"
                  value={nouveaux[kind] ?? ''}
                  onChange={e => setNouveaux(n => ({ ...n, [kind]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') ajouter(kind) }}
                />
                <button
                  onClick={() => ajouter(kind)}
                  disabled={!(nouveaux[kind] ?? '').trim()}
                  className="btn-secondary"
                  style={{ minHeight: 44, whiteSpace: 'nowrap' }}
                >+ Ajouter</button>
              </div>

              <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: '10px 0 0' }}>
                Un item ajouté aujourd'hui comptera à partir de la prochaine période.
                Les périodes en cours et passées ne changent pas.
              </p>

              {retires.length > 0 && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-soft)' }}>
                  <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginBottom: 6 }}>
                    Retirés — conservés pour rester lisibles dans l'historique
                  </div>
                  {retires.map(it => (
                    <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--on-surface-3)', textDecoration: 'line-through' }}>
                        {it.label}
                      </span>
                      <button
                        onClick={() => basculerActif(kind, it, true)}
                        className="btn-secondary"
                        style={{ minHeight: 44, fontSize: 12 }}
                      >Réactiver</button>
                    </div>
                  ))}
                </div>
              )}
            </Bloc>
          )
        })}
      </div>
    </div>
  )
}
