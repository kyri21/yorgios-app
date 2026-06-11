import { useState, useEffect } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useNavigate } from 'react-router-dom'
import { DEFAULT_PERMISSIONS, mergeWithDefaults, type AppPermissions, type PermKey } from '../contexts/PermissionsContext'

// ─── Config du tableau ────────────────────────────────────────────
const PERM_GROUPS: { label: string; emoji: string; items: { key: PermKey; label: string; note?: string }[] }[] = [
  {
    label: 'Accès pages', emoji: '📄',
    items: [
      { key: 'page_planning',  label: 'Planning' },
      { key: 'page_commandes', label: 'Commandes clients', note: 'onglet Gestion' },
      { key: 'page_ca',        label: 'CA', note: 'chiffre d\'affaires' },
      { key: 'page_settings',  label: 'Paramètres' },
      { key: 'page_annonces',  label: 'Annonces', note: 'créer / gérer' },
      { key: 'page_conges',    label: 'Congés', note: 'valider / refuser' },
    ],
  },
  {
    label: 'Actions', emoji: '⚡',
    items: [
      { key: 'action_create_commande',          label: 'Créer une commande client' },
      { key: 'action_update_statut_commande',   label: 'Modifier le statut d\'une commande' },
      { key: 'action_delete_commande',          label: 'Supprimer une commande' },
      { key: 'action_derogation_temp',          label: 'Dérogation température refusée' },
      { key: 'action_delete_lot',               label: 'Supprimer un lot cuisine' },
      { key: 'action_delete_livraison',         label: 'Supprimer une livraison' },
      { key: 'action_delete_ac',                label: 'Modifier / supprimer une action corrective' },
    ],
  },
  {
    label: 'Visibilité champs', emoji: '👁',
    items: [
      { key: 'field_prix_estime',   label: 'Prix estimé commande' },
      { key: 'field_notes_cuisine', label: 'Notes cuisine dans commande' },
      { key: 'field_notes_manager', label: 'Notes manager dans commande' },
      { key: 'field_createur_lot',  label: 'Créateur du lot', note: 'affiché en Fabrication' },
    ],
  },
]

const ROLES: { key: keyof AppPermissions; label: string; color: string }[] = [
  { key: 'manager', label: 'Manager', color: '#5E5CE6' },
  { key: 'corner',  label: 'Corner',  color: '#FF2D55' },
  { key: 'cuisine', label: 'Cuisine', color: '#34C759' },
]

// ─── Composant ────────────────────────────────────────────────────
export default function AdminPermissions() {
  const navigate = useNavigate()
  const [perms, setPerms] = useState<AppPermissions>(DEFAULT_PERMISSIONS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'settings', 'permissions')).then(snap => {
      if (snap.exists()) setPerms(mergeWithDefaults(snap.data()))
      setLoading(false)
    })
  }, [])

  function toggle(role: keyof AppPermissions, key: PermKey) {
    setPerms(prev => ({
      ...prev,
      [role]: { ...prev[role], [key]: !prev[role][key] },
    }))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    await setDoc(doc(db, 'settings', 'permissions'), perms)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => navigate('/admin/settings')}
          style={{ background: 'var(--surface-mid)', border: 'none', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 18, flexShrink: 0 }}
        >←</button>
        <div>
          <p className="section-label" style={{ marginBottom: 2 }}>Administration</p>
          <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 24, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>
            Permissions
          </h1>
        </div>
      </div>

      {/* Légende */}
      <div style={{ padding: '10px 14px', background: 'rgba(0,66,117,0.06)', borderRadius: 12, border: '1px solid rgba(0,66,117,0.12)', fontSize: 12, color: 'var(--on-surface-2)' }}>
        <strong style={{ color: 'var(--primary)' }}>Patron</strong> et <strong style={{ color: 'var(--primary)' }}>Administrateur</strong> ont toujours accès à tout — non configurables.
      </div>

      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
      ) : (
        <>
          {/* Tableau */}
          <div style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', overflow: 'hidden' }}>
            {/* En-tête colonnes */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr repeat(3, 80px)', background: 'var(--primary)', padding: '10px 16px', gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Permission</div>
              {ROLES.map(r => (
                <div key={r.key} style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff' }}>{r.label}</div>
              ))}
            </div>

            {PERM_GROUPS.map((group, gi) => (
              <div key={group.label}>
                {/* Header groupe */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr repeat(3, 80px)', padding: '8px 16px', background: 'var(--surface-low)', borderTop: gi > 0 ? '1px solid var(--border)' : undefined, gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {group.emoji} {group.label}
                  </div>
                  {ROLES.map(r => <div key={r.key} />)}
                </div>

                {/* Lignes */}
                {group.items.map((item, idx) => (
                  <div
                    key={item.key}
                    style={{
                      display: 'grid', gridTemplateColumns: '1fr repeat(3, 80px)',
                      padding: '11px 16px', gap: 8, alignItems: 'center',
                      borderTop: '1px solid var(--border-soft)',
                    }}
                  >
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--on-surface)' }}>{item.label}</span>
                      {item.note && <span style={{ fontSize: 11, color: 'var(--on-surface-3)', marginLeft: 6 }}>{item.note}</span>}
                    </div>
                    {ROLES.map(role => {
                      const checked = perms[role.key][item.key]
                      return (
                        <div key={role.key} style={{ display: 'flex', justifyContent: 'center' }}>
                          <button
                            onClick={() => toggle(role.key, item.key)}
                            style={{
                              width: 28, height: 28, borderRadius: 8, border: 'none', cursor: 'pointer',
                              background: checked ? role.color : 'var(--surface-mid)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 14, transition: 'all 0.15s',
                              boxShadow: checked ? `0 2px 8px ${role.color}44` : 'none',
                            }}
                            title={`${checked ? 'Désactiver' : 'Activer'} pour ${role.label}`}
                          >
                            {checked ? '✓' : ''}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Bouton save */}
          <button
            onClick={save}
            disabled={saving}
            className="btn-primary"
            style={{ width: '100%', padding: '14px', fontSize: 15, fontWeight: 700 }}
          >
            {saving ? 'Enregistrement…' : saved ? '✓ Enregistré' : 'Enregistrer les permissions'}
          </button>

          <p style={{ fontSize: 11, color: 'var(--on-surface-3)', textAlign: 'center', margin: 0 }}>
            Les modifications s'appliquent à la prochaine connexion des utilisateurs.
          </p>
        </>
      )}
    </div>
  )
}
