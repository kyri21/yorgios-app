import { Routes, Route, NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import Dashboard from './pages/Dashboard'
import Temperatures from './pages/Temperatures'
import Livraison from './pages/Livraison'
import Hygiene from './pages/Hygiene'
import Vitrine from './pages/Vitrine'
import Ruptures from './pages/Ruptures'
import Controle from './pages/Controle'
import Commandes from './pages/Commandes'
import StockageFrigo from './pages/StockageFrigo'
import PlanningCorner from './pages/PlanningCorner'
import Pertes from './pages/Pertes'
import CA from '../../pages/CA'
import CaptationPage from '../crm/CaptationPage'

const NAV_BASE = [
  { path: '', label: 'Accueil', end: true },
  { path: 'temperatures', label: 'Températures' },
  { path: 'livraison', label: 'Livraison' },
  { path: 'hygiene', label: 'Hygiène' },
  { path: 'vitrine', label: 'Vitrine' },
  { path: 'frigo', label: 'Frigo' },
  { path: 'ruptures', label: 'Ruptures' },
  { path: 'commandes', label: 'Commandes clients' },
  { path: 'controle', label: 'Contrôle' },
  { path: 'pertes', label: 'Pertes' },
  { path: 'planning', label: 'Planning' },
  { path: 'crm', label: 'CRM' },
]

const NAV_MANAGER = [
  ...NAV_BASE,
  { path: 'ca', label: 'CA' },
]

export default function CornerModule() {
  const { user } = useAuth()
  const showCA = ['patron', 'administrateur', 'manager', 'corner'].includes(user?.role ?? '')
  const nav = showCA ? NAV_MANAGER : NAV_BASE

  return (
    <div>
      <nav className="nav-tabs">
        {nav.map(n => (
          <NavLink
            key={n.path}
            to={n.path}
            end={n.end}
            className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}
          >
            {n.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="temperatures" element={<Temperatures />} />
        <Route path="livraison" element={<Livraison />} />
        <Route path="hygiene" element={<Hygiene />} />
        <Route path="vitrine" element={<Vitrine />} />
        <Route path="ruptures" element={<Ruptures />} />
        <Route path="commandes" element={<Commandes />} />
        <Route path="controle" element={<Controle />} />
        <Route path="frigo" element={<StockageFrigo />} />
        {showCA && <Route path="ca" element={<CA />} />}
        <Route path="pertes" element={<Pertes />} />
        <Route path="planning" element={<PlanningCorner />} />
        <Route path="crm" element={<CaptationPage />} />
      </Routes>
    </div>
  )
}
