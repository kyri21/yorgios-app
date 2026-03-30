# Twilio Delivery Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recevoir les SMS Twilio du coursier Pick&Drop, les stocker dans Firestore `deliveries`, et afficher le lien de tracking dans un nouvel onglet "Coursier" de la page Corner/Livraison.tsx.

**Architecture:** Une Cloud Function HTTP `incomingSms` reçoit le webhook Twilio, valide la signature, extrait l'URL de tracking et l'ETA, écrit dans `deliveries`, puis envoie une FCM aux employés pointés. Côté React, un 4ème onglet "Coursier" dans `Livraison.tsx` écoute `deliveries` en temps réel via `onSnapshot` et joue un son Web Audio à chaque nouveau doc.

**Tech Stack:** Firebase Functions v2 (Node 22), twilio npm package (signature validation), Firestore `deliveries` collection, React + onSnapshot, Web Audio API (pas de fichier son).

---

## File Map

| Fichier | Action | Rôle |
|---------|--------|------|
| `functions/package.json` | Modifier | Ajouter dépendance `twilio` |
| `functions/src/index.ts` | Modifier | Ajouter CF `incomingSms` à la fin |
| `firestore.rules` | Modifier | Ajouter règle `deliveries` |
| `firestore.indexes.json` | Modifier | Ajouter index composite `deliveries` |
| `src/modules/corner/pages/Livraison.tsx` | Modifier | Ajouter onglet "Coursier" avec tracking temps réel |

---

## Task 1 : Firestore — règles + index

**Files:**
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`

- [ ] **Step 1.1 : Ajouter la règle `deliveries` dans firestore.rules**

Ouvrir `firestore.rules`. Trouver la section `// ─── Corner ───` (ou n'importe quel bloc existant). Ajouter ce bloc **avant** la dernière accolade fermante du `match /databases/test/documents` :

```
    // ─── Deliveries (suivi Twilio) ────────────────────────────────
    match /deliveries/{id} {
      allow read: if isAuth();
      allow write: if false;  // écriture uniquement via CF backend (Admin SDK)
    }
```

- [ ] **Step 1.2 : Ajouter l'index composite dans firestore.indexes.json**

Remplacer le contenu de `firestore.indexes.json` par :

```json
{
  "indexes": [
    {
      "collectionGroup": "lots_cuisine",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "archived",   "order": "ASCENDING" },
        { "fieldPath": "archivedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "deliveries",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status",    "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

- [ ] **Step 1.3 : Déployer les règles et l'index**

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

Résultat attendu : `✔ Deploy complete!`

- [ ] **Step 1.4 : Commit**

```bash
git add firestore.rules firestore.indexes.json
git commit -m "feat: add Firestore rules and index for deliveries collection"
```

---

## Task 2 : Cloud Function `incomingSms`

**Files:**
- Modify: `functions/package.json`
- Modify: `functions/src/index.ts`

### Contexte sur l'existant

`functions/src/index.ts` a déjà ces utilitaires réutilisables (ne pas les réécrire) :
- `getUidsPointedToday()` — retourne les UIDs des employés pointés aujourd'hui
- `notifyUids(uids, title, body, link)` — envoie FCM aux UIDs

La région est `europe-west1`. La DB Firestore est `test` (déjà dans `const db = getFirestore(app, 'test')`).

Les variables d'env Twilio sont lues depuis `functions/.env` :
- `TWILIO_AUTH_TOKEN`
- `TWILIO_ACCOUNT_SID` (non utilisé dans le code mais documenté)

### Format SMS connu

```
Votre coursier Pick&Drop est en route. Suivez son arrivée : https://pick-and-drop.everst.io/follow/GACW20DTD6 (le coursier est susceptible de faire un détour)
```

- [ ] **Step 2.1 : Ajouter `twilio` dans functions/package.json**

Ouvrir `functions/package.json`. Dans `"dependencies"`, ajouter :

```json
"twilio": "^5.3.0"
```

Résultat final de `"dependencies"` :

```json
"dependencies": {
  "@types/nodemailer": "^7.0.11",
  "firebase-admin": "^12.0.0",
  "firebase-functions": "^7.1.0",
  "googleapis": "^144.0.0",
  "nodemailer": "^8.0.1",
  "twilio": "^5.3.0"
}
```

- [ ] **Step 2.2 : Installer la dépendance**

```bash
cd functions && npm install
```

Résultat attendu : `added N packages` sans erreur.

- [ ] **Step 2.3 : Ajouter les variables Twilio dans functions/.env**

Ouvrir (ou créer) `functions/.env`. Ajouter à la fin :

```
TWILIO_AUTH_TOKEN=xxxx
TWILIO_ACCOUNT_SID=xxxx
```

⚠️ Ces valeurs sont à remplir avec les vraies clés depuis la Twilio Console. Le fichier `.env` est déjà dans `.gitignore`.

- [ ] **Step 2.4 : Ajouter l'import twilio en haut de functions/src/index.ts**

Ajouter après la ligne `import * as nodemailer from 'nodemailer'` :

```typescript
import { validateRequest as twilioValidate } from 'twilio/lib/webhooks/webhooks'
```

- [ ] **Step 2.5 : Ajouter la CF `incomingSms` à la fin de functions/src/index.ts**

Ajouter à la toute fin du fichier :

```typescript
// ─────────────────────────────────────────────────────────────────
// TWILIO — Suivi livraison coursier
// ─────────────────────────────────────────────────────────────────

/**
 * Webhook Twilio — reçoit les SMS du coursier Pick&Drop.
 * Sécurisé par validation de signature Twilio.
 * Écrit dans la collection `deliveries` (Admin SDK) et envoie FCM.
 */
export const incomingSms = onRequest(
  { region: 'europe-west1', cors: false },
  async (req, res) => {
    // ── 1. Méthode
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed')
      return
    }

    // ── 2. Validation signature Twilio
    const authToken = process.env.TWILIO_AUTH_TOKEN || ''
    const signature = req.headers['x-twilio-signature'] as string | undefined

    if (authToken && signature) {
      // Reconstruire l'URL complète telle que Twilio l'a envoyée
      const proto = req.headers['x-forwarded-proto'] || 'https'
      const host  = req.headers['x-forwarded-host'] || req.headers.host || ''
      const url   = `${proto}://${host}${req.originalUrl}`

      const valid = twilioValidate(authToken, signature, url, req.body as Record<string, string>)
      if (!valid) {
        console.warn('incomingSms: invalid Twilio signature')
        res.status(403).send('Forbidden')
        return
      }
    } else {
      // Pas d'authToken configuré → on loggue mais on continue (utile en dev)
      console.warn('incomingSms: TWILIO_AUTH_TOKEN not set, skipping signature check')
    }

    // ── 3. Extraire le corps du SMS
    const body = req.body as Record<string, string>
    const rawMessage: string = body.Body || ''
    const phoneNumber: string = body.From || ''

    if (!rawMessage) {
      res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
      return
    }

    console.log(`incomingSms from ${phoneNumber}: ${rawMessage}`)

    // ── 4. Parser l'URL de tracking (Pick&Drop en priorité, fallback générique)
    const pickDropMatch = rawMessage.match(/https:\/\/pick-and-drop\.everst\.io\/follow\/\w+/)
    const genericMatch  = rawMessage.match(/https?:\/\/\S+/)
    const trackingUrl: string | null = (pickDropMatch?.[0] || genericMatch?.[0] || null)

    // ── 5. Parser l'ETA (ex: "14:30" ou "14h30")
    const etaMatch = rawMessage.match(/\b(\d{1,2})[h:](\d{2})\b/)
    const eta: string | null = etaMatch ? `${etaMatch[1]}:${etaMatch[2]}` : null

    // ── 6. Déduplication : si un doc `in_progress` avec ce trackingUrl existe déjà → update
    if (trackingUrl) {
      const existing = await db.collection('deliveries')
        .where('trackingUrl', '==', trackingUrl)
        .where('status', '==', 'in_progress')
        .limit(1)
        .get()

      if (!existing.empty) {
        await existing.docs[0].ref.update({
          rawMessage,
          updatedAt: Timestamp.now(),
          ...(eta ? { eta } : {}),
        })
        console.log(`incomingSms: updated existing delivery ${existing.docs[0].id}`)
        res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
        return
      }
    }

    // ── 7. Créer un nouveau doc `deliveries`
    const now = Timestamp.now()
    await db.collection('deliveries').add({
      trackingUrl,
      rawMessage,
      phoneNumber,
      eta,
      status: 'in_progress',
      createdAt: now,
      updatedAt: now,
    })

    // ── 8. FCM aux employés pointés aujourd'hui
    try {
      const uids = await getUidsPointedToday()
      const etaLabel = eta ? ` — ETA ${eta}` : ''
      await notifyUids(
        uids,
        '🚚 Livraison en cours',
        `Coursier en route${etaLabel}`,
        '/corner/livraison',
      )
    } catch (e) {
      console.error('incomingSms: FCM error', e)
      // Ne pas bloquer la réponse Twilio
    }

    // ── 9. Réponse TwiML vide (pas de SMS de retour)
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
  },
)
```

- [ ] **Step 2.6 : Compiler et vérifier qu'il n'y a pas d'erreurs TypeScript**

```bash
cd functions && npm run build
```

Résultat attendu : pas d'erreur TypeScript, fichiers générés dans `functions/lib/`.

- [ ] **Step 2.7 : Déployer la fonction**

```bash
cd functions && npm run build && cd .. && firebase deploy --only functions:incomingSms
```

Résultat attendu :
```
✔  functions[incomingSms(europe-west1)] Successful create operation.
✔  Deploy complete!
```

Noter l'URL de la fonction dans la console Firebase (ex: `https://europe-west1-cuisine-yorgios.cloudfunctions.net/incomingSms`). C'est cette URL à configurer dans la Twilio Console comme webhook SMS entrant.

- [ ] **Step 2.8 : Commit**

```bash
git add functions/package.json functions/package-lock.json functions/src/index.ts
git commit -m "feat: add incomingSms Cloud Function for Twilio Pick&Drop tracking"
```

---

## Task 3 : Onglet "Coursier" dans Livraison.tsx

**Files:**
- Modify: `src/modules/corner/pages/Livraison.tsx`

### Contexte sur l'existant

`Livraison.tsx` a :
- Un `tab` state de type `'today' | 'historique' | 'galerie'`
- Une barre d'onglets inline avec `.map()` sur un tableau de `{ key, label }`
- Les imports Firestore sont : `Timestamp, addDoc, collection, getDocs, getDoc, doc, limit, orderBy, query, updateDoc, where`
- Les imports Firebase sont : `db, auth, storage` depuis `'../../../firebase/config'`

Il faut ajouter `onSnapshot` aux imports Firestore, et le type `Unsubscribe` pour le cleanup.

### Type Delivery

```typescript
type DeliveryDoc = {
  id: string
  trackingUrl: string | null
  rawMessage: string
  phoneNumber: string
  eta: string | null
  status: 'in_progress' | 'completed'
  createdAt: any
  updatedAt: any
}
```

### Fonction ding (Web Audio API)

```typescript
function playDing() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 1.0)
  } catch {
    // AudioContext non supporté — silencieux
  }
}
```

- [ ] **Step 3.1 : Ajouter `onSnapshot` et `Unsubscribe` aux imports Firestore**

Dans `Livraison.tsx`, trouver la ligne :

```typescript
import { Timestamp, addDoc, collection, getDocs, getDoc, doc, limit, orderBy, query, updateDoc, where } from 'firebase/firestore'
```

Remplacer par :

```typescript
import { Timestamp, addDoc, collection, getDocs, getDoc, doc, limit, onSnapshot, orderBy, query, updateDoc, where, type Unsubscribe } from 'firebase/firestore'
```

- [ ] **Step 3.2 : Ajouter le type `DeliveryDoc` après les types existants**

Après la ligne `type PhotoModal = { url: string; label: string }`, ajouter :

```typescript
type DeliveryDoc = {
  id: string
  trackingUrl: string | null
  rawMessage: string
  phoneNumber: string
  eta: string | null
  status: 'in_progress' | 'completed'
  createdAt: any
  updatedAt: any
}
```

- [ ] **Step 3.3 : Ajouter la fonction `playDing` avant le composant**

Après les fonctions utilitaires `todayStart` et `toLocalDateValue`, ajouter :

```typescript
function playDing() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 1.0)
  } catch {
    // AudioContext non supporté — silencieux
  }
}
```

- [ ] **Step 3.4 : Étendre le type du tab state**

Trouver :

```typescript
const [tab, setTab] = useState<'today' | 'historique' | 'galerie'>('today')
```

Remplacer par :

```typescript
const [tab, setTab] = useState<'today' | 'historique' | 'galerie' | 'coursier'>('today')
```

- [ ] **Step 3.5 : Ajouter le state pour les livraisons coursier**

Après la ligne `const [photoModal, setPhotoModal] = useState<PhotoModal | null>(null)`, ajouter :

```typescript
// --- Coursier (Twilio) ---
const [deliveries, setDeliveries] = useState<DeliveryDoc[]>([])
const [deliveryLoading, setDeliveryLoading] = useState(false)
const [prevDeliveryCount, setPrevDeliveryCount] = useState<number | null>(null)
```

- [ ] **Step 3.6 : Ajouter le useEffect onSnapshot pour les livraisons actives**

Après le bloc `useEffect(() => { if (tab === 'galerie') loadGalerie() }, [tab, galFrom, galTo])`, ajouter :

```typescript
useEffect(() => {
  if (tab !== 'coursier') return
  setDeliveryLoading(true)
  const q = query(
    collection(db, 'deliveries'),
    where('status', '==', 'in_progress'),
    orderBy('createdAt', 'desc'),
  )
  const unsub: Unsubscribe = onSnapshot(q, snap => {
    const docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<DeliveryDoc, 'id'>) }))
    setDeliveries(docs)
    setDeliveryLoading(false)
    // Jouer le son seulement si de nouveaux docs sont apparus (pas au montage initial)
    setPrevDeliveryCount(prev => {
      if (prev !== null && docs.length > prev) playDing()
      return docs.length
    })
  }, () => setDeliveryLoading(false))
  return () => unsub()
}, [tab])
```

- [ ] **Step 3.7 : Ajouter le WakeLock**

Après le `useEffect` du coursier, ajouter :

```typescript
useEffect(() => {
  if (tab !== 'coursier') return
  let lock: WakeLockSentinel | null = null
  navigator.wakeLock?.request('screen').then(l => { lock = l }).catch(() => {})
  return () => { lock?.release().catch(() => {}) }
}, [tab])
```

- [ ] **Step 3.8 : Ajouter la fonction `markDeliveryDone`**

Après la fonction `handleNonConformite`, ajouter :

```typescript
async function markDeliveryDone(id: string) {
  await updateDoc(doc(db, 'deliveries', id), { status: 'completed', updatedAt: Timestamp.now() })
}
```

- [ ] **Step 3.9 : Ajouter l'onglet "Coursier" à la barre de navigation**

Trouver le tableau inline de la barre d'onglets :

```typescript
{([
  { key: 'today', label: "Aujourd'hui" },
  { key: 'historique', label: 'Historique' },
  { key: 'galerie', label: 'Galerie' },
] as const).map(({ key, label }) => (
```

Remplacer par :

```typescript
{([
  { key: 'today', label: "Aujourd'hui" },
  { key: 'historique', label: 'Historique' },
  { key: 'galerie', label: 'Galerie' },
  { key: 'coursier', label: '🚚 Coursier' },
] as const).map(({ key, label }) => (
```

- [ ] **Step 3.10 : Ajouter le contenu de l'onglet "Coursier"**

Trouver la fermeture de l'onglet Galerie `)}` juste avant le retour de la modale photo (chercher la ligne `{/* ════════════════ GALERIE ════════════════ */}` et le bloc qui suit, jusqu'à `}`). Ajouter le bloc Coursier **juste après** la fermeture du bloc Galerie et **avant** la section modale photo :

```typescript
      {/* ════════════════ COURSIER ════════════════ */}
      {tab === 'coursier' && (
        <>
          {deliveryLoading && (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          )}

          {!deliveryLoading && deliveries.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '44px 24px' }}>
              <div style={{ fontSize: 44, marginBottom: 14, lineHeight: 1 }}>🛵</div>
              <p style={{
                fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 17,
                color: 'var(--on-surface)', margin: '0 0 8px',
              }}>
                Aucun coursier en route
              </p>
              <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0, lineHeight: 1.5 }}>
                Quand un SMS de suivi est reçu, il apparaît ici automatiquement.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {deliveries.map(d => {
              const createdAt = d.createdAt?.toDate
                ? d.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '—'
              return (
                <div key={d.id} className="card" style={{ border: '1.5px solid rgba(0,66,117,0.15)' }}>
                  {/* En-tête */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <div style={{
                        fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 16,
                        color: 'var(--on-surface)',
                      }}>
                        Coursier en route
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 2 }}>
                        SMS reçu à {createdAt}
                      </div>
                    </div>
                    <span className="chip-warn">En cours</span>
                  </div>

                  {/* ETA */}
                  {d.eta && (
                    <div style={{
                      background: 'rgba(0,66,117,0.05)', borderRadius: 10,
                      padding: '10px 14px', marginBottom: 14,
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span style={{ fontSize: 18 }}>⏱</span>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--on-surface-3)', fontWeight: 600 }}>ETA estimée</div>
                        <div style={{
                          fontFamily: 'Epilogue, sans-serif', fontSize: 22, fontWeight: 800,
                          color: 'var(--primary)', letterSpacing: '-0.02em',
                        }}>
                          {d.eta}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Boutons */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {d.trackingUrl && (
                      <a
                        href={d.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-primary"
                        style={{ textAlign: 'center', textDecoration: 'none', display: 'block' }}
                      >
                        Suivre le coursier →
                      </a>
                    )}
                    <button
                      className="btn-secondary"
                      onClick={() => markDeliveryDone(d.id)}
                    >
                      Livraison terminée
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
```

- [ ] **Step 3.11 : Vérifier que le build TypeScript passe**

```bash
npm run build
```

(ou si pas de script build frontend : `npx tsc --noEmit`)

Résultat attendu : 0 erreurs TypeScript.

- [ ] **Step 3.12 : Tester localement**

```bash
npm run dev
```

- Aller sur `/corner/livraison`
- Vérifier que l'onglet "🚚 Coursier" apparaît
- Vérifier le empty state
- Créer manuellement un doc dans Firestore Console :
  ```json
  {
    "trackingUrl": "https://pick-and-drop.everst.io/follow/TEST123",
    "rawMessage": "Test SMS",
    "phoneNumber": "+33600000000",
    "eta": "14:30",
    "status": "in_progress",
    "createdAt": <Timestamp now>,
    "updatedAt": <Timestamp now>
  }
  ```
- Vérifier que la carte apparaît immédiatement (onSnapshot)
- Cliquer "Suivre le coursier →" → ouvre le lien
- Cliquer "Livraison terminée" → la carte disparaît

- [ ] **Step 3.13 : Commit**

```bash
git add src/modules/corner/pages/Livraison.tsx
git commit -m "feat: add Coursier tab to Livraison page with real-time Twilio tracking"
```

---

## Task 4 : Déploiement final

- [ ] **Step 4.1 : Build et deploy hosting**

```bash
npm run build && firebase deploy --only hosting
```

- [ ] **Step 4.2 : Configurer le webhook Twilio**

Dans la [Twilio Console](https://console.twilio.com) → Phone Numbers → le numéro SMS → "A Message Comes In" :
- URL : `https://europe-west1-cuisine-yorgios.cloudfunctions.net/incomingSms`
- Méthode : `HTTP POST`

- [ ] **Step 4.3 : Test end-to-end**

Envoyer un SMS au numéro Twilio depuis un téléphone :
```
Votre coursier Pick&Drop est en route. Suivez son arrivée : https://pick-and-drop.everst.io/follow/TEST001 (le coursier est susceptible de faire un détour)
```

Vérifications :
1. Le doc apparaît dans Firestore `deliveries`
2. La carte s'affiche dans l'onglet Coursier
3. Le son ding se joue (si quelqu'un est sur la page)
4. La FCM arrive sur les téléphones des employés pointés

- [ ] **Step 4.4 : Commit final**

```bash
git add -A
git commit -m "feat: deploy Twilio delivery tracking — incomingSms CF + Coursier tab"
```
