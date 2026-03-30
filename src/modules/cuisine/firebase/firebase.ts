import app, { db, auth, storage } from '../../../firebase/config'

export { db, storage, app }

export const PHOTO_MODE = (import.meta.env.VITE_PHOTO_MODE as string) || "STORAGE"

export async function ensureAnonAuth() {
  if (auth.currentUser) return auth.currentUser
  throw new Error('Non authentifié')
}
