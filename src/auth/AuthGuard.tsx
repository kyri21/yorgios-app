import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import type { Role } from '../types';
import { useAuth } from './useAuth';
import { db } from '../firebase/config';
import LoadingScreen from '../components/LoadingScreen';
import GdprConsentModal from '../components/GdprConsentModal';

interface Props {
  allowedRoles: Role[];
  children: React.ReactNode;
}

/**
 * Protège une route :
 * - Si non connecté  → redirige vers /login
 * - Si rôle non autorisé → redirige vers la page d'accueil du rôle
 * - Si consentement RGPD non donné → affiche le modal bloquant
 * - Sinon → affiche les children
 */
export default function AuthGuard({ allowedRoles, children }: Props) {
  const { user, loading } = useAuth();
  const [gdprChecked, setGdprChecked] = useState(false);
  const [showGdpr, setShowGdpr]       = useState(false);

  useEffect(() => {
    if (!user) {
      setGdprChecked(false);
      setShowGdpr(false);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      if (cancelled) return;
      const data = snap.data();
      if (!data?.gdprConsentAt) {
        setShowGdpr(true);
      }
      setGdprChecked(true);
    }).catch(() => {
      if (!cancelled) setGdprChecked(true);
    });
    return () => { cancelled = true; };
  }, [user]);

  if (loading) return <LoadingScreen />;
  if (!user)   return <Navigate to="/login" replace />;

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={getRoleHome(user.role)} replace />;
  }

  // En attente de la vérification RGPD
  if (!gdprChecked) return <LoadingScreen />;

  async function handleGdprAccept() {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), {
      gdprConsentAt: serverTimestamp(),
    });
    setShowGdpr(false);
  }

  return (
    <>
      {showGdpr && <GdprConsentModal onAccept={handleGdprAccept} />}
      {children}
    </>
  );
}

export function getRoleHome(role: Role): string {
  switch (role) {
    case 'patron':         return '/planning';
    case 'administrateur': return '/planning';
    case 'manager':        return '/planning';
    case 'corner':         return '/corner';
    case 'cuisine':        return '/cuisine';
  }
}
