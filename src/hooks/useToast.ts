import { useState, useCallback } from 'react'

export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  message: string
  type: ToastType
}

let _setToast: ((t: Toast | null) => void) | null = null

export function useToast() {
  const show = useCallback((message: string, type: ToastType = 'success') => {
    const id = Date.now()
    _setToast?.({ id, message, type })
  }, [])
  return { show }
}

export function useToastState() {
  const [toast, setToast] = useState<Toast | null>(null)
  _setToast = setToast
  return { toast, setToast }
}
