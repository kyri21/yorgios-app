import { signOut as fbSignOut, signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../../../firebase/config'

export async function signIn(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password)
}

export async function signOut() {
  return fbSignOut(auth)
}
