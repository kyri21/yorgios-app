import { useState, useEffect } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import type { UserProfile } from '../types';

interface AuthState {
  user:    UserProfile | null;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser: User | null) => {
      if (!firebaseUser) {
        setState({ user: null, loading: false });
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (snap.exists()) {
          const data = snap.data();
          setState({
            user: {
              uid:         firebaseUser.uid,
              email:       firebaseUser.email ?? '',
              role:        data.role,
              displayName: data.displayName ?? firebaseUser.displayName ?? '',
            },
            loading: false,
          });
        } else {
          // Utilisateur Firebase sans profil Firestore → pas d'accès
          setState({ user: null, loading: false });
        }
      } catch {
        setState({ user: null, loading: false });
      }
    });
    return unsub;
  }, []);

  return state;
}
