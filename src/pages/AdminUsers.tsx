import { useEffect, useState } from 'react'
import { Timestamp, collection, getDocs, doc, updateDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../firebase/config'

type UserDoc = {
  uid: string
  email: string
  displayName: string
  role: string
  employeeId?: string
  createdAt?: any
}

type EmployeeOption = { id: string; name: string }

const ROLES = ['patron', 'administrateur', 'manager', 'cuisine', 'corner'] as const
type Role = typeof ROLES[number]

const ROLE_STYLE: Record<string, { bg: string; color: string }> = {
  patron:         { bg: 'rgba(0,66,117,0.1)',  color: 'var(--primary)' },
  administrateur: { bg: 'rgba(0,90,156,0.1)',  color: 'var(--primary-container)' },
  manager:        { bg: 'rgba(84,101,30,0.1)', color: 'var(--secondary)' },
  cuisine:        { bg: 'rgba(0,66,117,0.08)', color: 'var(--primary)' },
  corner:         { bg: 'rgba(136,0,20,0.08)', color: 'var(--tertiary)' },
}

export default function AdminUsers() {
  const [users, setUsers] = useState<UserDoc[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  async function loadUsers() {
    setLoading(true)
    try {
      const [usersSnap, empSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'employees')),
      ])
      const list: UserDoc[] = usersSnap.docs.map(d => ({ uid: d.id, ...(d.data() as any) }))
      list.sort((a, b) => a.displayName.localeCompare(b.displayName))
      setUsers(list)
      const emps: EmployeeOption[] = empSnap.docs
        .map(d => ({ id: d.id, name: (d.data() as any).name ?? d.id }))
        .sort((a, b) => a.name.localeCompare(b.name))
      setEmployees(emps)
    } catch (e: any) {
      setError(e?.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadUsers() }, [])

  return (
    <div className="page">
      <div>
        <p className="section-label">Administration</p>
        <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 24, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>
          Gestion utilisateurs
        </h1>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: 12, fontSize: 13, color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <button onClick={() => setShowCreate(true)} className="btn-primary">
        + Nouveau compte
      </button>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px 0' }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {users.map(u => (
            <UserCard key={u.uid} user={u} employees={employees} onUpdated={loadUsers} onError={setError} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadUsers() }}
          onError={setError}
        />
      )}
    </div>
  )
}

// ─── Card utilisateur ─────────────────────────────────────────────
function UserCard({ user: u, employees, onUpdated, onError }: {
  user: UserDoc; employees: EmployeeOption[]; onUpdated: () => void; onError: (msg: string) => void
}) {
  const [editName, setEditName] = useState(u.displayName)
  const [editRole, setEditRole] = useState<Role>(u.role as Role)
  const [editEmpId, setEditEmpId] = useState(u.employeeId ?? '')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await updateDoc(doc(db, 'users', u.uid), {
        displayName: editName.trim(),
        role: editRole,
        employeeId: editEmpId || null,
        updatedAt: Timestamp.now(),
      })
      setSaved(true)
      setTimeout(() => { setSaved(false); setEditing(false); onUpdated() }, 1200)
    } catch (e: any) {
      onError(e?.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'deleteUser')
      await fn({ uid: u.uid })
      onUpdated()
    } catch (e: any) {
      onError(e?.message)
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const rs = ROLE_STYLE[u.role] || { bg: 'var(--surface-low)', color: 'var(--on-surface-3)' }

  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      {!editing ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--on-surface)' }}>{u.displayName}</div>
            <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 2 }}>{u.email}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: rs.bg, color: rs.color }}>
              {u.role}
            </span>
            <button onClick={() => setEditing(true)} className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }}>
              Modifier
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label className="section-label" style={{ display: 'block', marginBottom: 4 }}>NOM AFFICHÉ</label>
            <input className="input-filled" value={editName} onChange={e => setEditName(e.target.value)} />
          </div>
          <div>
            <label className="section-label" style={{ display: 'block', marginBottom: 4 }}>RÔLE</label>
            <select className="input-filled" value={editRole} onChange={e => setEditRole(e.target.value as Role)}>
              {ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="section-label" style={{ display: 'block', marginBottom: 4 }}>LIEN PLANNING</label>
            <select className="input-filled" value={editEmpId} onChange={e => setEditEmpId(e.target.value)}>
              <option value="">— Non lié —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ fontSize: 13, flex: 1 }}>
              {saved ? '✓ Enregistré' : saving ? 'Sauvegarde…' : 'Enregistrer'}
            </button>
            <button
              onClick={() => { setEditing(false); setEditName(u.displayName); setEditRole(u.role as Role) }}
              className="btn-secondary" style={{ fontSize: 13 }}
            >
              Annuler
            </button>
          </div>
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} style={{ fontSize: 12, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '4px 0' }}>
              Supprimer ce compte…
            </button>
          ) : (
            <div style={{ background: 'rgba(192,57,43,0.08)', borderRadius: 10, padding: '10px 12px', border: '1px solid rgba(192,57,43,0.2)' }}>
              <p style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 600, marginBottom: 8 }}>
                Supprimer {u.displayName} ? Cette action est irréversible.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleDelete} disabled={deleting} className="btn-danger" style={{ flex: 1, fontSize: 12 }}>
                  {deleting ? 'Suppression…' : 'Confirmer suppression'}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="btn-secondary" style={{ fontSize: 12 }}>
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Modal création ───────────────────────────────────────────────
function CreateUserModal({ onClose, onCreated, onError }: {
  onClose: () => void; onCreated: () => void; onError: (msg: string) => void
}) {
  const [form, setForm] = useState({ displayName: '', email: '', password: '', role: 'corner' as Role })
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  function set(field: string, val: string) {
    setForm(f => ({ ...f, [field]: val }))
    setLocalError(null)
  }

  async function handleCreate() {
    if (!form.displayName.trim()) { setLocalError('Nom obligatoire'); return }
    if (!form.email.trim())       { setLocalError('Email obligatoire'); return }
    if (form.password.length < 6) { setLocalError('Mot de passe minimum 6 caractères'); return }

    setSaving(true)
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'createUser')
      await fn(form)
      onCreated()
    } catch (e: any) {
      setLocalError(e?.message || 'Erreur création')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(28,28,24,0.4)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 400, padding: 24 }}>
        <h2 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 18, fontWeight: 800, color: 'var(--on-surface)', marginBottom: 16 }}>
          Nouveau compte
        </h2>

        {localError && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: 8, fontSize: 13, color: 'var(--danger)' }}>
            {localError}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label className="section-label" style={{ display: 'block', marginBottom: 4 }}>NOM AFFICHÉ *</label>
            <input className="input-filled" placeholder="ex : Marie Dupont" value={form.displayName} onChange={e => set('displayName', e.target.value)} />
          </div>
          <div>
            <label className="section-label" style={{ display: 'block', marginBottom: 4 }}>EMAIL *</label>
            <input className="input-filled" type="email" placeholder="marie@matias.app" value={form.email} onChange={e => set('email', e.target.value)} />
          </div>
          <div>
            <label className="section-label" style={{ display: 'block', marginBottom: 4 }}>MOT DE PASSE * (min. 6 car.)</label>
            <input className="input-filled" type="password" placeholder="••••••••" value={form.password} onChange={e => set('password', e.target.value)} />
          </div>
          <div>
            <label className="section-label" style={{ display: 'block', marginBottom: 4 }}>RÔLE *</label>
            <select className="input-filled" value={form.role} onChange={e => set('role', e.target.value)}>
              {ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={handleCreate} disabled={saving} className="btn-primary" style={{ flex: 1, fontSize: 13 }}>
              {saving ? 'Création…' : 'Créer le compte'}
            </button>
            <button onClick={onClose} className="btn-secondary" style={{ fontSize: 13 }}>
              Annuler
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
