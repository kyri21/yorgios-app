import { NavLink, Route, Routes } from "react-router-dom";
import CuisineDashboard from "./pages/Dashboard";
import Reception from "./pages/Reception";
import Fabrication from "./pages/Fabrication";
import Livraisons from "./pages/Livraisons";
import Temperatures from "./pages/Temperatures";
import Controle from "./pages/Controle";
import ReceptionHistorique from "./pages/ReceptionHistorique";
import CaptationPage from "../crm/CaptationPage";

const NAV = [
  { path: '', label: 'Accueil', end: true },
  { path: 'reception', label: 'Réception' },
  { path: 'fabrication', label: 'Fabrication' },
  { path: 'livraisons', label: 'Livraisons' },
  { path: 'temperatures', label: 'Températures' },
  { path: 'controle', label: 'Contrôle' },
  { path: 'crm', label: 'CRM' },
]

export default function CuisineModule() {
  return (
    <div>
      <nav className="nav-tabs">
        {NAV.map(n => (
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
        <Route index element={<CuisineDashboard />} />
        <Route path="reception" element={<Reception />} />
        <Route path="fabrication" element={<Fabrication />} />
        <Route path="livraisons" element={<Livraisons />} />
        <Route path="temperatures" element={<Temperatures />} />
        <Route path="controle" element={<Controle />} />
        <Route path="reception-historique" element={<ReceptionHistorique />} />
        <Route path="crm" element={<CaptationPage />} />
      </Routes>
    </div>
  );
}
