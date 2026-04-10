import { db } from '../../../firebase/config'
import { doc, getDoc, setDoc, getDocs, collection, query, where, Timestamp } from 'firebase/firestore'
import { monthKey } from '../utils/primes'

export interface PrimeMois {
  month: string
  caObjectif: number | null
  caRealise: number | null
  hygieneActif: boolean
  hygieneScore: number | null
}

export interface PrimeEmploye {
  empId: string
  month: string
  comportementOk: boolean
  ponctualiteOk: boolean
}

export async function loadPrimeMois(month: Date): Promise<PrimeMois | null> {
  const snap = await getDoc(doc(db, 'primes_mois', monthKey(month)))
  return snap.exists() ? (snap.data() as PrimeMois) : null
}

export async function savePrimeMois(data: PrimeMois, uid: string): Promise<void> {
  await setDoc(doc(db, 'primes_mois', data.month), { ...data, updatedAt: Timestamp.now(), updatedBy: uid })
}

export async function loadPrimesEmployes(month: Date): Promise<PrimeEmploye[]> {
  const snap = await getDocs(query(collection(db, 'primes_employe'), where('month', '==', monthKey(month))))
  return snap.docs.map(d => d.data() as PrimeEmploye)
}

export async function savePrimesEmployes(items: PrimeEmploye[], uid: string): Promise<void> {
  await Promise.all(items.map(item =>
    setDoc(doc(db, 'primes_employe', `${item.empId}_${item.month}`), { ...item, updatedAt: Timestamp.now(), updatedBy: uid })
  ))
}
