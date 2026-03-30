export default function Rgpd() {
  return (
    <div style={{
      minHeight: '100dvh', background: 'var(--surface)',
      padding: '32px 24px 48px', fontFamily: 'Manrope, sans-serif',
      maxWidth: 600, margin: '0 auto',
    }}>
      <a href="/login" style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 13, color: 'var(--primary)', textDecoration: 'none',
        fontWeight: 600, marginBottom: 28,
      }}>← Retour</a>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <span style={{ fontSize: 28 }}>📍</span>
        <h1 style={{
          margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--on-surface)',
          letterSpacing: '-0.03em', fontFamily: 'Epilogue, sans-serif',
        }}>
          Information RGPD — Géolocalisation
        </h1>
      </div>
      <p style={{ margin: '0 0 32px', fontSize: 13, color: 'var(--on-surface-3)', lineHeight: 1.4 }}>
        Politique de confidentialité de l'application Matias.
      </p>

      <Section title="Responsable du traitement">
        <p><strong>Yorgios</strong> — représenté par la direction de l'établissement.</p>
      </Section>

      <Section title="Données collectées">
        <p>Lors de chaque pointage (arrivée / départ), l'application enregistre :</p>
        <ul style={{ margin: '8px 0 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>Vos <strong>coordonnées GPS</strong> (latitude, longitude) au moment du pointage</li>
          <li>L'<strong>horodatage</strong> (date et heure)</li>
          <li>Le <strong>type d'action</strong> (entrée ou sortie)</li>
        </ul>
      </Section>

      <Section title="Finalité du traitement">
        <p>
          Ces données sont collectées exclusivement pour <strong>vérifier votre présence sur le lieu de travail</strong> (zone définie autour du restaurant) et calculer vos horaires de présence.
        </p>
        <p style={{ marginTop: 8 }}>
          La géolocalisation est activée <strong>uniquement au moment du pointage</strong>, et non de façon continue.
        </p>
      </Section>

      <Section title="Base légale">
        <p>
          Le traitement repose sur l'<strong>intérêt légitime de l'employeur</strong> à contrôler les horaires de travail conformément au contrat de travail (Article 6.1.f du RGPD).
        </p>
      </Section>

      <Section title="Destinataires">
        <p>
          Vos données de pointage sont accessibles uniquement aux personnes habilitées :
          patron, administrateur et manager de l'établissement.
        </p>
        <p style={{ marginTop: 8 }}>Aucune donnée n'est transmise à des tiers ni utilisée à des fins commerciales.</p>
      </Section>

      <Section title="Durée de conservation">
        <p>
          Les données de pointage sont conservées pendant <strong>12 mois</strong> à compter de leur enregistrement, puis supprimées.
        </p>
      </Section>

      <Section title="Vos droits (RGPD)">
        <p>Conformément au Règlement Général sur la Protection des Données, vous disposez des droits suivants :</p>
        <ul style={{ margin: '8px 0 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li><strong>Droit d'accès</strong> — obtenir une copie de vos données</li>
          <li><strong>Droit de rectification</strong> — corriger des données inexactes</li>
          <li><strong>Droit à l'effacement</strong> — demander la suppression de vos données</li>
          <li><strong>Droit d'opposition</strong> — vous opposer au traitement dans certains cas</li>
          <li><strong>Droit à la limitation</strong> — limiter temporairement le traitement</li>
        </ul>
      </Section>

      <Section title="Exercer vos droits">
        <p>Pour exercer vos droits ou poser une question, adressez votre demande directement à la direction du restaurant.</p>
        <p style={{ marginTop: 8 }}>
          Vous pouvez également déposer une réclamation auprès de la{' '}
          <strong>CNIL</strong> (Commission Nationale de l'Informatique et des Libertés) —{' '}
          <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>www.cnil.fr</a>.
        </p>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{
        margin: '0 0 8px', fontSize: 11, fontWeight: 700,
        color: 'var(--primary)', textTransform: 'uppercase',
        letterSpacing: '0.06em', fontFamily: 'Manrope, sans-serif',
      }}>
        {title}
      </h3>
      <div style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--on-surface-2)' }}>
        {children}
      </div>
    </div>
  )
}
