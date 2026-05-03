import { useRef, useState, useEffect, useCallback } from 'react'
import { doc, updateDoc, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'

export interface Annonce {
  id: string
  titre: string
  corps: string
  createdByName: string
  createdAt: any
}

interface Props {
  annonces: Annonce[]
  uid: string
  onAllRead: () => void
}

export default function AnnonceGate({ annonces, uid, onAllRead }: Props) {
  const [index, setIndex]       = useState(0)
  const [canConfirm, setCanConfirm] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const current = annonces[index]

  // Quand on change d'annonce : reset scroll + vérifier si contenu court
  useEffect(() => {
    setCanConfirm(false)
    const check = () => {
      const el = scrollRef.current
      if (el && el.scrollHeight <= el.clientHeight + 10) setCanConfirm(true)
    }
    const timer = setTimeout(check, 120)
    return () => clearTimeout(timer)
  }, [index])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || canConfirm) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 32) setCanConfirm(true)
  }, [canConfirm])

  async function handleConfirm() {
    if (!canConfirm || confirming) return
    setConfirming(true)
    try {
      await updateDoc(doc(db, 'annonces', current.id), {
        [`readBy.${uid}`]: Timestamp.now(),
      })
    } catch {}
    if (index + 1 < annonces.length) {
      setIndex(i => i + 1)
      setConfirming(false)
    } else {
      onAllRead()
    }
  }

  if (!current) return null

  const dateStr = current.createdAt?.toDate
    ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
        .format(current.createdAt.toDate())
    : ''

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(28,28,24,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
      backdropFilter: 'blur(6px)',
    }}>
      <div style={{
        background: 'var(--surface)', borderRadius: 18,
        width: '100%', maxWidth: 560,
        maxHeight: 'calc(100dvh - 32px)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(28,28,24,0.35)',
        overflow: 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border-soft)', flexShrink: 0 }}>
          {annonces.length > 1 && (
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
              Message {index + 1} / {annonces.length}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12, flexShrink: 0,
              background: 'rgba(0,66,117,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22,
            }}>📢</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 17, fontWeight: 800, color: 'var(--on-surface)',
                fontFamily: 'Epilogue, sans-serif', lineHeight: 1.25,
              }}>
                {current.titre}
              </div>
              <div style={{ fontSize: 11, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif', marginTop: 3 }}>
                De {current.createdByName}{dateStr ? ` · ${dateStr}` : ''}
              </div>
            </div>
          </div>
          <div style={{
            marginTop: 10, fontSize: 11, fontWeight: 600,
            color: '#b45309', background: 'rgba(180,83,9,0.09)',
            borderRadius: 6, padding: '4px 10px',
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}>
            ⚠️ Lecture obligatoire — faites défiler jusqu'en bas
          </div>
        </div>

        {/* ── Corps scrollable ── */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            flex: 1, minHeight: 0, overflowY: 'auto',
            padding: '20px 24px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <div style={{
            fontSize: 14, color: 'var(--on-surface)', lineHeight: 1.75,
            fontFamily: 'Manrope, sans-serif',
            whiteSpace: 'pre-wrap',
          }}>
            {current.corps}
          </div>
          <div style={{ height: 4 }} />
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding: '14px 24px 20px',
          borderTop: '1px solid var(--border-soft)',
          flexShrink: 0,
          background: canConfirm ? 'rgba(45,122,79,0.05)' : 'var(--surface-low)',
          transition: 'background 0.35s',
        }}>
          {!canConfirm && (
            <div style={{
              fontSize: 11, color: 'var(--on-surface-3)', textAlign: 'center',
              marginBottom: 10, fontFamily: 'Manrope, sans-serif',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}>
              <span style={{ fontSize: 14 }}>↓</span> Faites défiler jusqu'en bas pour confirmer
            </div>
          )}
          <button
            onClick={handleConfirm}
            disabled={!canConfirm || confirming}
            style={{
              width: '100%', padding: '13px 24px',
              borderRadius: 10, border: 'none',
              fontSize: 14, fontWeight: 700,
              fontFamily: 'Manrope, sans-serif',
              cursor: canConfirm && !confirming ? 'pointer' : 'not-allowed',
              background: canConfirm ? '#2d7a4f' : 'var(--surface-mid)',
              color: canConfirm ? '#fff' : 'var(--on-surface-3)',
              transition: 'background 0.35s, color 0.35s',
              letterSpacing: '-0.01em',
            }}
          >
            {confirming ? 'Enregistrement…' : canConfirm ? '✓ J\'ai lu et compris' : '— Lisez d\'abord le message complet —'}
          </button>
        </div>
      </div>
    </div>
  )
}
