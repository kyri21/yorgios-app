import { useState } from 'react';

interface Props {
  onAccept: () => void;
}

export default function GdprConsentModal({ onAccept }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [loading, setLoading]   = useState(false);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight * 0.8) {
      setScrolled(true);
    }
  }

  async function handleAccept() {
    setLoading(true);
    await onAccept();
    setLoading(false);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
      fontFamily: 'Manrope, sans-serif',
    }}>
      <div style={{
        width: '100%', maxWidth: 520,
        background: 'var(--surface)',
        borderRadius: 20,
        display: 'flex', flexDirection: 'column',
        maxHeight: '90dvh',
        boxShadow: '0 24px 80px rgba(0,0,0,0.15)',
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          padding: '24px 24px 16px',
          borderBottom: '1px solid var(--border-soft)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <span style={{ fontSize: 28 }}>📍</span>
            <h2 style={{
              margin: 0,
              fontSize: 18, fontWeight: 700, color: 'var(--on-surface)',
              letterSpacing: '-0.02em', fontFamily: 'Epilogue, sans-serif',
            }}>
              Information RGPD — Géolocalisation
            </h2>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--on-surface-3)', lineHeight: 1.4 }}>
            À lire avant votre première utilisation de l'application Matias.
          </p>
        </div>

        {/* Contenu scrollable */}
        <div
          onScroll={handleScroll}
          style={{
            flex: 1, overflowY: 'auto',
            padding: '20px 24px',
            color: 'var(--on-surface-2)',
            fontSize: 14, lineHeight: 1.65,
          }}
        >
          <Section title="Responsable du traitement">
            <p>
              <strong style={{ color: 'var(--on-surface)' }}>Yorgios</strong> — représenté par la direction de l'établissement.
            </p>
          </Section>

          <Section title="Données collectées">
            <p>
              Lors de chaque pointage (arrivée / départ), l'application enregistre :
            </p>
            <ul style={{ margin: '8px 0 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li>Vos <strong style={{ color: 'var(--on-surface)' }}>coordonnées GPS</strong> (latitude, longitude) au moment du pointage</li>
              <li>L'<strong style={{ color: 'var(--on-surface)' }}>horodatage</strong> (date et heure)</li>
              <li>Le <strong style={{ color: 'var(--on-surface)' }}>type d'action</strong> (entrée ou sortie)</li>
            </ul>
          </Section>

          <Section title="Finalité du traitement">
            <p>
              Ces données sont collectées exclusivement pour <strong style={{ color: 'var(--on-surface)' }}>vérifier votre présence sur le lieu de travail</strong> (zone définie autour du restaurant) et calculer vos horaires de présence.
            </p>
            <p style={{ marginTop: 8 }}>
              La géolocalisation est activée <strong style={{ color: 'var(--on-surface)' }}>uniquement au moment du pointage</strong>, et non de façon continue.
            </p>
          </Section>

          <Section title="Base légale">
            <p>
              Le traitement repose sur l'<strong style={{ color: 'var(--on-surface)' }}>intérêt légitime de l'employeur</strong> à contrôler les horaires de travail conformément au contrat de travail (Article 6.1.f du RGPD).
            </p>
          </Section>

          <Section title="Destinataires">
            <p>
              Vos données de pointage sont accessibles uniquement aux personnes habilitées :
              patron, administrateur et manager de l'établissement.
            </p>
            <p style={{ marginTop: 8 }}>
              Aucune donnée n'est transmise à des tiers ni utilisée à des fins commerciales.
            </p>
          </Section>

          <Section title="Durée de conservation">
            <p>
              Les données de pointage sont conservées pendant <strong style={{ color: 'var(--on-surface)' }}>12 mois</strong> à compter de leur enregistrement, puis supprimées.
            </p>
          </Section>

          <Section title="Vos droits (RGPD)">
            <p>Conformément au Règlement Général sur la Protection des Données, vous disposez des droits suivants :</p>
            <ul style={{ margin: '8px 0 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li><strong style={{ color: 'var(--on-surface)' }}>Droit d'accès</strong> — obtenir une copie de vos données</li>
              <li><strong style={{ color: 'var(--on-surface)' }}>Droit de rectification</strong> — corriger des données inexactes</li>
              <li><strong style={{ color: 'var(--on-surface)' }}>Droit à l'effacement</strong> — demander la suppression de vos données</li>
              <li><strong style={{ color: 'var(--on-surface)' }}>Droit d'opposition</strong> — vous opposer au traitement dans certains cas</li>
              <li><strong style={{ color: 'var(--on-surface)' }}>Droit à la limitation</strong> — limiter temporairement le traitement</li>
            </ul>
          </Section>

          <Section title="Exercer vos droits">
            <p>
              Pour exercer vos droits ou poser une question, adressez votre demande directement à la direction du restaurant.
            </p>
            <p style={{ marginTop: 8 }}>
              Vous pouvez également déposer une réclamation auprès de la{' '}
              <strong style={{ color: 'var(--on-surface)' }}>CNIL</strong> (Commission Nationale de l'Informatique et des Libertés) — <span style={{ color: 'var(--on-surface-3)' }}>www.cnil.fr</span>.
            </p>
          </Section>

          {/* Indicateur de lecture */}
          {!scrolled && (
            <div style={{
              marginTop: 16,
              padding: '10px 14px',
              background: 'rgba(0,66,117,0.08)',
              border: '1px solid rgba(0,66,117,0.20)',
              borderRadius: 10,
              fontSize: 12, color: 'var(--primary)', fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>↓</span>
              Faites défiler pour lire l'intégralité avant d'accepter
            </div>
          )}
        </div>

        {/* Footer — bouton */}
        <div style={{
          padding: '16px 24px 24px',
          borderTop: '1px solid var(--border-soft)',
          flexShrink: 0,
        }}>
          <button
            onClick={handleAccept}
            disabled={!scrolled || loading}
            className={scrolled && !loading ? 'btn-primary' : undefined}
            style={{
              width: '100%', height: 52,
              ...(!(scrolled && !loading) ? {
                background: 'var(--surface-mid)',
                border: 'none', borderRadius: 14,
                color: 'var(--on-surface-3)',
                cursor: 'not-allowed',
              } : {}),
              fontSize: 15, fontWeight: 700,
              fontFamily: 'Manrope, sans-serif',
              transition: 'background 0.2s, color 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {loading
              ? <><Spinner /> Enregistrement…</>
              : scrolled
                ? '✓ J\'ai lu et j\'accepte'
                : 'Lisez l\'intégralité pour continuer'
            }
          </button>
          <p style={{
            margin: '10px 0 0', textAlign: 'center',
            fontSize: 11, color: 'var(--on-surface-3)', lineHeight: 1.4,
          }}>
            L'acceptation est requise pour utiliser l'application Matias.
            Elle n'implique pas de consentement supplémentaire au-delà de votre contrat de travail.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{
        margin: '0 0 8px',
        fontSize: 11, fontWeight: 700,
        color: 'var(--primary)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        fontFamily: 'Manrope, sans-serif',
      }}>
        {title}
      </h3>
      <div style={{ margin: 0, color: 'var(--on-surface-2)' }}>
        {children}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span style={{
      width: 14, height: 14, borderRadius: '50%',
      border: '2px solid rgba(255,255,255,0.3)',
      borderTopColor: '#fff',
      display: 'inline-block',
      animation: 'gdpr-spin 0.7s linear infinite',
    }} />
  );
}
