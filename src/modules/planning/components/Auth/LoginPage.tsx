import { useState } from 'react'
import { signIn } from '../../firebase/auth'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    try { await signIn(email, password) }
    catch { setError('Email ou mot de passe incorrect.') }
    finally { setLoading(false) }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--surface)' }}
    >
      <div
        className="w-full max-w-sm"
        style={{
          background: 'var(--surface-low)',
          borderRadius: 'var(--radius-xl)',
          padding: '2.5rem 2rem',
          boxShadow: 'var(--shadow-float)',
        }}
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🗓️</div>
          <h1
            style={{
              fontFamily: 'Epilogue, sans-serif',
              fontWeight: 800,
              fontSize: '1.5rem',
              color: 'var(--on-surface)',
              letterSpacing: '-0.02em',
            }}
          >
            Planning Matias
          </h1>
          <p style={{ color: 'var(--on-surface-2)', fontSize: '0.875rem', marginTop: 4 }}>
            Connexion requise
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              className="block mb-1"
              style={{ fontFamily: 'Manrope, sans-serif', fontWeight: 600, fontSize: '0.8rem', color: 'var(--on-surface-2)' }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="input-filled w-full"
              placeholder="prenom.nom@matias.app"
              required
            />
          </div>

          <div>
            <label
              className="block mb-1"
              style={{ fontFamily: 'Manrope, sans-serif', fontWeight: 600, fontSize: '0.8rem', color: 'var(--on-surface-2)' }}
            >
              Mot de passe
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="input-filled w-full"
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <p
              style={{
                color: 'var(--danger)',
                fontSize: '0.8rem',
                background: 'rgba(192,57,43,0.08)',
                borderRadius: 'var(--radius-md)',
                padding: '0.5rem 0.75rem',
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full"
            style={{ marginTop: '0.5rem', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  )
}
