import { useEffect } from 'react'
import type { Toast as ToastType } from '../hooks/useToast'

const COLORS = {
  success: { bg: 'rgba(50,215,75,0.92)',  border: '#32d74b' },
  error:   { bg: 'rgba(255,69,58,0.92)',  border: '#ff453a' },
  info:    { bg: 'rgba(0,66,117,0.92)',   border: '#004275' },
}

export default function Toast({
  toast,
  setToast,
}: {
  toast: ToastType | null
  setToast: (t: ToastType | null) => void
}) {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast?.id])

  if (!toast) return null
  const { bg, border } = COLORS[toast.type]

  return (
    <>
      <style>{`@keyframes slideUpFade { from { opacity:0; transform: translateX(-50%) translateY(12px); } to { opacity:1; transform: translateX(-50%) translateY(0); } }`}</style>
      <div style={{
        position: 'fixed',
        bottom: 'calc(70px + env(safe-area-inset-bottom, 0px))',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 500,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 12,
        padding: '12px 20px',
        fontSize: 14,
        fontWeight: 600,
        color: '#fff',
        maxWidth: 340,
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        animation: 'slideUpFade 0.25s ease',
      }}>
        {toast.type === 'success' ? '✓ ' : toast.type === 'error' ? '✕ ' : 'ℹ '}{toast.message}
      </div>
    </>
  )
}
