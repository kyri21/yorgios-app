import { useState } from 'react'
import { useCaptation } from './hooks/useCaptation'

export default function CaptationPage() {
  const { submit, status, error, reset } = useCaptation()

  const [prenom, setPrenom]               = useState('')
  const [nom, setNom]                     = useState('')
  const [telephone, setTelephone]         = useState('')
  const [email, setEmail]                 = useState('')
  const [entreprise, setEntreprise]       = useState('')
  const [whatsappOptIn, setWhatsappOptIn] = useState(false)
  const [emailOptIn, setEmailOptIn]       = useState(false)
  const [showSuccess, setShowSuccess]     = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const ok = await submit(prenom, telephone, whatsappOptIn, emailOptIn, nom, email, entreprise)
    if (ok) {
      setShowSuccess(true)
      setTimeout(() => {
        setPrenom('')
        setNom('')
        setTelephone('')
        setEmail('')
        setEntreprise('')
        setWhatsappOptIn(false)
        setEmailOptIn(false)
        setShowSuccess(false)
        reset()
      }, 1800)
    }
  }

  return (
    <div className="page" style={{ maxWidth: 520, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 8 }}>
        <h1 style={{
          fontFamily: 'Epilogue, sans-serif',
          fontSize: 26, fontWeight: 800,
          color: 'var(--on-surface)', margin: 0,
          letterSpacing: '-0.02em',
        }}>
          Nouveau contact
        </h1>
        <p style={{
          fontFamily: 'Manrope, sans-serif',
          fontSize: 13, color: 'var(--on-surface-3)', marginTop: 4,
        }}>
          Enregistrez un client — données synchronisées avec Brevo.
        </p>
      </div>

      {/* Hors-ligne */}
      {!navigator.onLine && (
        <div style={{
          background: 'var(--haccp-warn-bg)',
          borderRadius: 12, padding: '10px 14px',
          fontFamily: 'Manrope, sans-serif', fontSize: 13,
          color: 'var(--haccp-warn-text)', marginBottom: 4,
        }}>
          ⚠️ Pas de connexion réseau.
        </div>
      )}

      {/* Succès */}
      {showSuccess && (
        <div style={{
          background: 'var(--haccp-ok-bg)',
          borderRadius: 14, padding: '16px', textAlign: 'center',
        }} className="animate-slide-up">
          <div style={{ fontSize: 28, marginBottom: 4 }}>✅</div>
          <div style={{
            fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 700,
            color: 'var(--haccp-ok-text)',
          }}>Contact synchronisé !</div>
        </div>
      )}

      {/* Erreur */}
      {status === 'error' && error && (
        <div style={{
          background: 'rgba(192,57,43,0.08)',
          borderRadius: 12, padding: '10px 14px',
          fontFamily: 'Manrope, sans-serif', fontSize: 13,
          color: '#c0392b',
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Formulaire */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Identité — card groupée */}
        <div style={{
          background: '#fff',
          borderRadius: 16,
          border: '1.5px solid var(--border-soft)',
          overflow: 'hidden',
          boxShadow: '0 2px 12px rgba(0,66,117,0.04)',
        }}>
          <div style={sectionHeaderStyle}>
            <span style={{ fontSize: 14 }}>👤</span> Identité
          </div>

          <div style={fieldRowStyle}>
            <div style={fieldWrapStyle}>
              <label style={labelStyle}>Prénom *</label>
              <input
                type="text"
                value={prenom}
                onChange={e => setPrenom(e.target.value)}
                placeholder="Marie"
                required
                autoComplete="given-name"
                style={inputStyle}
              />
            </div>
            <div style={fieldWrapStyle}>
              <label style={labelStyle}>Nom</label>
              <input
                type="text"
                value={nom}
                onChange={e => setNom(e.target.value)}
                placeholder="Dupont"
                autoComplete="family-name"
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ ...fieldWrapStyle, margin: '0 16px 16px', borderTop: '1px solid var(--border-soft)', paddingTop: 14 }}>
            <label style={labelStyle}>Entreprise</label>
            <input
              type="text"
              value={entreprise}
              onChange={e => setEntreprise(e.target.value)}
              placeholder="Société ou organisation"
              autoComplete="organization"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Contact — card groupée */}
        <div style={{
          background: '#fff',
          borderRadius: 16,
          border: '1.5px solid var(--border-soft)',
          overflow: 'hidden',
          boxShadow: '0 2px 12px rgba(0,66,117,0.04)',
        }}>
          <div style={sectionHeaderStyle}>
            <span style={{ fontSize: 14 }}>📞</span> Contact
          </div>

          <div style={{ padding: '0 16px 4px' }}>
            <label style={labelStyle}>Téléphone *</label>
            <input
              type="tel"
              value={telephone}
              onChange={e => setTelephone(e.target.value)}
              placeholder="06 00 00 00 00"
              required
              autoComplete="tel"
              inputMode="tel"
              style={inputStyle}
            />
            <div style={{
              fontFamily: 'Manrope, sans-serif', fontSize: 11,
              color: 'var(--on-surface-3)', marginTop: 4, marginBottom: 14,
            }}>
              Format accepté : 06XXXXXXXX, +336XXXXXXXX
            </div>
          </div>

          <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border-soft)', paddingTop: 14 }}>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="marie@exemple.fr"
              autoComplete="email"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Consentements */}
        <div style={{
          background: '#fff',
          borderRadius: 16,
          border: '1.5px solid var(--border-soft)',
          overflow: 'hidden',
          boxShadow: '0 2px 12px rgba(0,66,117,0.04)',
        }}>
          <div style={sectionHeaderStyle}>
            <span style={{ fontSize: 14 }}>✅</span> Consentements
          </div>

          <div style={toggleRowStyle} onClick={() => setWhatsappOptIn(v => !v)}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: 'var(--on-surface)' }}>
                Opt-in WhatsApp
              </div>
              <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 12, color: 'var(--on-surface-3)', marginTop: 2 }}>
                Le client accepte de recevoir des messages WhatsApp.
              </div>
            </div>
            <Toggle active={whatsappOptIn} />
          </div>

          <div style={{ ...toggleRowStyle, borderTop: '1px solid var(--border-soft)', borderRadius: 0 }} onClick={() => setEmailOptIn(v => !v)}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 600, color: 'var(--on-surface)' }}>
                Newsletter email
              </div>
              <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 12, color: 'var(--on-surface-3)', marginTop: 2 }}>
                Le client accepte les emails marketing (optionnel).
              </div>
            </div>
            <Toggle active={emailOptIn} />
          </div>
        </div>

        <button
          type="submit"
          disabled={status === 'loading' || !navigator.onLine}
          className="btn-primary"
          style={{ marginTop: 4 }}
        >
          {status === 'loading' ? (
            <>
              <span className="spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)', width: 16, height: 16 }} />
              Synchronisation…
            </>
          ) : '+ Enregistrer le contact'}
        </button>
      </form>
    </div>
  )
}

/* ── Styles ── */
const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '12px 16px',
  fontFamily: 'Manrope, sans-serif',
  fontSize: 12, fontWeight: 700,
  color: 'var(--on-surface-3)',
  letterSpacing: '0.06em', textTransform: 'uppercase',
  borderBottom: '1px solid var(--border-soft)',
  background: 'var(--surface-low)',
}

const fieldRowStyle: React.CSSProperties = {
  display: 'flex', gap: 0,
}

const fieldWrapStyle: React.CSSProperties = {
  flex: 1, padding: '12px 16px',
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'Manrope, sans-serif',
  fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)',
  display: 'block', marginBottom: 6,
  textTransform: 'uppercase', letterSpacing: '0.06em',
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 44,
  padding: '0 0',
  background: 'transparent',
  border: 'none',
  borderBottom: '1.5px solid var(--border)',
  fontFamily: 'Manrope, sans-serif',
  fontSize: 15, color: 'var(--on-surface)',
  outline: 'none',
  transition: 'border-color 0.2s ease',
}

const toggleRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  padding: '14px 16px', cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
}

function Toggle({ active }: { active: boolean }) {
  return (
    <div style={{
      flexShrink: 0,
      width: 44, height: 26,
      borderRadius: 13,
      background: active ? '#004275' : 'var(--surface-high)',
      position: 'relative',
      transition: 'background 0.2s ease',
    }}>
      <div style={{
        position: 'absolute',
        top: 3, left: active ? 21 : 3,
        width: 20, height: 20, borderRadius: 10,
        background: '#fff',
        transition: 'left 0.2s ease',
        boxShadow: '0 1px 4px rgba(28,28,24,0.2)',
      }} />
    </div>
  )
}
