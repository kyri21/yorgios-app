import { useState, useEffect } from 'react'
import { subscribeEmployees } from '../firebase/employees'
import type { Employee } from '../types'

export function useEmployees() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = subscribeEmployees(emps => {
      setEmployees(emps)
      setLoading(false)
    })
    return unsub
  }, [])

  const byId: Record<string, Employee> = {}
  employees.forEach(e => { byId[e.id] = e })

  return { employees, byId, loading }
}
