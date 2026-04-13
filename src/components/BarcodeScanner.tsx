import { useEffect, useRef } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

interface Props {
  onScan: (value: string) => void
  onClose: () => void
}

export default function BarcodeScanner({ onScan, onClose }: Props) {
  const divId = 'barcode-scanner-region'
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const scanner = new Html5Qrcode(divId)
    scannerRef.current = scanner

    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 260, height: 100 }, aspectRatio: 1.5 },
      (decodedText) => {
        scanner.stop().catch(() => {})
        onScan(decodedText)
      },
      () => {},
    ).catch((e) => {
      console.warn('[Scanner] start failed:', e)
    })

    return () => {
      scanner.stop().catch(() => {})
    }
  }, [onScan])

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(28,28,24,0.72)',
      zIndex: 500,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '0 20px',
    }}>
      <div style={{
        background: 'var(--surface)',
        borderRadius: 20,
        width: '100%', maxWidth: 420,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 18px',
          borderBottom: '1px solid var(--border)',
        }}>
          <div>
            <div style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 16, fontWeight: 700, color: 'var(--on-surface)' }}>
              Scanner un code-barres
            </div>
            <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 2 }}>
              Pointez vers le N° de lot fournisseur
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'var(--surface-mid)', border: 'none',
              borderRadius: 10, width: 32, height: 32,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 16, color: 'var(--on-surface-2)',
            }}
          >✕</button>
        </div>

        {/* Scanner region */}
        <div style={{ background: '#000', position: 'relative' }}>
          <div id={divId} style={{ width: '100%' }} />
          {/* Viseur */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{
              width: 260, height: 100,
              border: '2px solid rgba(0,255,128,0.8)',
              borderRadius: 8,
              boxShadow: '0 0 0 2000px rgba(0,0,0,0.3)',
            }} />
          </div>
        </div>

        <div style={{ padding: '14px 18px', textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0 }}>
            EAN-13, Code 128, QR code…
          </p>
        </div>
      </div>
    </div>
  )
}
