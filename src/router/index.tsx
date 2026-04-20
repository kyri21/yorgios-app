import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AuthGuard, { getRoleHome } from '../auth/AuthGuard';
import { useAuth } from '../auth/useAuth';
import LoadingScreen from '../components/LoadingScreen';
import Layout from '../components/Layout';
import Login from '../pages/Login';
import CommandePublique from '../pages/CommandePublique';
import Rgpd from '../pages/Rgpd';

// Lazy loading — chaque module est chargé uniquement à la première visite
const PlanningModule  = lazy(() => import('../modules/planning'));
const CuisineModule   = lazy(() => import('../modules/cuisine'));
const CornerModule    = lazy(() => import('../modules/corner'));
const Messagerie      = lazy(() => import('../modules/messagerie'));
const CA              = lazy(() => import('../pages/CA'));
const AdminUsers      = lazy(() => import('../pages/AdminUsers'));
const Pointage        = lazy(() => import('../pages/Pointage'));
const Profile         = lazy(() => import('../pages/Profile'));
const AdminSettings   = lazy(() => import('../pages/AdminSettings'));
const AdminPointages  = lazy(() => import('../pages/AdminPointages'));
const AdminProduits   = lazy(() => import('../pages/AdminProduits'));
const AllergeneMenu   = lazy(() => import('../pages/AllergeneMenu'));
const CaptationPage   = lazy(() => import('../modules/crm/CaptationPage'));
const Livraisons      = lazy(() => import('../pages/Livraisons'))
const Commandes       = lazy(() => import('../modules/corner/pages/Commandes'));

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user)   return <Navigate to="/login" replace />;
  return <Navigate to={getRoleHome(user.role)} replace />;
}

// Rôles complets (patron + administrateur = mêmes droits)
const FULL_ACCESS: import('../types').Role[] = ['patron', 'administrateur', 'manager']

export default function AppRouter() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        {/* Public — formulaire commande client (sans auth) */}
        <Route path="/commande" element={<CommandePublique />} />

        {/* Public */}
        <Route path="/login" element={<Login />} />
        <Route path="/rgpd" element={<Rgpd />} />

        {/* Racine → redirection par rôle */}
        <Route path="/" element={<RootRedirect />} />

        {/* Planning — patron + admin + manager + corner (lecture) */}
        <Route
          path="/planning/*"
          element={
            <AuthGuard allowedRoles={['patron', 'administrateur', 'manager', 'corner']}>
              <Layout><PlanningModule /></Layout>
            </AuthGuard>
          }
        />

        {/* Cuisine — patron + admin + manager + cuisine */}
        <Route
          path="/cuisine/*"
          element={
            <AuthGuard allowedRoles={['patron', 'administrateur', 'manager', 'cuisine']}>
              <Layout><CuisineModule /></Layout>
            </AuthGuard>
          }
        />

        {/* Corner — patron + admin + manager + corner */}
        <Route
          path="/corner/*"
          element={
            <AuthGuard allowedRoles={['patron', 'administrateur', 'manager', 'corner']}>
              <Layout><CornerModule /></Layout>
            </AuthGuard>
          }
        />

        {/* CA — tous les rôles (corner + cuisine = lecture seule) */}
        <Route
          path="/ca"
          element={
            <AuthGuard allowedRoles={['patron', 'administrateur', 'manager', 'corner', 'cuisine']}>
              <Layout><CA /></Layout>
            </AuthGuard>
          }
        />

        {/* Messagerie — tous les rôles */}
        <Route
          path="/messages"
          element={
            <AuthGuard allowedRoles={['patron', 'administrateur', 'manager', 'cuisine', 'corner']}>
              <Layout><Messagerie /></Layout>
            </AuthGuard>
          }
        />

        {/* Pointage — tous sauf manager */}
        <Route
          path="/pointage"
          element={
            <AuthGuard allowedRoles={['patron', 'administrateur', 'cuisine', 'corner']}>
              <Layout><Pointage /></Layout>
            </AuthGuard>
          }
        />

        {/* Admin utilisateurs — patron + administrateur */}
        <Route
          path="/admin/users"
          element={
            <AuthGuard allowedRoles={['patron', 'administrateur']}>
              <Layout><AdminUsers /></Layout>
            </AuthGuard>
          }
        />

        {/* Relevés de pointage — patron + admin + manager */}
        <Route
          path="/admin/pointages"
          element={
            <AuthGuard allowedRoles={['patron', 'administrateur', 'manager']}>
              <Layout><AdminPointages /></Layout>
            </AuthGuard>
          }
        />

        {/* Admin paramètres — patron + administrateur */}
        <Route
          path="/admin/settings"
          element={
            <AuthGuard allowedRoles={['patron', 'administrateur']}>
              <Layout><AdminSettings /></Layout>
            </AuthGuard>
          }
        />

        {/* Admin produits — patron + administrateur */}
        <Route
          path="/admin/produits"
          element={
            <AuthGuard allowedRoles={['patron', 'administrateur']}>
              <Layout><AdminProduits /></Layout>
            </AuthGuard>
          }
        />

        {/* Fiche allergènes — tous les rôles (info utile pour tous les employés) */}
        <Route
          path="/admin/allergenes"
          element={
            <AuthGuard allowedRoles={['patron', 'administrateur', 'manager', 'corner', 'cuisine']}>
              <Layout><AllergeneMenu /></Layout>
            </AuthGuard>
          }
        />

        {/* Profil — tous les rôles */}
        <Route
          path="/profile"
          element={
            <AuthGuard allowedRoles={['patron', 'administrateur', 'manager', 'cuisine', 'corner']}>
              <Layout><Profile /></Layout>
            </AuthGuard>
          }
        />

        {/* Livraisons coursier — tous les rôles */}
        <Route
          path="/livraisons"
          element={
            <AuthGuard allowedRoles={['patron', 'administrateur', 'manager', 'cuisine', 'corner']}>
              <Layout><Livraisons /></Layout>
            </AuthGuard>
          }
        />

        {/* Commandes clients — tous les rôles */}
        <Route
          path="/commandes"
          element={
            <AuthGuard allowedRoles={['patron', 'administrateur', 'manager', 'cuisine', 'corner']}>
              <Layout><Commandes /></Layout>
            </AuthGuard>
          }
        />

        {/* CRM Captation — patron + admin + manager + corner + cuisine */}
        <Route
          path="/crm/captation"
          element={
            <AuthGuard allowedRoles={['patron', 'administrateur', 'manager', 'corner', 'cuisine']}>
              <Layout><CaptationPage /></Layout>
            </AuthGuard>
          }
        />

        {/* 404 */}
        <Route path="*" element={
          <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-low)' }}>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 64, marginBottom: 16 }}>🔍</p>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--on-surface)', marginBottom: 8, fontFamily: 'Epilogue, sans-serif' }}>Page introuvable</h1>
              <a href="/" style={{ color: 'var(--primary)', textDecoration: 'underline', fontFamily: 'Manrope, sans-serif' }}>Retour à l'accueil</a>
            </div>
          </div>
        } />
      </Routes>
    </Suspense>
  );
}
