import { useLocation, useNavigate } from 'react-router-dom'
import type { Role } from '../types'

// ── Types ──────────────────────────────────────────────────────────────────────
interface GridItem {
  path: string
  label: string
  icon: React.ReactNode
  color: string
  end?: boolean
  roles?: Role[]
}

interface Props {
  module: 'corner' | 'cuisine'
  userRole: Role
  onClose: () => void
}

// ── Icônes SVG ─────────────────────────────────────────────────────────────────
const I = (d: string, extra?: string) => (
  <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" {...(extra ? { style: { opacity: 0.95 } } : {})}>
    <path d={d} />
  </svg>
)

const IconDashboard = () => (
  <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
  </svg>
)
const IconThermo = () => (
  <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>
  </svg>
)
const IconTruck = () => (
  <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <rect x="1" y="3" width="15" height="13" rx="1"/>
    <path d="M16 8h4l3 3v5h-7V8z"/>
    <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
  </svg>
)
const IconHygiene = () => (
  <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M9 11l3 3L22 4"/>
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
  </svg>
)
const IconVitrine = () => (
  <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <rect x="2" y="3" width="20" height="14" rx="2"/>
    <path d="M8 21h8M12 17v4"/>
  </svg>
)
const IconSnowflake = () => (
  <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <line x1="12" y1="2" x2="12" y2="22"/>
    <path d="M17 7l-5 5-5-5M17 17l-5-5-5 5"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M7 7l5 5 5-5M7 17l5-5 5 5"/>
  </svg>
)
const IconAlert = () => (
  <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
)
const IconClipboard = () => (
  <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
    <rect x="8" y="2" width="8" height="4" rx="1"/>
    <line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/>
  </svg>
)
const IconShield = () => (
  <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    <path d="M9 12l2 2 4-4"/>
  </svg>
)
const IconChart = () => (
  <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <line x1="18" y1="20" x2="18" y2="10"/>
    <line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
    <line x1="2" y1="20" x2="22" y2="20"/>
  </svg>
)
const IconPackage = () => (
  <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
    <line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
)
const IconGear = () => (
  <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)
const IconCalendar = () => (
  <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)
const IconCRM = () => (
  <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <line x1="19" y1="8" x2="19" y2="14"/>
    <line x1="22" y1="11" x2="16" y2="11"/>
  </svg>
)
const IconX = () => (
  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)
const IconPhoto = () => (
  <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>
)
const IconPertes = () => (
  <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)

// ── Configs grilles ────────────────────────────────────────────────────────────
const CORNER_ITEMS: GridItem[] = [
  { path: '/corner',              label: 'Dashboard',   color: '#007AFF', icon: <IconDashboard />, end: true },
  { path: '/corner/temperatures', label: 'Températures',color: '#FF3B30', icon: <IconThermo /> },
  { path: '/corner/livraison',    label: 'Livraison',   color: '#34C759', icon: <IconTruck /> },
  { path: '/corner/hygiene',      label: 'Hygiène',     color: '#FFCC00', icon: <IconHygiene /> },
  { path: '/corner/vitrine',      label: 'Vitrine',     color: '#AF52DE', icon: <IconVitrine /> },
  { path: '/corner/frigo',        label: 'Frigo',       color: '#5AC8FA', icon: <IconSnowflake /> },
  { path: '/corner/ruptures',     label: 'Ruptures',    color: '#FF9500', icon: <IconAlert /> },
  { path: '/corner/commandes',    label: 'Commandes clients', color: '#FF2D55', icon: <IconClipboard /> },
  { path: '/corner/controle',     label: 'Contrôle',    color: '#30B0C7', icon: <IconShield /> },
  { path: '/corner/pertes',       label: 'Pertes',      color: '#FF6B35', icon: <IconPertes /> },
  { path: '/livraisons',          label: 'Coursier',    color: '#FF9500', icon: <IconTruck /> },
  { path: '/corner/ca',           label: 'CA',          color: '#30D158', icon: <IconChart />, roles: ['patron', 'administrateur', 'manager'] },
  { path: '/corner/planning',     label: 'Planning',    color: '#5E5CE6', icon: <IconCalendar /> },
  { path: '/crm/captation',       label: 'CRM',         color: '#FF6B35', icon: <IconCRM /> },
]

const CUISINE_ITEMS: GridItem[] = [
  { path: '/cuisine',              label: 'Réception',   color: '#007AFF', icon: <IconPackage />, end: true },
  { path: '/cuisine/fabrication',  label: 'Fabrication', color: '#FF9500', icon: <IconGear /> },
  { path: '/cuisine/livraisons',   label: 'Livraisons',  color: '#34C759', icon: <IconTruck /> },
  { path: '/cuisine/temperatures', label: 'Températures',color: '#FF3B30', icon: <IconThermo /> },
  { path: '/cuisine/controle',     label: 'Contrôle',    color: '#AF52DE', icon: <IconShield /> },
  { path: '/livraisons',          label: 'Coursier',    color: '#FF9500', icon: <IconTruck /> },
  { path: '/cuisine/reception-historique', label: 'Photos réception', color: '#5AC8FA', icon: <IconPhoto /> },
  { path: '/crm/captation',        label: 'CRM',         color: '#FF6B35', icon: <IconCRM /> },
]

// ── Composant ─────────────────────────────────────────────────────────────────
export default function ModuleGridPanel({ module, userRole, onClose }: Props) {
  const location = useLocation()
  const navigate = useNavigate()

  const allItems = module === 'corner' ? CORNER_ITEMS : CUISINE_ITEMS
  const items = allItems.filter(item => !item.roles || item.roles.includes(userRole))

  function isActive(item: GridItem) {
    if (item.end) return location.pathname === item.path
    return location.pathname.startsWith(item.path)
  }

  function handleNav(path: string) {
    navigate(path)
    onClose()
  }

  const title = module === 'corner' ? 'Corner' : 'Cuisine'

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(28,28,24,0.45)',
          zIndex: 300,
          backdropFilter: 'blur(4px)',
        }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed',
        bottom: 0, left: 0, right: 0,
        background: 'rgba(252,249,243,0.97)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: '24px 24px 0 0',
        zIndex: 301,
        padding: '0 0 calc(var(--nav-h) + var(--safe-bottom) + 8px)',
        boxShadow: '0 -4px 32px rgba(28,28,24,0.10)',
      }}
        className="md:left-[220px]"
      >
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(28,28,24,0.15)' }} />
        </div>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px 18px',
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--on-surface)', letterSpacing: '-0.02em', fontFamily: 'Epilogue, sans-serif' }}>
            {title}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(28,28,24,0.07)', border: 'none', borderRadius: 10,
              width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'var(--on-surface-2)',
            }}
          >
            <IconX />
          </button>
        </div>

        {/* Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          padding: '0 20px',
        }}>
          {items.map(item => {
            const active = isActive(item)
            return (
              <button
                key={item.path}
                onClick={() => handleNav(item.path)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  padding: '14px 8px 12px',
                  background: active ? 'rgba(0,66,117,0.08)' : 'rgba(28,28,24,0.03)',
                  border: `1.5px solid ${active ? 'rgba(0,66,117,0.25)' : 'transparent'}`,
                  borderRadius: 16,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {/* Icon */}
                <div style={{
                  width: 52, height: 52, borderRadius: 14,
                  background: item.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: active ? `0 4px 16px ${item.color}55` : '0 2px 8px rgba(28,28,24,0.10)',
                  transition: 'box-shadow 0.15s ease',
                }}>
                  {item.icon}
                </div>
                {/* Label */}
                <span style={{
                  fontSize: 11, fontWeight: active ? 700 : 500,
                  color: active ? 'var(--primary)' : 'var(--on-surface-2)',
                  letterSpacing: '-0.01em', textAlign: 'center', lineHeight: 1.2,
                  fontFamily: 'Manrope, sans-serif',
                }}>
                  {item.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
