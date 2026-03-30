import { useState, useEffect } from 'react'
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { doc, getDoc, updateDoc, addDoc, collection, Timestamp } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { auth, db } from '../firebase/config'
import { useAuth } from '../auth/useAuth'
import { mondayOf, weekId, addDays, loadWeek } from '../modules/planning/firebase/planning'
import type { Employee, WeekDraft } from '../modules/planning/types'

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const ROLE_LABELS: Record<string, string> = {
  patron: 'Patron', administrateur: 'Administrateur',
  manager: 'Manager', cuisine: 'Cuisine', corner: 'Corner',
}

/* ── Générer fichier ICS ── */
function generateICS(shifts: { dayIndex: number; start: number; end: number }[], monday: Date, employeeName: string): string {
  function pad(n: number) { return String(n).padStart(2, '0') }
  function toICSDate(date: Date, hour: number): string {
    const y = date.getFullYear()
    const m = pad(date.getMonth() + 1)
    const d = pad(date.getDate())
    return `${y}${m}${d}T${pad(hour)}0000`
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Matias//Planning Matias//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  shifts.forEach((s, idx) => {
    const day = addDays(monday, s.dayIndex)
    const uid = `matias-shift-${day.getFullYear()}${pad(day.getMonth()+1)}${pad(day.getDate())}-${idx}@matias.app`
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART;TZID=Europe/Paris:${toICSDate(day, s.start)}`,
      `DTEND;TZID=Europe/Paris:${toICSDate(day, s.end)}`,
      `SUMMARY:Shift Matias — ${employeeName}`,
      'LOCATION:Matias Restaurant',
      'END:VEVENT',
    )
  })

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

function downloadICS(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/* ── Trouver les plages horaires d'un employé dans un draft ── */
function getShifts(draft: WeekDraft, empId: string) {
  const result: { dayIndex: number; start: number; end: number }[] = []
  for (let i = 0; i < 7; i++) {
    const hoursMap = draft[i]?.hours ?? {}
    const worked = Object.entries(hoursMap)
      .filter(([, emps]) => emps.includes(empId))
      .map(([h]) => parseInt(h))
      .sort((a, b) => a - b)
    if (!worked.length) continue
    let start = worked[0], prev = worked[0]
    for (let j = 1; j <= worked.length; j++) {
      if (j === worked.length || worked[j] !== prev + 1) {
        result.push({ dayIndex: i, start, end: prev + 1 })
        if (j < worked.length) { start = worked[j] }
      }
      if (j < worked.length) prev = worked[j]
    }
  }
  return result
}

function todayLabel(dayIndex: number, monday: Date): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const day = addDays(monday, dayIndex)
  day.setHours(0, 0, 0, 0)
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return "Aujourd'hui"
  if (diff === 1) return 'Demain'
  return DAYS[dayIndex]
}

/* ── Section label ── */
function SectionLabel({ title }: { title: string }) {
  return (
    <p className="section-label" style={{ marginBottom: 8, paddingLeft: 2 }}>{title}</p>
  )
}

/* ── Row item ── */
function Row({ label, value, onClick, danger }: { label: string; value?: string; onClick?: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} disabled={!onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 16px', background: 'transparent', border: 'none',
      borderBottom: '1px solid var(--border-soft)', cursor: onClick ? 'pointer' : 'default',
      transition: 'background 0.1s', fontFamily: 'Manrope, sans-serif',
    }}
      onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLElement).style.background = 'var(--surface-mid)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >
      <span style={{ fontSize: 15, color: danger ? 'var(--danger)' : 'var(--on-surface)', fontWeight: 400 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {value && <span style={{ fontSize: 14, color: 'var(--on-surface-2)' }}>{value}</span>}
        {onClick && (
          <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
            <path d="M1 1l5 5-5 5" stroke="var(--on-surface-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
    </button>
  )
}

export default function Profile() {
  const { user } = useAuth()
  const navigate = useNavigate()

  /* ── État sections ── */
  const [section, setSection] = useState<'phone' | 'password' | 'conges' | null>(null)

  /* ── Téléphone ── */
  const [phone, setPhone] = useState('')
  const [phoneLoading, setPhoneLoading] = useState(false)
  const [phoneSaved, setPhoneSaved] = useState(false)

  /* ── Mot de passe ── */
  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [pwdLoading, setPwdLoading] = useState(false)
  const [pwdMsg, setPwdMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  /* ── Planning ── */
  const [planDraft, setPlanDraft] = useState<WeekDraft | null>(null)
  const [planEmployee, setPlanEmployee] = useState<Employee | null>(null)
  const [planMonday, setPlanMonday] = useState<Date>(mondayOf(new Date()))
  const [planLoading, setPlanLoading] = useState(true)
  const [notifEnabled, setNotifEnabled] = useState(false)

  /* ── Congés ── */
  const [congesDateDebut, setCongesDateDebut] = useState('')
  const [congesDateFin, setCongesDateFin] = useState('')
  const [congesMotif, setCongesMotif] = useState('')
  const [congesLoading, setCongesLoading] = useState(false)
  const [congesSent, setCongesSent] = useState(false)

  /* ── Charger téléphone + notif pref ── */
  useEffect(() => {
    if (!user?.uid) return
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      if (snap.exists()) {
        const data = snap.data()
        setPhone(data.phone ?? '')
        setNotifEnabled(data.planningReminders ?? false)
      }
    })
  }, [user?.uid])

  /* ── Charger planning semaine ── */
  useEffect(() => {
    if (!user?.uid) { setPlanLoading(false); return }
    async function load() {
      setPlanLoading(true)
      try {
        const userDoc = await getDoc(doc(db, 'users', user!.uid))
        const employeeId = userDoc.data()?.employeeId as string | undefined
        if (!employeeId) { setPlanEmployee(null); setPlanLoading(false); return }
        const empDoc = await getDoc(doc(db, 'employees', employeeId))
        if (!empDoc.exists()) { setPlanEmployee(null); setPlanLoading(false); return }
        const emp = { id: empDoc.id, ...empDoc.data() } as Employee
        setPlanEmployee(emp)
        const draft = await loadWeek(planMonday)
        setPlanDraft(draft)
      } finally {
        setPlanLoading(false)
      }
    }
    load()
  }, [user?.uid, planMonday])

  /* ── Sauvegarder téléphone ── */
  async function savePhone() {
    if (!user?.uid) return
    setPhoneLoading(true)
    try {
      await updateDoc(doc(db, 'users', user.uid), { phone })
      setPhoneSaved(true)
      setTimeout(() => { setPhoneSaved(false); setSection(null) }, 1500)
    } finally {
      setPhoneLoading(false)
    }
  }

  /* ── Changer mot de passe ── */
  async function changePassword() {
    if (!auth.currentUser || !user?.email) return
    if (newPwd !== confirmPwd) { setPwdMsg({ type: 'err', text: 'Les mots de passe ne correspondent pas' }); return }
    if (newPwd.length < 6) { setPwdMsg({ type: 'err', text: 'Minimum 6 caractères' }); return }
    setPwdLoading(true)
    setPwdMsg(null)
    try {
      const cred = EmailAuthProvider.credential(user.email, currentPwd)
      await reauthenticateWithCredential(auth.currentUser, cred)
      await updatePassword(auth.currentUser, newPwd)
      setPwdMsg({ type: 'ok', text: 'Mot de passe modifié ✓' })
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('')
      setTimeout(() => { setPwdMsg(null); setSection(null) }, 2000)
    } catch {
      setPwdMsg({ type: 'err', text: 'Mot de passe actuel incorrect' })
    } finally {
      setPwdLoading(false)
    }
  }

  /* ── Activer rappels planning ── */
  async function toggleNotif() {
    if (!user?.uid) return
    if (!notifEnabled) {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') return
    }
    const next = !notifEnabled
    setNotifEnabled(next)
    await updateDoc(doc(db, 'users', user.uid), { planningReminders: next })
  }

  /* ── Envoyer demande de congés ── */
  async function sendConges() {
    if (!congesDateDebut || !congesDateFin || !congesMotif) return
    setCongesLoading(true)
    try {
      await addDoc(collection(db, 'conges_demandes'), {
        uid: user?.uid,
        nom: user?.displayName ?? user?.email,
        email: user?.email,
        dateDebut: congesDateDebut,
        dateFin: congesDateFin,
        motif: congesMotif,
        statut: 'En attente',
        createdAt: Timestamp.now(),
      })
      const sujet = encodeURIComponent(`Demande de congés de ${user?.displayName ?? user?.email}`)
      const corps = encodeURIComponent(
        `Bonjour,\n\nJe souhaite poser des congés du ${congesDateDebut} au ${congesDateFin}.\n\nMotif : ${congesMotif}\n\nCordialement,\n${user?.displayName ?? user?.email}`
      )
      window.location.href = `mailto:a.cozzika@gmail.com?cc=kyriazis@outlook.fr&subject=${sujet}&body=${corps}`
      setCongesSent(true)
      setCongesDateDebut(''); setCongesDateFin(''); setCongesMotif('')
      setTimeout(() => { setCongesSent(false); setSection(null) }, 3000)
    } finally {
      setCongesLoading(false)
    }
  }

  /* ── Initiales avatar ── */
  const initials = (user?.displayName || user?.email || '?')
    .split(/[\s@]/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('')

  /* ── Shifts de la semaine ── */
  const shifts = planEmployee && planDraft ? getShifts(planDraft, planEmployee.id) : []

  return (
    <div className="page" style={{ paddingTop: 24 }}>

      {/* ── Avatar + identité ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '4px 2px 12px' }}>
        <div style={{
          width: 64, height: 64, borderRadius: 20,
          background: 'var(--primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, fontWeight: 800, color: '#fff', flexShrink: 0,
          fontFamily: 'Epilogue, sans-serif',
        }}>{initials}</div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', fontFamily: 'Epilogue, sans-serif' }}>
            {user?.displayName || user?.email?.split('@')[0]}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', marginTop: 2, fontFamily: 'Manrope, sans-serif', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {ROLE_LABELS[user?.role ?? ''] ?? user?.role}
          </div>
          <div style={{ fontSize: 12, color: 'var(--on-surface-2)', marginTop: 2, fontFamily: 'Manrope, sans-serif' }}>{user?.email}</div>
        </div>
      </div>

      {/* ── Section : Mon compte ── */}
      <div>
        <SectionLabel title="Mon compte" />
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <Row label="Numéro de téléphone" value={phone || 'Non renseigné'} onClick={() => setSection(section === 'phone' ? null : 'phone')} />
          {section === 'phone' && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-soft)', display: 'flex', gap: 8, background: 'var(--surface-low)' }}>
              <input
                className="input" type="tel" placeholder="+33 6 ..." value={phone}
                onChange={e => setPhone(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="btn-primary" style={{ width: 'auto', padding: '0 16px' }}
                onClick={savePhone} disabled={phoneLoading}>
                {phoneSaved ? '✓' : phoneLoading ? '…' : 'Sauver'}
              </button>
            </div>
          )}
          <Row label="Mot de passe" value="Modifier mon accès" onClick={() => setSection(section === 'password' ? null : 'password')} />
          {section === 'password' && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--surface-low)' }}>
              <input className="input" type="password" placeholder="Mot de passe actuel" value={currentPwd} onChange={e => setCurrentPwd(e.target.value)} />
              <input className="input" type="password" placeholder="Nouveau mot de passe" value={newPwd} onChange={e => setNewPwd(e.target.value)} />
              <input className="input" type="password" placeholder="Confirmer le nouveau" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} />
              {pwdMsg && (
                <p style={{ fontSize: 13, color: pwdMsg.type === 'ok' ? 'var(--success)' : 'var(--danger)', margin: 0, fontFamily: 'Manrope, sans-serif' }}>{pwdMsg.text}</p>
              )}
              <button className="btn-primary" onClick={changePassword} disabled={pwdLoading || !currentPwd || !newPwd || !confirmPwd}>
                {pwdLoading ? 'Modification…' : 'Modifier le mot de passe'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Section : Mon planning cette semaine ── */}
      {user?.role !== 'manager' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <SectionLabel title="Mon planning cette semaine" />
            {shifts.length > 0 && (
              <button
                onClick={() => {
                  const ics = generateICS(shifts, planMonday, planEmployee!.name)
                  const monday = planMonday
                  const label = `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`
                  downloadICS(ics, `planning-matias-${label}.ics`)
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 8, border: '1px solid var(--border)',
                  background: 'var(--surface)', color: 'var(--primary)',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'Manrope, sans-serif', letterSpacing: '0.02em',
                  marginBottom: 4,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                TÉLÉCHARGER ICS
              </button>
            )}
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {planLoading ? (
              <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
                <div className="spinner" />
              </div>
            ) : !planEmployee ? (
              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ color: 'var(--on-surface-2)', fontSize: 14, margin: 0, fontFamily: 'Manrope, sans-serif' }}>
                  Planning non lié à votre compte.
                </p>
                {['patron', 'administrateur'].includes(user?.role ?? '') && (
                  <button
                    className="btn-primary"
                    style={{ fontSize: 13 }}
                    onClick={() => navigate('/admin/users')}
                  >
                    Lier mon compte dans Admin → Utilisateurs
                  </button>
                )}
              </div>
            ) : shifts.length === 0 ? (
              <div style={{ padding: '16px', color: 'var(--on-surface-2)', fontSize: 14, fontFamily: 'Manrope, sans-serif' }}>
                Aucun shift programmé cette semaine.
              </div>
            ) : (
              <>
                {shifts.map((s, i) => {
                  const label = todayLabel(s.dayIndex, planMonday)
                  const isToday = label === "Aujourd'hui"
                  const isTomorrow = label === 'Demain'
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '14px 16px', borderBottom: '1px solid var(--border-soft)',
                      background: isToday ? 'rgba(0,66,117,0.04)' : 'transparent',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: isToday ? 'var(--success)' : isTomorrow ? 'var(--primary)' : 'var(--border)',
                          flexShrink: 0,
                        }} />
                        <span style={{ fontSize: 15, color: isToday ? 'var(--on-surface)' : isTomorrow ? 'var(--on-surface)' : 'var(--on-surface-2)', fontWeight: isToday ? 700 : 400, fontFamily: 'Manrope, sans-serif' }}>
                          {label}
                        </span>
                      </div>
                      <span style={{ fontSize: 16, fontWeight: 800, color: isToday ? 'var(--primary)' : 'var(--on-surface)', fontFamily: 'Epilogue, sans-serif', letterSpacing: '-0.02em' }}>
                        {String(s.start).padStart(2,'0')}:00
                        <span style={{ fontSize: 12, color: 'var(--on-surface-3)', fontWeight: 400 }}> – </span>
                        {String(s.end).padStart(2,'0')}:00
                      </span>
                    </div>
                  )
                })}

                {/* Toggle rappels */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '14px 16px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 16 }}>🔔</span>
                    <div>
                      <div style={{ fontSize: 15, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif' }}>Rappels planning</div>
                      <div style={{ fontSize: 12, color: 'var(--on-surface-2)', marginTop: 2, fontFamily: 'Manrope, sans-serif' }}>
                        Notification au début de chaque shift
                      </div>
                    </div>
                  </div>
                  <button onClick={toggleNotif} style={{
                    width: 50, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer',
                    background: notifEnabled ? 'var(--primary)' : 'var(--surface-high)',
                    transition: 'background 0.2s', padding: 2, display: 'flex', alignItems: 'center',
                    justifyContent: notifEnabled ? 'flex-end' : 'flex-start',
                  }}>
                    <div style={{ width: 24, height: 24, borderRadius: 12, background: '#fff', boxShadow: '0 1px 4px rgba(28,28,24,0.15)' }} />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Section : Demande de congés ── */}
      <div>
        <SectionLabel title="Demande de congés" />
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <Row label="Faire une demande de congés" onClick={() => setSection(section === 'conges' ? null : 'conges')} />
          {section === 'conges' && (
            <div style={{ padding: '14px 16px', background: 'var(--surface-low)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--on-surface-2)', display: 'block', marginBottom: 4, fontFamily: 'Manrope, sans-serif', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Date de début</label>
                  <input className="input" type="date" value={congesDateDebut} onChange={e => setCongesDateDebut(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--on-surface-2)', display: 'block', marginBottom: 4, fontFamily: 'Manrope, sans-serif', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Date de fin</label>
                  <input className="input" type="date" value={congesDateFin} onChange={e => setCongesDateFin(e.target.value)} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--on-surface-2)', display: 'block', marginBottom: 4, fontFamily: 'Manrope, sans-serif', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Motif</label>
                <textarea className="input" placeholder="Motif de la demande…" value={congesMotif} onChange={e => setCongesMotif(e.target.value)} style={{ minHeight: 72, resize: 'none' }} />
              </div>
              {congesSent && (
                <p style={{ fontSize: 13, color: 'var(--success)', margin: 0, fontFamily: 'Manrope, sans-serif' }}>Demande envoyée ✓ La messagerie s'ouvre automatiquement.</p>
              )}
              <button className="btn-primary"
                onClick={sendConges}
                disabled={congesLoading || !congesDateDebut || !congesDateFin || !congesMotif}>
                {congesLoading ? 'Envoi…' : 'Envoyer la demande'}
              </button>
              <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: 0, fontFamily: 'Manrope, sans-serif' }}>
                La demande sera envoyée à la direction et enregistrée dans le système.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Section : Accès rapide ── */}
      <div>
        <SectionLabel title="Accès rapide" />
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {user?.role !== 'manager' && (
            <Row label="Pointage" onClick={() => navigate('/pointage')} />
          )}
          {['patron', 'administrateur', 'manager'].includes(user?.role ?? '') && (
            <Row label="Objectifs CA" onClick={() => navigate('/ca')} />
          )}
          {['patron', 'administrateur'].includes(user?.role ?? '') && (
            <Row label="Gérer les utilisateurs" onClick={() => navigate('/admin/users')} />
          )}
        </div>
      </div>

      {/* ── Déconnexion ── */}
      <div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <Row
            label="Se déconnecter"
            danger
            onClick={async () => {
              await auth.signOut()
              window.location.href = '/login'
            }}
          />
        </div>
      </div>

      <div style={{ height: 16 }} />
    </div>
  )
}
