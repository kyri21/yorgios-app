import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  serverTimestamp, query, where, onSnapshot
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import type { Employee } from '../types'

const COL = 'employees'

export async function fetchEmployees(): Promise<Employee[]> {
  const q = query(collection(db, COL), where('active', '==', true))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Employee))
}

export function subscribeEmployees(cb: (emps: Employee[]) => void) {
  const q = query(collection(db, COL), where('active', '==', true))
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() } as Employee)))
  })
}

export async function createEmployee(data: Omit<Employee, 'id'>) {
  return addDoc(collection(db, COL), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
}

export async function updateEmployee(id: string, data: Partial<Employee>) {
  return updateDoc(doc(db, COL, id), { ...data, updatedAt: serverTimestamp() })
}

export async function deactivateEmployee(id: string) {
  return updateDoc(doc(db, COL, id), { active: false, updatedAt: serverTimestamp() })
}
