import { useState } from 'react'

const LAST_UPDATE = '28 avril 2026'

export default function Rgpd() {
  const [tab, setTab] = useState<'cgu' | 'confidentialite'>('cgu')

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--surface)',
      fontFamily: 'Manrope, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        position: 'sticky', top: 0, zIndex: 10,
        padding: '16px 24px 0',
        maxWidth: 680, margin: '0 auto',
      }}>
        <a href="/login" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 13, color: 'var(--primary)', textDecoration: 'none',
          fontWeight: 600, marginBottom: 16,
        }}>← Retour</a>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 24 }}>⚖️</span>
          <div>
            <h1 style={{
              margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--on-surface)',
              letterSpacing: '-0.03em', fontFamily: 'Epilogue, sans-serif',
            }}>Mentions légales — Application Matias</h1>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--on-surface-3)', marginTop: 2 }}>
              Dernière mise à jour : {LAST_UPDATE}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4 }}>
          {([
            { id: 'cgu', label: "Conditions d'utilisation" },
            { id: 'confidentialite', label: 'Confidentialité & RGPD' },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '8px 16px', borderRadius: '10px 10px 0 0',
                border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, fontFamily: 'Manrope, sans-serif',
                background: tab === t.id ? 'var(--primary)' : 'transparent',
                color: tab === t.id ? '#fff' : 'var(--on-surface-3)',
                transition: 'all 0.15s',
              }}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 24px 64px' }}>

        {tab === 'cgu' && (
          <>
            <Section title="1. Présentation">
              <p>
                L'application <strong>Matias</strong> est un outil de gestion interne développé et maintenu
                à titre personnel par <strong>Arthur Kyriazis</strong>, domicilié au 17 rue de Paradis, 75010 Paris
                (ci-après « l'Éditeur »).
              </p>
              <p>
                L'application n'est pas commercialisée. Elle est mise à disposition gratuitement
                aux employés et collaborateurs de l'établissement Yorgios.
              </p>
            </Section>

            <Section title="2. Accès et identifiants">
              <p>
                L'accès est réservé aux personnes disposant d'identifiants valides créés par les administrateurs.
                Chaque utilisateur est responsable de la confidentialité de ses identifiants.
              </p>
              <p>
                Toute utilisation non autorisée doit être signalée immédiatement à{' '}
                <a href="mailto:kyriazis@outlook.fr" style={{ color: 'var(--primary)' }}>kyriazis@outlook.fr</a>.
              </p>
            </Section>

            <Section title="3. Utilisation autorisée">
              <p>L'application est mise à disposition exclusivement à des fins professionnelles :</p>
              <ul>
                <li>Gestion des plannings et pointages</li>
                <li>Suivi des livraisons et traçabilité HACCP</li>
                <li>Gestion des stocks et de la vitrine</li>
                <li>Communication interne</li>
                <li>Suivi des commandes clients</li>
              </ul>
              <p>Il est interdit de :</p>
              <ul>
                <li>Partager ses identifiants avec des tiers non autorisés</li>
                <li>Extraire ou diffuser les données en dehors du cadre professionnel</li>
                <li>Tenter d'accéder à des fonctionnalités non attribuées à son rôle</li>
              </ul>
            </Section>

            <Section title="4. Disponibilité">
              <p>
                L'Éditeur s'efforce d'assurer la disponibilité de l'application mais ne garantit pas
                une disponibilité ininterrompue. Des interruptions pour maintenance peuvent survenir.
                L'Éditeur ne saurait être tenu responsable des dommages liés à une indisponibilité temporaire.
              </p>
            </Section>

            <Section title="5. Responsabilité">
              <p>
                L'utilisateur est seul responsable des données qu'il saisit (températures, DLC, pointages…).
                L'Éditeur ne peut être tenu responsable d'une erreur de saisie ayant des conséquences opérationnelles.
              </p>
            </Section>

            <Section title="6. Propriété intellectuelle">
              <p>
                L'application, son code source, son design et ses contenus sont la propriété exclusive d'Arthur Kyriazis.
                Toute reproduction ou distribution sans autorisation écrite est interdite.
              </p>
            </Section>

            <Section title="7. Modification des CGU">
              <p>
                L'Éditeur se réserve le droit de modifier les présentes CGU à tout moment.
                Les utilisateurs en seront informés via l'application. La poursuite de l'utilisation
                après notification vaut acceptation.
              </p>
            </Section>

            <Section title="8. Droit applicable">
              <p>
                Les présentes CGU sont soumises au droit français. Tout litige relève de la
                compétence des tribunaux de Paris.
              </p>
            </Section>
          </>
        )}

        {tab === 'confidentialite' && (
          <>
            <Section title="1. Responsable du traitement">
              <p>
                <strong>Arthur Kyriazis</strong><br />
                17 rue de Paradis — 75010 Paris<br />
                Email : <a href="mailto:kyriazis@outlook.fr" style={{ color: 'var(--primary)' }}>kyriazis@outlook.fr</a>
              </p>
            </Section>

            <Section title="2. Données collectées">
              <p><strong>Employés :</strong></p>
              <table>
                <thead>
                  <tr><th>Donnée</th><th>Finalité</th></tr>
                </thead>
                <tbody>
                  <tr><td>Nom, prénom, email</td><td>Authentification, notifications</td></tr>
                  <tr><td>Rôle et droits</td><td>Contrôle d'accès</td></tr>
                  <tr><td>Coordonnées GPS</td><td>Vérification présence (pointage uniquement)</td></tr>
                  <tr><td>Horaires pointage</td><td>Gestion du temps de travail</td></tr>
                  <tr><td>Jeton FCM</td><td>Notifications professionnelles push</td></tr>
                  <tr><td>Messages internes</td><td>Communication (TTL 7 jours)</td></tr>
                  <tr><td>Demandes de congés</td><td>Gestion RH</td></tr>
                  <tr><td>Données planning & primes</td><td>Gestion de la paie</td></tr>
                </tbody>
              </table>
              <p style={{ marginTop: 16 }}><strong>Clients (commandes publiques) :</strong></p>
              <table>
                <thead>
                  <tr><th>Donnée</th><th>Finalité</th></tr>
                </thead>
                <tbody>
                  <tr><td>Nom, email, téléphone</td><td>Traitement et suivi de commande</td></tr>
                  <tr><td>Détail commande</td><td>Exécution du contrat</td></tr>
                  <tr><td>Historique fidélité</td><td>Programme de fidélité (opt-in)</td></tr>
                </tbody>
              </table>
            </Section>

            <Section title="3. Bases légales">
              <table>
                <thead>
                  <tr><th>Traitement</th><th>Base légale</th></tr>
                </thead>
                <tbody>
                  <tr><td>Pointages GPS</td><td>Intérêt légitime (Art. 6.1.f RGPD)</td></tr>
                  <tr><td>Planning & gestion du temps</td><td>Exécution du contrat de travail</td></tr>
                  <tr><td>Notifications push</td><td>Intérêt légitime (communication opérationnelle)</td></tr>
                  <tr><td>Traitement des commandes</td><td>Exécution du contrat</td></tr>
                  <tr><td>Programme de fidélité</td><td>Consentement (opt-in)</td></tr>
                </tbody>
              </table>
            </Section>

            <Section title="4. Durée de conservation">
              <table>
                <thead>
                  <tr><th>Donnée</th><th>Durée</th></tr>
                </thead>
                <tbody>
                  <tr><td>Compte employé actif</td><td>Durée du contrat + 1 an</td></tr>
                  <tr><td>Pointages</td><td>5 ans (obligation légale paie)</td></tr>
                  <tr><td>Messages internes</td><td>7 jours (suppression automatique)</td></tr>
                  <tr><td>Relevés température HACCP</td><td>3 ans (réglementation HACCP)</td></tr>
                  <tr><td>Checklists hygiène</td><td>3 ans</td></tr>
                  <tr><td>Lots fabrication / livraisons</td><td>30 jours (configurable)</td></tr>
                  <tr><td>Commandes clients</td><td>5 ans (obligation comptable)</td></tr>
                  <tr><td>Données fidélité</td><td>Jusqu'à désinscription + 3 ans</td></tr>
                </tbody>
              </table>
            </Section>

            <Section title="5. Sous-traitants">
              <p>Vos données transitent par les prestataires suivants, liés par des garanties RGPD :</p>
              <table>
                <thead>
                  <tr><th>Prestataire</th><th>Rôle</th><th>Garantie</th></tr>
                </thead>
                <tbody>
                  <tr><td><strong>Google Firebase</strong></td><td>Infrastructure, Auth, BDD, FCM</td><td>Clauses contractuelles types (SCCs)</td></tr>
                  <tr><td><strong>Brevo</strong></td><td>Emailing, CRM fidélité</td><td>Hébergement UE 🇫🇷</td></tr>
                  <tr><td><strong>Google Gmail</strong></td><td>Emails transactionnels</td><td>Clauses contractuelles types</td></tr>
                  <tr><td><strong>Twilio</strong></td><td>SMS suivi coursier</td><td>Clauses contractuelles types</td></tr>
                </tbody>
              </table>
              <p>Aucune donnée n'est vendue à des tiers.</p>
            </Section>

            <Section title="6. Vos droits">
              <p>Conformément au RGPD, vous disposez des droits suivants :</p>
              <ul>
                <li><strong>Accès</strong> — obtenir une copie de vos données</li>
                <li><strong>Rectification</strong> — corriger des données inexactes</li>
                <li><strong>Effacement</strong> — demander la suppression (sous réserve obligations légales)</li>
                <li><strong>Opposition</strong> — vous opposer à certains traitements</li>
                <li><strong>Portabilité</strong> — recevoir vos données dans un format structuré</li>
                <li><strong>Limitation</strong> — suspendre temporairement un traitement</li>
              </ul>
              <p>
                Pour exercer vos droits, contactez :{' '}
                <a href="mailto:kyriazis@outlook.fr" style={{ color: 'var(--primary)', fontWeight: 600 }}>
                  kyriazis@outlook.fr
                </a>{' '}
                — réponse sous 30 jours.
              </p>
              <p>
                Réclamation possible auprès de la{' '}
                <strong>CNIL</strong> :{' '}
                <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>
                  www.cnil.fr
                </a>{' '}
                — 3 place de Fontenoy, 75007 Paris.
              </p>
            </Section>

            <Section title="7. Sécurité">
              <ul>
                <li>Authentification sécurisée via Firebase Auth</li>
                <li>Chiffrement en transit (HTTPS/TLS) et au repos (Firebase)</li>
                <li>Règles d'accès Firestore par rôle (principe du moindre privilège)</li>
                <li>Pointages écrits uniquement via Cloud Function sécurisée (pas d'écriture client directe)</li>
                <li>Géolocalisation collectée uniquement au moment du pointage, pas en continu</li>
              </ul>
            </Section>

            <Section title="8. Cookies et stockage local">
              <p>
                L'application n'utilise <strong>pas de cookies de tracking ou publicitaires</strong>.
                Seuls sont utilisés :
              </p>
              <ul>
                <li>Stockage local (<code>localStorage</code>) pour les préférences d'interface</li>
                <li>Token Firebase Auth (session authentifiée)</li>
                <li>Jeton FCM (notifications push, uniquement si acceptées par l'appareil)</li>
              </ul>
            </Section>
          </>
        )}
      </div>

      <style>{`
        table {
          width: 100%; border-collapse: collapse;
          font-size: 13px; margin-top: 8px;
        }
        th {
          text-align: left; padding: 8px 12px;
          background: var(--surface-mid);
          font-weight: 700; color: var(--on-surface);
          border-bottom: 1px solid var(--border);
        }
        td {
          padding: 8px 12px;
          border-bottom: 1px solid var(--border-soft);
          color: var(--on-surface-2);
          vertical-align: top;
        }
        tr:last-child td { border-bottom: none; }
        ul { margin: 8px 0 0 0; padding-left: 20px; display: flex; flex-direction: column; gap: 5px; }
        li { line-height: 1.55; }
        p { margin: 0 0 8px; }
        code { font-family: monospace; font-size: 12px; background: var(--surface-mid); padding: 1px 5px; border-radius: 4px; }
      `}</style>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h3 style={{
        margin: '0 0 10px', fontSize: 11, fontWeight: 700,
        color: 'var(--primary)', textTransform: 'uppercase',
        letterSpacing: '0.08em', fontFamily: 'Manrope, sans-serif',
      }}>
        {title}
      </h3>
      <div style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--on-surface-2)' }}>
        {children}
      </div>
    </div>
  )
}
