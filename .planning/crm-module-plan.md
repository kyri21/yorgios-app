# Plan CRM Module — À reprendre

## Statut
- [x] Analyse codebase complète
- [x] functions/src/domain/loyalty.ts — CRÉÉ
- [x] functions/src/crm/index.ts — CRÉÉ (syncContact, syncOrder, checkLoyalty, validatePromoCode, markPromoCodeUsed)
- [x] Update functions/src/index.ts — ajouter exports CRM + étendre onCommandeUpdated
- [x] src/modules/crm/types.ts
- [x] src/modules/crm/hooks/useCaptation.ts
- [x] src/modules/crm/CaptationPage.tsx
- [x] Update src/router/index.tsx
- [x] Update src/components/Layout.tsx (sidebar link)
- [x] Update src/components/ModuleGridPanel.tsx (corner grid item)
- [x] Update src/modules/corner/pages/Commandes.tsx (promo code)

## Secrets Firebase à configurer (commandes à lancer AVANT déploiement)
```bash
firebase functions:secrets:set BREVO_API_KEY
# valeur : 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

firebase functions:secrets:set BREVO_LIST_ID
# valeur : 3

firebase functions:secrets:set YORGIOS_WP_SECRET
# valeur : choisir un secret fort (ex: openssl rand -hex 32)

# Twilio (optionnel — WhatsApp)
firebase functions:secrets:set TWILIO_ACCOUNT_SID
firebase functions:secrets:set TWILIO_AUTH_TOKEN
firebase functions:secrets:set TWILIO_WHATSAPP_FROM
```

## Ce qu'il faut ajouter dans functions/src/index.ts

À la fin du fichier, après les imports existants, ajouter :

```typescript
import { onRequest } from 'firebase-functions/v2/https'
import {
  syncContactToBrevoLogic,
  syncOrderToBrevoLogic,
  validatePromoCodeLogic,
  markPromoCodeUsed,
  normalizePhone,
} from './crm'

// ── CRM — Captation contact Brevo ─────────────────────────────────
export const syncContactToBrevo = onCall(
  { region: 'europe-west1', secrets: ['BREVO_API_KEY', 'BREVO_LIST_ID'] },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Authentification requise')
    return syncContactToBrevoLogic(req.data)
  }
)

// ── CRM — Validation code promo (Matias) ──────────────────────────
export const validatePromoCode = onCall(
  { region: 'europe-west1', secrets: ['BREVO_API_KEY'] },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Authentification requise')
    return validatePromoCodeLogic(req.data.clientPhone, req.data.code)
  }
)

// ── CRM — Validation code promo (WordPress, header secret) ────────
export const validatePromoCodePublic = onRequest(
  { region: 'europe-west1', secrets: ['YORGIOS_WP_SECRET'], cors: true },
  async (req, res) => {
    const secret = req.headers['x-yorgios-secret']
    if (!secret || secret !== process.env.YORGIOS_WP_SECRET) {
      res.status(403).json({ error: 'Forbidden' }); return
    }
    const result = await validatePromoCodeLogic(req.body.clientPhone, req.body.code)
    res.json(result)
  }
)
```

Et dans le bloc `after.statut === 'Livrée'` de `onCommandeUpdated`, ajouter APRÈS la notif existante :

```typescript
    // CRM : sync commande + fidélité
    if (after.telephone) {
      try {
        await syncOrderToBrevoLogic(event.params.cmdId, after)
        // Marquer le code promo utilisé si présent
        if (after.promoCode && after.telephone) {
          await markPromoCodeUsed(after.telephone, after.promoCode)
        }
      } catch (e) {
        console.error('[CRM] Erreur sync commande Brevo:', e)
      }
    }
```

Et ajouter `syncOrderToBrevoLogic` aux secrets de `onCommandeUpdated` :
```typescript
export const onCommandeUpdated = onDocumentUpdated(
  { document: 'commandes_externes/{cmdId}', region: 'europe-west1', database: 'test',
    secrets: ['BREVO_API_KEY', 'YORGIOS_WP_SECRET'] },
  ...
)
```

## src/modules/crm/types.ts
```typescript
export interface ContactPayload {
  prenom: string
  telephone: string       // E.164
  whatsappOptIn: boolean
  emailOptIn: boolean
  source: 'corner_matias'
  vendeurUid: string
  capturedAt: string      // ISO string
}

export interface PromoValidationResult {
  valid: boolean
  discountPercent?: number
  error?: string
}
```

## src/modules/crm/hooks/useCaptation.ts
```typescript
import { useState } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { useAuth } from '../../../auth/useAuth'
import type { ContactPayload } from '../types'

function normalizePhone(raw: string): string | null {
  const c = raw.replace(/[\s\-\.\(\)]/g, '')
  if (/^06\d{8}$/.test(c)) return '+33' + c.slice(1)
  if (/^07\d{8}$/.test(c)) return '+33' + c.slice(1)
  if (/^\+33[67]\d{8}$/.test(c)) return c
  return null
}

export function useCaptation() {
  const { user } = useAuth()
  const [status, setStatus] = useState<'idle'|'loading'|'success'|'error'>('idle')
  const [error, setError] = useState<string|null>(null)

  async function submit(prenom: string, telephone: string, whatsappOptIn: boolean, emailOptIn: boolean) {
    if (!navigator.onLine) {
      setError('Pas de connexion réseau. Réessayez dans un instant.')
      setStatus('error')
      return false
    }
    const e164 = normalizePhone(telephone)
    if (!e164) {
      setError('Numéro invalide. Format accepté : 06XXXXXXXX ou +336XXXXXXXX')
      setStatus('error')
      return false
    }
    setStatus('loading')
    setError(null)
    try {
      const fns = getFunctions(undefined, 'europe-west1')
      const syncFn = httpsCallable(fns, 'syncContactToBrevo')
      const payload: ContactPayload = {
        prenom: prenom.trim(),
        telephone: e164,
        whatsappOptIn,
        emailOptIn,
        source: 'corner_matias',
        vendeurUid: user?.uid ?? '',
        capturedAt: new Date().toISOString(),
      }
      await syncFn(payload)
      setStatus('success')
      return true
    } catch (e: any) {
      setError(e?.message ?? 'Erreur lors de la synchronisation')
      setStatus('error')
      return false
    }
  }

  function reset() { setStatus('idle'); setError(null) }

  return { submit, status, error, reset }
}
```

## CaptationPage.tsx — structure
- Route /crm/captation, rôles: corner, manager, patron, administrateur
- 4 champs: prenom (texte requis), telephone (requis, validé), whatsappOptIn (toggle), emailOptIn (toggle)
- Design dark iOS identique au reste de l'app
- Reset auto après succès (Toast succès)
- Si !navigator.onLine → message d'erreur, pas d'appel CF

## ModuleGridPanel.tsx — corner item CRM
Ajouter dans CORNER_ITEMS après '/corner/planning' :
```typescript
{ path: '/crm/captation', label: 'CRM', color: '#FF6B35', icon: <IconCRM /> }
```
Icône SVG contact/personne+plus.

## Router src/router/index.tsx
Ajouter avant le 404 :
```typescript
import CaptationPage from '../modules/crm/CaptationPage'
...
<Route
  path="/crm/captation"
  element={
    <AuthGuard allowedRoles={['patron', 'administrateur', 'manager', 'corner']}>
      <Layout><CaptationPage /></Layout>
    </AuthGuard>
  }
/>
```

## Layout.tsx — sidebar link CRM
Ajouter pour patron/admin/manager (avant "Fiche allergènes") :
```tsx
{user && ['patron', 'administrateur', 'manager'].includes(user.role) && (
  <div style={{ padding: '0 8px 4px' }}>
    <NavLink to="/crm/captation" style={({ isActive }) => sidebarItemStyle(isActive)} ...>
      <span>👥</span>
      <span>CRM Captation</span>
    </NavLink>
  </div>
)}
```

## Commandes.tsx — promo code
Dans NouvelleCommande, ajouter :
- State: promoCode='', promoDiscount=0, promoChecked=false, promoError=''
- Champ après prixEstime: input "Code fidélité (optionnel)"
- Bouton "Vérifier" → httpsCallable validatePromoCode({ clientPhone: form.telephone, code: promoCode })
- Si valid: badge vert "-X%" + affiche prix réduit
- Dans addDoc: promoCode, discountPercent: promoDiscount, totalBeforeDiscount: form.prixEstime

## NE PAS DÉPLOYER avant validation Alexandre/Arthur
