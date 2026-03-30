import { useEffect, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import ModuleGridPanel from './ModuleGridPanel'
import { signOut } from 'firebase/auth'
import { Timestamp, collection, doc, getDoc, onSnapshot, orderBy, query } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { useAuth } from '../auth/useAuth'
import type { Role } from '../types'
import { useInbox } from '../hooks/useInbox'
import type { InboxItem } from '../hooks/useInbox'
import DailyPointageGate, { shouldShowGate, dismissGate } from './DailyPointageGate'
import { useToastState } from '../hooks/useToast'
import Toast from './Toast'
import { usePointageSortie } from '../hooks/usePointageSortie'

interface NavItem { label: string; path: string; icon: (badge?: number) => React.ReactNode; roles: Role[] }

/* ── Icons ── */
const IconCalendar = () => (
  <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)
const IconChef = () => (
  <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" y1="17" x2="18" y2="17"/>
  </svg>
)
const IconShop = () => (
  <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M3 9l1-5h16l1 5"/><path d="M3 9a2 2 0 0 0 2 2 2 2 0 0 0 2-2 2 2 0 0 0 2 2 2 2 0 0 0 2-2 2 2 0 0 0 2 2 2 2 0 0 0 2-2"/><rect x="5" y="14" width="14" height="7" rx="1"/>
  </svg>
)
const IconChat = ({ badge }: { badge: number }) => (
  <div style={{ position: 'relative', display: 'inline-flex' }}>
    <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
    {badge > 0 && (
      <span style={{
        position: 'absolute', top: -5, right: -6,
        background: '#c0392b', color: '#fff',
        borderRadius: '99px', minWidth: 16, height: 16,
        fontSize: 9, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 3px',
      }}>{badge > 9 ? '9+' : badge}</span>
    )}
  </div>
)
const IconPerson = () => (
  <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
  </svg>
)
const IconBell = ({ badge }: { badge: number }) => (
  <div style={{ position: 'relative', display: 'inline-flex' }}>
    <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
    {badge > 0 && (
      <span style={{
        position: 'absolute', top: -4, right: -5,
        background: '#c0392b', color: '#fff',
        borderRadius: '99px', minWidth: 16, height: 16,
        fontSize: 9, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 3px',
      }}>{badge > 9 ? '9+' : badge}</span>
    )}
  </div>
)
const IconLogout = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
)
const IconClock = () => (
  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
)
const IconSettings = () => (
  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)
const IconGrid9 = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/>
    <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
    <circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
  </svg>
)
const IconChevronRight = () => (
  <svg width="7" height="12" fill="none" viewBox="0 0 7 12">
    <path d="M1 1l5 5-5 5" stroke="rgba(0,66,117,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const IconX = () => (
  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

/* ── Nav items ── */
const NAV_ITEMS: NavItem[] = [
  { label: 'Planning', path: '/planning', icon: () => <IconCalendar />, roles: ['patron', 'administrateur', 'manager', 'corner'] },
  { label: 'Cuisine',  path: '/cuisine',  icon: () => <IconChef />,     roles: ['patron', 'administrateur', 'manager', 'cuisine'] },
  { label: 'Corner',   path: '/corner',   icon: () => <IconShop />,     roles: ['patron', 'administrateur', 'manager', 'corner'] },
  { label: 'Messages', path: '/messages', icon: (b = 0) => <IconChat badge={b} />, roles: ['patron', 'administrateur', 'manager', 'cuisine', 'corner'] },
  { label: 'Profil',   path: '/profile',  icon: () => <IconPerson />,   roles: ['patron', 'administrateur', 'manager', 'cuisine', 'corner'] },
]

const ROLE_LABELS: Record<string, string> = {
  patron: 'Patron', administrateur: 'Admin',
  manager: 'Manager', cuisine: 'Cuisine', corner: 'Corner',
}

function inboxColor(type: InboxItem['type']): string {
  if (type === 'commande') return '#004275'
  if (type === 'temperature') return '#880014'
  return '#54651e'
}
function inboxEmoji(type: InboxItem['type']): string {
  if (type === 'commande') return '📬'
  if (type === 'temperature') return '🌡️'
  return '⏰'
}

/* ── Sidebar item style ── */
function sidebarItemStyle(isActive: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 12px', borderRadius: 10, marginBottom: 2,
    fontSize: 14, fontWeight: isActive ? 600 : 500,
    fontFamily: 'Manrope, sans-serif',
    textDecoration: 'none',
    cursor: 'pointer', transition: 'background 0.1s ease, color 0.1s ease',
    color: isActive ? '#004275' : '#5a5a55',
    background: isActive ? 'rgba(0, 66, 117, 0.08)' : 'transparent',
    letterSpacing: '-0.01em',
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [unread, setUnread] = useState(0)
  const [showInbox, setShowInbox] = useState(false)
  const [showGate, setShowGate] = useState(false)
  const [moduleGrid, setModuleGrid] = useState<'corner' | 'cuisine' | null>(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const { toast, setToast } = useToastState()
  const { canPointer, status: sortieStatus, errorMsg: sortieError, doPointageSortie, setStatus: setSortieStatus } = usePointageSortie()
  const [showSortieModal, setShowSortieModal] = useState(false)

  useEffect(() => {
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const isOnCorner  = location.pathname.startsWith('/corner')
  const isOnCuisine = location.pathname.startsWith('/cuisine')

  const { items: inboxItems, count: inboxCount, dismissItem } = useInbox(user)

  useEffect(() => {
    if (!user) return
    if (shouldShowGate(user.role)) setShowGate(true)
  }, [user?.uid, user?.role])

  useEffect(() => {
    if (!user?.uid) return
    let lastRead = Timestamp.fromMillis(0)
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      if (snap.exists() && snap.data()?.lastReadMessages) {
        lastRead = snap.data()!.lastReadMessages as Timestamp
      }
      const q = query(collection(db, 'messages'), orderBy('createdAt', 'desc'))
      const unsub = onSnapshot(q, snap => {
        const count = snap.docs.filter(d => {
          const data = d.data() as any
          return data.senderId !== user.uid
            && data.createdAt?.toMillis
            && data.createdAt.toMillis() > lastRead.toMillis()
        }).length
        setUnread(count)
      })
      return unsub
    })
  }, [user?.uid])

  const visibleItems = NAV_ITEMS.filter(item => user && item.roles.includes(user.role))

  async function handleLogout() {
    dismissGate()
    await signOut(auth)
    navigate('/login')
  }

  const initials = (user?.displayName || user?.email || '?')
    .split(/[\s@]/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('')

  const isAdmin = user && ['patron', 'administrateur'].includes(user.role)
  const isSuperUser = user && ['patron', 'administrateur', 'manager'].includes(user.role)

  return (
    <>
      {showGate && <DailyPointageGate onDismiss={() => setShowGate(false)} />}

      {/* ── Bandeau hors-ligne ── */}
      {!isOnline && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 400,
          background: '#b45309', color: '#fff',
          fontSize: 13, fontWeight: 600,
          fontFamily: 'Manrope, sans-serif',
          padding: '8px 16px',
          textAlign: 'center',
        }}>
          Hors-ligne — données synchronisées à la reconnexion
        </div>
      )}

      <div style={{ display: 'flex', minHeight: '100dvh', background: 'var(--surface)' }}>

        {/* ── Desktop sidebar ── */}
        <aside className="hidden md:flex" style={{
          width: 220, flexShrink: 0, flexDirection: 'column',
          background: '#fff',
          borderRight: '1px solid var(--border-soft)',
          position: 'sticky', top: 0, height: '100dvh', overflow: 'hidden',
          boxShadow: '1px 0 20px rgba(28,28,24,0.04)',
        }}>
          {/* Logo */}
          <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid var(--border-soft)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
                <img src="/icons/icon-192.png" alt="Matias" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div>
                <div style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 15, fontWeight: 700, color: '#004275', letterSpacing: '-0.02em' }}>Matias</div>
                <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 11, color: 'var(--on-surface-3)', marginTop: 1 }}>Espace de travail</div>
              </div>
              <button onClick={() => setShowInbox(v => !v)} style={{
                marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                color: inboxCount > 0 ? '#c0392b' : 'var(--on-surface-3)',
              }}>
                <IconBell badge={inboxCount} />
              </button>
            </div>
          </div>

          {/* Nav principale */}
          <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto' }}>
            {visibleItems.map(item => {
              const isMsg = item.path === '/messages'
              return (
                <NavLink key={item.path} to={item.path}
                  style={({ isActive }) => sidebarItemStyle(isActive)}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLElement
                    if (el.getAttribute('aria-current') !== 'page') {
                      el.style.background = 'var(--surface-low)'
                      el.style.color = 'var(--on-surface)'
                    }
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLElement
                    const active = el.getAttribute('aria-current') === 'page'
                    el.style.background = active ? 'rgba(0,66,117,0.08)' : 'transparent'
                    el.style.color = active ? '#004275' : '#5a5a55'
                  }}
                >
                  <span style={{ display: 'flex', flexShrink: 0 }}>
                    {isMsg ? item.icon(unread) : item.icon()}
                  </span>
                  <span>{item.label}</span>
                  {isMsg && unread > 0 && (
                    <span style={{ marginLeft: 'auto', background: '#c0392b', color: '#fff', borderRadius: 99, minWidth: 18, height: 18, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </NavLink>
              )
            })}
          </nav>

          {/* Liens secondaires */}
          <div style={{ padding: '0 8px 4px', borderTop: '1px solid var(--border-soft)', paddingTop: 8 }}>
            {isSuperUser && (
              <NavLink to="/admin/pointages"
                style={({ isActive }) => sidebarItemStyle(isActive)}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-low)'; (e.currentTarget as HTMLElement).style.color = 'var(--on-surface)' }}
                onMouseLeave={e => { const a = (e.currentTarget as HTMLElement).getAttribute('aria-current') === 'page'; (e.currentTarget as HTMLElement).style.background = a ? 'rgba(0,66,117,0.08)' : 'transparent'; (e.currentTarget as HTMLElement).style.color = a ? '#004275' : '#5a5a55' }}
              >
                <span style={{ display: 'flex', flexShrink: 0 }}><IconClock /></span>
                <span>Pointages</span>
              </NavLink>
            )}
            {isSuperUser && (
              <NavLink to="/admin/allergenes"
                style={({ isActive }) => sidebarItemStyle(isActive)}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-low)'; (e.currentTarget as HTMLElement).style.color = 'var(--on-surface)' }}
                onMouseLeave={e => { const a = (e.currentTarget as HTMLElement).getAttribute('aria-current') === 'page'; (e.currentTarget as HTMLElement).style.background = a ? 'rgba(0,66,117,0.08)' : 'transparent'; (e.currentTarget as HTMLElement).style.color = a ? '#004275' : '#5a5a55' }}
              >
                <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
                <span>Allergènes</span>
              </NavLink>
            )}
            {isAdmin && (
              <NavLink to="/admin/settings"
                style={({ isActive }) => sidebarItemStyle(isActive)}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-low)'; (e.currentTarget as HTMLElement).style.color = 'var(--on-surface)' }}
                onMouseLeave={e => { const a = (e.currentTarget as HTMLElement).getAttribute('aria-current') === 'page'; (e.currentTarget as HTMLElement).style.background = a ? 'rgba(0,66,117,0.08)' : 'transparent'; (e.currentTarget as HTMLElement).style.color = a ? '#004275' : '#5a5a55' }}
              >
                <span style={{ display: 'flex', flexShrink: 0 }}><IconSettings /></span>
                <span>Paramètres</span>
              </NavLink>
            )}
          </div>

          {/* User footer */}
          <div style={{ padding: '10px 8px 16px', borderTop: '1px solid var(--border-soft)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', marginBottom: 4 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8, background: '#004275',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'Manrope, sans-serif', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
              }}>{initials}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 600, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user?.displayName || user?.email?.split('@')[0]}
                </div>
                <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 11, color: 'var(--on-surface-3)', marginTop: 1 }}>
                  {ROLE_LABELS[user?.role || ''] || user?.role}
                </div>
              </div>
            </div>
            <button onClick={handleLogout}
              style={{ ...sidebarItemStyle(false), width: '100%', border: 'none', background: 'transparent', color: 'var(--on-surface-3)', fontSize: 13 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(192,57,43,0.08)'; (e.currentTarget as HTMLElement).style.color = '#c0392b' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--on-surface-3)' }}
            >
              <IconLogout />
              Déconnexion
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: '100dvh' }}>

          {/* Mobile top bar */}
          <header className="md:hidden glass" style={{
            borderBottom: '1px solid var(--border-soft)',
            color: 'var(--on-surface)', padding: '0 16px', height: 52,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            position: 'sticky', top: 0, zIndex: 40, flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 26, height: 26, borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
                <img src="/icons/icon-192.png" alt="Matias" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <span style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em', color: '#004275' }}>Matias</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {/* Bouton sortie */}
              {canPointer && (
                <button onClick={() => setShowSortieModal(true)} style={{
                  background: '#c0392b', border: 'none', borderRadius: 10,
                  padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                  boxShadow: '0 2px 10px rgba(192,57,43,0.3)',
                  animation: 'sortie-pulse 2s ease-in-out infinite',
                }}>
                  <svg width="14" height="14" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                  <span style={{ fontFamily: 'Manrope, sans-serif', fontSize: 12, fontWeight: 700, color: '#fff' }}>Sortie</span>
                </button>
              )}
              {/* Paramètres — admin uniquement, mobile */}
              {isAdmin && (
                <button onClick={() => navigate('/admin/settings')} style={{
                  background: location.pathname === '/admin/settings' ? 'rgba(0,66,117,0.1)' : 'var(--surface-low)',
                  border: 'none', borderRadius: 8, padding: '6px 8px', cursor: 'pointer',
                  color: location.pathname === '/admin/settings' ? '#004275' : 'var(--on-surface-2)',
                  display: 'flex', alignItems: 'center',
                }}>
                  <IconSettings />
                </button>
              )}
              {/* Inbox */}
              <button onClick={() => setShowInbox(v => !v)} style={{
                background: 'var(--surface-low)', border: 'none', borderRadius: 8,
                padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                color: inboxCount > 0 ? '#c0392b' : 'var(--on-surface-2)',
              }}>
                <IconBell badge={inboxCount} />
              </button>
              {/* Logout */}
              <button onClick={handleLogout} style={{
                background: 'var(--surface-low)', border: 'none',
                color: 'var(--on-surface-2)', borderRadius: 8, padding: '6px 8px',
                cursor: 'pointer', display: 'flex',
              }}>
                <IconLogout />
              </button>
            </div>
          </header>

          {/* Page content */}
          <main style={{ flex: 1, overflowY: 'auto', paddingBottom: 'calc(var(--nav-h) + var(--safe-bottom))' }}
            className="md:pb-0">
            {children}
          </main>
        </div>

        {/* ── Mobile bottom nav ── */}
        {visibleItems.length >= 1 && (
          <nav className="md:hidden bottom-nav glass" style={{
            position: 'fixed', bottom: 0, left: 0, right: 0,
            borderTop: '1px solid var(--border-soft)',
            display: 'flex', zIndex: 50, height: 'var(--nav-h)',
          }}>
            {visibleItems.map(item => {
              const isMsg     = item.path === '/messages'
              const isCorner  = item.path === '/corner'
              const isCuisine = item.path === '/cuisine'
              const isModuleItem = isCorner || isCuisine
              const moduleKey = isCorner ? 'corner' : 'cuisine'
              const isModuleActive = isCorner ? isOnCorner : isCuisine ? isOnCuisine : false

              if (isModuleItem) {
                return (
                  <button
                    key={item.path}
                    onClick={() => {
                      if (isModuleActive) {
                        setModuleGrid(prev => prev === moduleKey ? null : moduleKey)
                      } else {
                        navigate(item.path)
                        setModuleGrid(null)
                      }
                    }}
                    className="bottom-nav-item"
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      gap: 3, border: 'none', background: 'none', cursor: 'pointer',
                      color: isModuleActive ? '#004275' : 'var(--on-surface-3)',
                      fontFamily: 'Manrope, sans-serif', fontSize: 10, fontWeight: 600,
                      position: 'relative', paddingBottom: 'var(--safe-bottom)',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    {isModuleActive && (
                      <span style={{
                        position: 'absolute', top: 0, left: '20%', right: '20%',
                        height: 2, borderRadius: '0 0 3px 3px', background: '#004275',
                      }} />
                    )}
                    <span style={{ display: 'flex' }}>
                      {isModuleActive ? <IconGrid9 /> : item.icon()}
                    </span>
                    {item.label}
                  </button>
                )
              }

              return (
                <NavLink key={item.path} to={item.path}
                  onClick={() => setModuleGrid(null)}
                  className="bottom-nav-item"
                  style={({ isActive }) => ({
                    flex: 1, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    gap: 3,
                    color: isActive ? '#004275' : 'var(--on-surface-3)',
                    textDecoration: 'none',
                    fontFamily: 'Manrope, sans-serif', fontSize: 10, fontWeight: 600,
                    transition: 'color 0.1s ease', position: 'relative',
                    paddingBottom: 'var(--safe-bottom)',
                  })}>
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span style={{
                          position: 'absolute', top: 0, left: '20%', right: '20%',
                          height: 2, borderRadius: '0 0 3px 3px', background: '#004275',
                        }} />
                      )}
                      <span style={{ display: 'flex' }}>
                        {isMsg ? item.icon(unread) : item.icon()}
                      </span>
                      {item.label}
                    </>
                  )}
                </NavLink>
              )
            })}
          </nav>
        )}
      </div>

      {/* ── Modal confirmation sortie ── */}
      {showSortieModal && (
        <>
          <div
            onClick={() => { setShowSortieModal(false); setSortieStatus('idle') }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(28,28,24,0.5)', zIndex: 200, backdropFilter: 'blur(4px)' }}
          />
          <div className="animate-sheet-in" style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 201,
            background: '#fff', borderRadius: '20px 20px 0 0',
            padding: '28px 24px calc(28px + var(--safe-bottom))',
            boxShadow: 'var(--shadow-float)',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🏁</div>
              <div style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 20, fontWeight: 700, color: 'var(--on-surface)', marginBottom: 6 }}>Pointer mon départ</div>
              <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, color: 'var(--on-surface-2)' }}>
                {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} — votre position GPS sera vérifiée
              </div>
            </div>

            {sortieStatus === 'error' && sortieError && (
              <div style={{
                padding: '12px 16px', background: 'rgba(192,57,43,0.08)',
                borderRadius: 12, fontFamily: 'Manrope, sans-serif',
                fontSize: 13, color: '#c0392b', marginBottom: 16, textAlign: 'center',
              }}>
                ⚠️ {sortieError}
              </div>
            )}

            {sortieStatus === 'success' ? (
              <div style={{
                padding: '16px', background: 'rgba(45, 122, 79, 0.1)',
                borderRadius: 14, fontFamily: 'Manrope, sans-serif',
                fontSize: 15, color: '#2d7a4f', fontWeight: 700, textAlign: 'center', marginBottom: 16,
              }}>
                ✅ Départ enregistré !
              </div>
            ) : (
              <button
                onClick={async () => {
                  const result = await doPointageSortie()
                  if (result === 'success') setTimeout(() => setShowSortieModal(false), 1500)
                }}
                disabled={sortieStatus === 'loading'}
                style={{
                  width: '100%', height: 54,
                  background: sortieStatus === 'loading'
                    ? 'rgba(192,57,43,0.4)'
                    : 'linear-gradient(135deg, #880014 0%, #c0392b 100%)',
                  border: 'none', borderRadius: 14,
                  fontFamily: 'Manrope, sans-serif', fontSize: 15, fontWeight: 700, color: '#fff',
                  cursor: sortieStatus === 'loading' ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  marginBottom: 12,
                }}
              >
                {sortieStatus === 'loading' ? (
                  <>
                    <span className="spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} />
                    Localisation…
                  </>
                ) : 'Confirmer mon départ'}
              </button>
            )}

            <button
              onClick={() => { setShowSortieModal(false); setSortieStatus('idle') }}
              style={{
                width: '100%', height: 46,
                background: 'var(--surface-low)', border: 'none',
                borderRadius: 14, fontFamily: 'Manrope, sans-serif',
                fontSize: 14, fontWeight: 600, color: 'var(--on-surface-2)',
                cursor: 'pointer',
              }}
            >
              Annuler
            </button>
          </div>
        </>
      )}

      <style>{`
        @keyframes sortie-pulse {
          0%, 100% { box-shadow: 0 4px 20px rgba(192,57,43,0.35); transform: scale(1); }
          50% { box-shadow: 0 4px 28px rgba(192,57,43,0.55); transform: scale(1.05); }
        }
      `}</style>

      <Toast toast={toast} setToast={setToast} />

      {/* ── Module grid panel ── */}
      {moduleGrid && user && (
        <ModuleGridPanel
          module={moduleGrid}
          userRole={user.role}
          onClose={() => setModuleGrid(null)}
        />
      )}

      {/* ── Inbox panel ── */}
      {showInbox && (
        <>
          <div
            onClick={() => setShowInbox(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(28,28,24,0.4)', zIndex: 200, backdropFilter: 'blur(4px)' }}
          />
          <div className="animate-sheet-in md:top-0 md:bottom-auto md:left-auto md:right-0 md:w-96 md:h-screen md:rounded-none md:border-l" style={{
            position: 'fixed', bottom: 0, left: 0, right: 0,
            background: '#fff',
            borderRadius: '20px 20px 0 0',
            zIndex: 201,
            maxHeight: '80vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: 'var(--shadow-float)',
          }}>

            <div style={{ padding: '12px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div className="md:hidden" style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto' }} />
            </div>

            <div style={{ padding: '12px 20px 12px', borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 18, fontWeight: 700, color: 'var(--on-surface)' }}>
                Notifications
                {inboxCount > 0 && (
                  <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--on-surface-3)', fontWeight: 400 }}>{inboxCount}</span>
                )}
              </div>
              <button onClick={() => setShowInbox(false)} style={{ background: 'var(--surface-low)', border: 'none', color: 'var(--on-surface-2)', borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <IconX />
              </button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
              {inboxItems.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif', fontSize: 14 }}>
                  Aucune notification pour le moment
                </div>
              ) : (
                inboxItems.map(item => (
                  <div key={item.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: '14px 20px',
                    borderBottom: '1px solid var(--border-soft)',
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: `${inboxColor(item.type)}14`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 16, flexShrink: 0,
                    }}>
                      {inboxEmoji(item.type)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: 'var(--on-surface)', marginBottom: 2 }}>{item.title}</div>
                      <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 13, color: 'var(--on-surface-2)', lineHeight: 1.4 }}>{item.body}</div>
                      {item.link && (
                        <button onClick={() => { navigate(item.link!); setShowInbox(false) }} style={{
                          marginTop: 8, background: 'none', border: 'none', padding: 0,
                          color: '#004275', fontFamily: 'Manrope, sans-serif', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                          Voir <IconChevronRight />
                        </button>
                      )}
                    </div>
                    <button onClick={() => dismissItem(item.id)} style={{
                      background: 'none', border: 'none', color: 'var(--on-surface-3)',
                      cursor: 'pointer', padding: 4, flexShrink: 0,
                    }}>
                      <IconX />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
