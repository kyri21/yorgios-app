import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  serverTimestamp, query, where, onSnapshot
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import type { Employee } from '../types'

const COL = 'employees'

// Firestore refuse les valeurs `undefined` (ignoreUndefinedProperties non activé).
// On retire les clés undefined ; les sentinelles deleteField() (objets) sont conservées.
function stripUndefined<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out as T
}

export async function fetchEmployees(): Promise<Employee[]> {
  const q = query(collection(db, COL), where('active', '==', true))
  const snap = await getDocs(q)
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as Employee))
    .filter(e => !e.suspended)
}

export function subscribeEmployees(cb: (emps: Employee[]) => void) {
  const q = query(collection(db, COL), where('active', '==', true))
  return onSnapshot(q, snap => {
    cb(snap.docs
      .map(d => ({ id: d.id, ...d.data() } as Employee))
      .filter(e => !e.suspended)
    )
  })
}

export function subscribeAllEmployees(cb: (emps: Employee[]) => void) {
  const q = query(collection(db, COL), where('active', '==', true))
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as Employee)))
  })
}

export async function suspendEmployee(id: string, suspended: boolean) {
  return updateDoc(doc(db, COL, id), { suspended, updatedAt: serverTimestamp() })
}

export async function createEmployee(data: Omit<Employee, 'id'>) {
  return addDoc(collection(db, COL), { ...stripUndefined(data), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
}

export async function updateEmployee(id: string, data: Partial<Employee>) {
  return updateDoc(doc(db, COL, id), { ...stripUndefined(data), updatedAt: serverTimestamp() })
}

export async function deactivateEmployee(id: string) {
  return updateDoc(doc(db, COL, id), { active: false, updatedAt: serverTimestamp() })
}
