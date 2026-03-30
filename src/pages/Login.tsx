import { useState, useEffect } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase/config';
import { useAuth } from '../auth/useAuth';
import { getRoleHome } from '../auth/AuthGuard';

const IPAD_CORNER_EMAIL  = 'ipad@yorgios.fr'
const IPAD_CUISINE_EMAIL = 'ipad.cuisine@yorgios.fr'

export default function Login() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [quickMode, setQuickMode] = useState<'corner' | 'cuisine' | null>(null);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (user) navigate(getRoleHome(user.role), { replace: true });
  }, [user, navigate]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const loginEmail = quickMode === 'corner'  ? IPAD_CORNER_EMAIL
                       : quickMode === 'cuisine' ? IPAD_CUISINE_EMAIL
                       : email.trim();
      await signInWithEmailAndPassword(auth, loginEmail, password);
    } catch {
      setError('Identifiants incorrects. Réessayez.');
    } finally {
      setLoading(false);
    }
  }

  function activateQuick(mode: 'corner' | 'cuisine') {
    setQuickMode(mode);
    setEmail('');
    setPassword('');
    setError('');
  }

  function cancelQuick() {
    setQuickMode(null);
    setPassword('');
    setError('');
  }

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--surface)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 24px',
      fontFamily: 'Manrope, system-ui, sans-serif',
      position: 'relative',
      overflow: 'hidden',
    }}>

      {/* Watermark oeil grec — very subtle */}
      <img
        src="/icons/icon-512.png"
        alt=""
        aria-hidden
        style={{
          position: 'absolute',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '120vw', maxWidth: 720,
          opacity: 0.035,
          pointerEvents: 'none',
          userSelect: 'none',
          filter: 'saturate(0)',
        }}
      />

      {/* Contenu centré */}
      <div style={{
        width: '100%',
        maxWidth: 380,
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>

        {/* Logo */}
        <div style={{
          width: 80, height: 80,
          borderRadius: 22,
          overflow: 'hidden',
          marginBottom: 24,
          boxShadow: '0 8px 40px rgba(0, 66, 117, 0.16), 0 0 0 1px rgba(0,66,117,0.08)',
        }}>
          <img src="/icons/icon-192.png" alt="Matias" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>

        {/* Titre */}
        <h1 style={{
          fontFamily: 'Epilogue, sans-serif',
          fontSize: 32,
          fontWeight: 800,
          color: '#004275',
          letterSpacing: '-0.03em',
          margin: '0 0 6px',
          textAlign: 'center',
        }}>
          Matias
        </h1>
        <p style={{
          fontFamily: 'Manrope, sans-serif',
          fontSize: 14,
          color: 'var(--on-surface-3)',
          margin: '0 0 40px',
          textAlign: 'center',
          letterSpacing: '0.01em',
        }}>
          Espace de travail
        </p>

        {/* Boutons iPad — visibles uniquement si aucun mode quick actif */}
        {!quickMode && (
          <div style={{ width: '100%', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { mode: 'corner'  as const, label: 'iPad Corner',  sub: 'Accès tablette partagée' },
              { mode: 'cuisine' as const, label: 'iPad Cuisine', sub: 'Accès tablette partagée' },
            ].map(({ mode, label, sub }) => (
              <button
                key={mode}
                type="button"
                onClick={() => activateQuick(mode)}
                style={{
                  width: '100%',
                  padding: '16px 18px',
                  background: '#fff',
                  border: '1.5px solid rgba(0, 66, 117, 0.12)',
                  borderRadius: 18, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 14,
                  fontFamily: 'Manrope, sans-serif',
                  transition: 'background 0.15s, border-color 0.15s',
                  boxShadow: '0 2px 12px rgba(0,66,117,0.06)',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = 'var(--surface-low)'
                  ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,66,117,0.25)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = '#fff'
                  ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,66,117,0.12)'
                }}
                onTouchStart={e => (e.currentTarget.style.background = 'var(--surface-low)')}
                onTouchEnd={e => (e.currentTarget.style.background = '#fff')}
              >
                <div style={{
                  width: 48, height: 48, borderRadius: 14,
                  background: 'linear-gradient(135deg, #004275 0%, #005a9c 100%)',
                  flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22,
                }}>
                  📱
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface)' }}>{label}</div>
                  <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 2 }}>{sub}</div>
                </div>
                <div style={{ marginLeft: 'auto', color: 'var(--on-surface-3)', fontSize: 18, fontWeight: 300 }}>›</div>
              </button>
            ))}
          </div>
        )}

        {/* Mode iPad actif */}
        {quickMode && (
          <div style={{
            width: '100%', marginBottom: 16,
            padding: '14px 16px',
            background: 'rgba(0, 66, 117, 0.06)',
            border: '1.5px solid rgba(0, 66, 117, 0.2)',
            borderRadius: 14,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontSize: 22 }}>📱</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 14, fontWeight: 700, color: '#004275' }}>
                {quickMode === 'corner' ? 'iPad Corner' : 'iPad Cuisine'}
              </div>
              <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 12, color: 'var(--on-surface-3)', marginTop: 1 }}>Entrez le code d'accès</div>
            </div>
            <button
              type="button"
              onClick={cancelQuick}
              style={{ background: 'none', border: 'none', color: 'var(--on-surface-3)', fontSize: 18, cursor: 'pointer', padding: '4px 8px' }}
            >✕</button>
          </div>
        )}

        {/* Formulaire */}
        <form onSubmit={handleLogin} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 0 }}>

          <div style={{
            background: '#fff',
            borderRadius: 18,
            border: '1.5px solid rgba(0,66,117,0.1)',
            overflow: 'hidden',
            marginBottom: 16,
            boxShadow: '0 2px 16px rgba(0,66,117,0.06)',
          }}>
            {!quickMode && (
              <div style={{ position: 'relative' }}>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required={!quickMode}
                  autoComplete="email"
                  placeholder="Adresse email"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    height: 56, padding: '0 18px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid rgba(0,66,117,0.08)',
                    fontSize: 15, color: 'var(--on-surface)',
                    fontFamily: 'Manrope, sans-serif',
                    outline: 'none',
                  }}
                />
              </div>
            )}

            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder={quickMode ? 'Code d\'accès' : 'Mot de passe'}
              style={{
                width: '100%', boxSizing: 'border-box',
                height: 56, padding: '0 18px',
                background: 'transparent',
                border: 'none',
                fontSize: 15, color: 'var(--on-surface)',
                fontFamily: 'Manrope, sans-serif',
                outline: 'none',
              }}
            />
          </div>

          {error && (
            <div style={{
              padding: '11px 16px',
              background: 'rgba(192, 57, 43, 0.08)',
              borderRadius: 12, marginBottom: 12,
              fontFamily: 'Manrope, sans-serif',
              fontSize: 13, color: '#c0392b',
              textAlign: 'center',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', height: 56,
              background: loading
                ? 'rgba(0, 66, 117, 0.5)'
                : 'linear-gradient(135deg, #004275 0%, #005a9c 100%)',
              border: 'none',
              borderRadius: 18,
              fontFamily: 'Epilogue, sans-serif',
              fontSize: 16, fontWeight: 700,
              color: '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              transition: 'opacity 0.15s',
              letterSpacing: '0.01em',
              boxShadow: loading ? 'none' : '0 4px 24px rgba(0,66,117,0.28)',
            }}
          >
            {loading ? (
              <>
                <span style={{
                  width: 18, height: 18, borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff',
                  display: 'inline-block',
                  animation: 'spin 0.7s linear infinite',
                }} />
                Connexion…
              </>
            ) : 'Se connecter'}
          </button>
        </form>

        {/* Lien RGPD */}
        <p style={{
          marginTop: 20, marginBottom: 0,
          fontFamily: 'Manrope, sans-serif', fontSize: 12,
          color: 'var(--on-surface-3)', textAlign: 'center',
        }}>
          En vous connectant, vous acceptez notre{' '}
          <a
            href="/rgpd"
            style={{ color: 'var(--primary)', textDecoration: 'underline', fontWeight: 600 }}
          >
            politique de confidentialité
          </a>
        </p>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
