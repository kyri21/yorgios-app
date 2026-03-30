import { createContext, useContext } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { Auth } from 'firebase/auth';
import type { FirebaseStorage } from 'firebase/storage';
import { db, auth, storage } from './config';

interface FirebaseContextValue {
  db:      Firestore;
  auth:    Auth;
  storage: FirebaseStorage;
}

const FirebaseContext = createContext<FirebaseContextValue>({ db, auth, storage });

export function FirebaseProvider({ children }: { children: React.ReactNode }) {
  return (
    <FirebaseContext.Provider value={{ db, auth, storage }}>
      {children}
    </FirebaseContext.Provider>
  );
}

// Hook à utiliser dans tous les modules pour accéder à Firebase
export function useFirebase() {
  return useContext(FirebaseContext);
}
