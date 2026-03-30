import { useEffect, useRef, useState } from 'react'
import {
  Timestamp, addDoc, collection, doc, onSnapshot,
  orderBy, query, updateDoc, limit,
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, auth, storage } from '../../firebase/config'
import { useAuth } from '../../auth/useAuth'
import { registerFCMToken, onForegroundMessage } from '../../firebase/messaging'

const CHANNEL = 'corner-cuisine'
const RETENTION_DAYS = 7

type Message = {
  id: string
  senderId: string
  senderName: string
  senderRole: string
  text: string
  photoUrl?: string
  createdAt: any
}

const ROLE_COLORS: Record<string, string> = {
  corner:  '#FF9500',
  cuisine: '#34C759',
  patron:  '#004275',
  manager: '#5E5CE6',
}
const ROLE_LABELS: Record<string, string> = {
  corner: 'Corner', cuisine: 'Cuisine', patron: 'Patron', manager: 'Manager',
}

function formatTime(ts: any): string {
  if (!ts?.toDate) return ''
  return ts.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function formatDay(ts: any): string {
  if (!ts?.toDate) return ''
  const d = ts.toDate()
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui"
  if (d.toDateString() === yesterday.toDateString()) return 'Hier'
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function isSameDay(a: any, b: any): boolean {
  if (!a?.toDate || !b?.toDate) return false
  return a.toDate().toDateString() === b.toDate().toDateString()
}

export default function Messagerie() {
  const { user } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const uid = auth.currentUser?.uid || ''
  const userName = user?.displayName || user?.email?.split('@')[0] || 'Inconnu'
  const userRole = user?.role || 'corner'

  // Enregistrement FCM au montage
  useEffect(() => {
    if (uid) registerFCMToken(uid)
  }, [uid])

  // Marquer comme lu au montage + mise à jour lastReadMessages
  useEffect(() => {
    if (!uid) return
    updateDoc(doc(db, 'users', uid), { lastReadMessages: Timestamp.now() }).catch(() => {})
  }, [uid])

  // Messages en temps réel
  useEffect(() => {
    const q = query(
      collection(db, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(200),
    )
    const unsub = onSnapshot(q, (snap) => {
      const all: Message[] = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter((m: any) => m.channelId === CHANNEL)
      setMessages(all)
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
    })
    return unsub
  }, [])

  // Notification foreground
  useEffect(() => {
    const unsub = onForegroundMessage((payload) => {
      if (payload?.notification?.body) showToast(payload.notification.body)
    })
    return unsub
  }, [])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  async function send() {
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    setText('')
    try {
      const now = Timestamp.now()
      const expires = Timestamp.fromMillis(now.toMillis() + RETENTION_DAYS * 86400_000)
      await addDoc(collection(db, 'messages'), {
        channelId: CHANNEL,
        senderId: uid,
        senderName: userName,
        senderRole: userRole,
        text: t,
        createdAt: now,
        expiresAt: expires,
      })
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  async function sendPhoto(file: File) {
    setUploading(true)
    try {
      const now = Timestamp.now()
      const expires = Timestamp.fromMillis(now.toMillis() + RETENTION_DAYS * 86400_000)
      const path = `messages/${uid}_${Date.now()}_${file.name}`
      const storageRef = ref(storage, path)
      await uploadBytes(storageRef, file)
      const photoUrl = await getDownloadURL(storageRef)
      await addDoc(collection(db, 'messages'), {
        channelId: CHANNEL,
        senderId: uid,
        senderName: userName,
        senderRole: userRole,
        text: '',
        photoUrl,
        createdAt: now,
        expiresAt: expires,
      })
    } catch (e: any) {
      showToast('Erreur upload photo')
    } finally {
      setUploading(false)
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const isMine = (m: Message) => m.senderId === uid

  return (
    <div className="flex flex-col" style={{ height: 'calc(100dvh - var(--nav-h) - var(--safe-top))', background: 'var(--surface)' }}>

      {/* Header */}
      <div style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: 12,
        flexShrink: 0,
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%',
          background: 'rgba(0,66,117,0.10)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18,
        }}>💬</div>
        <div>
          <div style={{ color: 'var(--on-surface)', fontWeight: 700, fontSize: 16, fontFamily: 'Epilogue, sans-serif', letterSpacing: '-0.02em', lineHeight: 1.2 }}>Messagerie</div>
          <div style={{ color: 'var(--on-surface-3)', fontSize: 12, fontFamily: 'Manrope, sans-serif' }}>Corner ↔ Cuisine · 7 jours</div>
        </div>
      </div>

      {/* Messages list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--surface-low)' }}>
        {messages.length === 0 && (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--on-surface-3)', padding: '40px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>💬</div>
            <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'Epilogue, sans-serif', color: 'var(--on-surface)', marginBottom: 8, letterSpacing: '-0.02em' }}>
              Aucun message — soyez le premier !
            </div>
            <div style={{ fontSize: 13, fontFamily: 'Manrope, sans-serif', color: 'var(--on-surface-2)', lineHeight: 1.6 }}>
              Démarrez une nouvelle conversation avec votre<br />équipe pour assurer une précision HACCP irréprochable.
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          const mine = isMine(m)
          const showDay = i === 0 || !isSameDay(messages[i - 1].createdAt, m.createdAt)
          const showName = !mine && (i === 0 || messages[i - 1].senderId !== m.senderId)

          return (
            <div key={m.id}>
              {showDay && (
                <div style={{ textAlign: 'center', margin: '16px 0 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span style={{ fontSize: 11, color: 'var(--on-surface-3)', fontWeight: 600, fontFamily: 'Manrope, sans-serif', whiteSpace: 'nowrap', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    {formatDay(m.createdAt)}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', marginBottom: 2 }}>
                {showName && (
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, marginLeft: 4, color: ROLE_COLORS[m.senderRole] || 'var(--on-surface-2)', fontFamily: 'Manrope, sans-serif' }}>
                    {m.senderName} · {ROLE_LABELS[m.senderRole] || m.senderRole}
                  </div>
                )}
                <div style={{ maxWidth: '80%' }}>
                  {m.photoUrl ? (
                    <div className={mine ? 'bubble-sent' : 'bubble-received'} style={{ padding: 4 }}>
                      <img
                        src={m.photoUrl}
                        alt="Photo"
                        style={{ width: '100%', maxWidth: 240, borderRadius: 12, display: 'block' }}
                        onClick={() => window.open(m.photoUrl, '_blank')}
                      />
                      {m.text && <div style={{ padding: '4px 4px 0', fontSize: 14, fontFamily: 'Manrope, sans-serif' }}>{m.text}</div>}
                    </div>
                  ) : (
                    <div className={mine ? 'bubble-sent' : 'bubble-received'} style={{ fontSize: 14, lineHeight: 1.5, fontFamily: 'Manrope, sans-serif' }}>
                      {m.text}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--on-surface-3)', marginTop: 3, textAlign: mine ? 'right' : 'left', paddingInline: 4, fontFamily: 'Manrope, sans-serif' }}>
                    {formatTime(m.createdAt)}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Toast notification foreground */}
      {toast && (
        <div style={{
          position: 'fixed', top: 'calc(var(--safe-top) + 70px)', left: 16, right: 16,
          background: 'var(--primary)', color: '#fff', borderRadius: 12, padding: '10px 16px',
          fontSize: 13, fontWeight: 500, zIndex: 100, fontFamily: 'Manrope, sans-serif',
          boxShadow: 'var(--shadow-float)',
        }} className="animate-slide-up">
          💬 {toast}
        </div>
      )}

      {/* Input bar */}
      <div style={{
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)',
        padding: `10px 16px calc(10px + var(--safe-bottom))`,
        display: 'flex', alignItems: 'flex-end', gap: 8,
        flexShrink: 0,
      }}>
        {/* Photo button */}
        <button
          className="btn-icon"
          style={{ background: 'var(--surface-mid)', border: '1px solid var(--border)', flexShrink: 0 }}
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          title="Envoyer une photo"
        >
          {uploading
            ? <div className="spinner" />
            : <svg width="20" height="20" fill="none" stroke="var(--on-surface-2)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          }
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) sendPhoto(f); e.target.value = '' }} />

        {/* Text input */}
        <textarea
          ref={inputRef}
          style={{
            resize: 'none', minHeight: 44, maxHeight: 120, flex: 1, lineHeight: 1.5,
            paddingTop: 10, paddingBottom: 10, paddingLeft: 14, paddingRight: 14,
            background: 'var(--surface-low)', border: '1px solid var(--border)',
            borderRadius: 12, fontFamily: 'Manrope, sans-serif', fontSize: 14,
            color: 'var(--on-surface)', outline: 'none',
          }}
          placeholder="Écrivez votre message…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKey}
          rows={1}
        />

        {/* Send button */}
        <button
          onClick={send}
          disabled={!text.trim() || sending}
          className="btn-icon"
          style={{
            background: text.trim() ? 'var(--primary)' : 'var(--surface-mid)',
            border: `1px solid ${text.trim() ? 'var(--primary)' : 'var(--border)'}`,
            flexShrink: 0, transition: 'background 0.2s',
          }}
          title="Envoyer"
        >
          <svg width="20" height="20" fill="none" stroke={text.trim() ? '#fff' : 'var(--on-surface-3)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
