# Multi-Features — Documents GMAO, Vitrine, Ruptures, Fabrication, WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 10 chantiers : module Documents (GMAO + CRETA GEL), fixes UI Vitrine (pastilles, header, retour cuisine), logique ruptures weekend, fabrication filtre viande, permissions tous rôles, commandes accès global + filtre date, suppression notifications cuisine TooGoodToGo/plats du jour, lien WhatsApp Timour.

**Architecture:** Modifications concentrées sur 8 fichiers existants + 1 nouvelle page (`AdminDocuments.tsx`) + 2 Cloud Functions + Firestore rules. Aucune refonte structurelle.

**Tech Stack:** React + TypeScript, Firebase Firestore/Storage/Functions, Tailwind via design system `Aegean Precision`, wa.me deep links, Nodemailer (functions).

---

## Fichiers modifiés / créés

| Fichier | Rôle |
|---------|------|
| `src/modules/corner/pages/Vitrine.tsx` | Fix pastilles + header + bug retour cuisine |
| `src/modules/cuisine/pages/Dashboard.tsx` | Fix fenêtre ruptures weekend |
| `src/modules/cuisine/pages/Fabrication.tsx` | Filtre viande + badge 4j + permissions tous rôles |
| `src/modules/corner/pages/Ruptures.tsx` | Lien WhatsApp après envoi |
| `src/modules/corner/pages/Commandes.tsx` | Filtre date (cette semaine / ce mois) |
| `src/modules/cuisine/index.tsx` | Ajouter route Commandes + nav |
| `src/router/index.tsx` | Route `/commandes` tous rôles + `/admin/documents` |
| `src/pages/AdminDocuments.tsx` | **Nouveau** — GMAO + CRETA GEL |
| `src/components/Layout.tsx` | Lien Documents dans sidebar patron/admin |
| `firestore.rules` | Rules `gmao_demandes` + `creta_gel_docs` |
| `functions/src/index.ts` | CF `gmaoWeeklyReminder` + `sendGmaoEmail` + fix notifPlatsJour/Cartons |

---

## Task 1: Fix Vitrine — pastilles couleurs + header colonnes

**Files:**
- Modify: `src/modules/corner/pages/Vitrine.tsx`

- [ ] **Step 1 : Changer `dlcChip` — "AUJ." orange, "DEMAIN" violet**

Localiser la fonction `dlcChip` (ligne ~452) et remplacer :

```tsx
function dlcChip(st: 'expire' | 'today' | 'tomorrow' | 'ok') {
  if (st === 'expire')   return <span className="chip-danger">Expiré</span>
  if (st === 'today')    return (
    <span style={{
      fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 99,
      background: 'rgba(230,126,34,0.15)', color: '#e67500',
      letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}>AUJ.</span>
  )
  if (st === 'tomorrow') return (
    <span style={{
      fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 99,
      background: 'rgba(142,68,173,0.13)', color: '#8e44ad',
      letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}>DEMAIN</span>
  )
  return <span className="chip-ok">OK</span>
}
```

- [ ] **Step 2 : Élargir les colonnes "FABRICATION" et "DLC" dans les tables DLC dépassée/du jour**

Les deux tables (expired + today) utilisent `gridTemplateColumns: '1fr 52px 52px 44px'`. Remplacer par `'1fr 60px 60px 64px'` (2 occurrences dans le header + 2 dans chaque row = 4 occurrences totales). Chercher `gridTemplateColumns: '1fr 52px 52px 44px'` → remplacer toutes par `'1fr 60px 60px 64px'`.

- [ ] **Step 3 : Vérifier visuellement que "Retirer" ne déborde plus**

Le bouton Retirer dans les tables a `whiteSpace: 'nowrap'` — avec la colonne à 64px c'est suffisant. Vérifier que dans la liste stock principal (ligne ~1062) le bouton a aussi `padding: '4px 10px'` (déjà présent).

- [ ] **Step 4 : Commit**

```bash
git add src/modules/corner/pages/Vitrine.tsx
git commit -m "fix(vitrine): pastilles AUJ.=orange DEMAIN=violet, colonnes header +12px"
```

---

## Task 2: Fix Vitrine — bug retour cuisine (lot sans lotCode)

**Files:**
- Modify: `src/modules/corner/pages/Vitrine.tsx`

**Contexte du bug :** Quand `renvoyerCuisine` est appelé sur un item sans `lotCode`, le `lots_cuisine` doc reste `sent=true` → réapparaît dans le mode "📦 Lot cuisine". Fix : chercher par `productName` si pas de `lotCode`.

- [ ] **Step 1 : Modifier la fonction `renvoyerCuisine` (~ligne 418)**

Remplacer :

```tsx
async function renvoyerCuisine(item: StockItem) {
  await updateDoc(doc(db, 'corner_stock', item.id), {
    active: false,
    retireAt: Timestamp.now(),
    retireBy: auth.currentUser?.uid || '',
    retireReason: 'returned_to_kitchen',
  })
  // Si l'item vient d'un lot cuisine, remettre sent à false pour qu'il réapparaisse côté cuisine
  if (item.lotCode) {
    try {
      const snap = await getDocs(query(
        collection(db, 'lots_cuisine'),
        where('lotCode', '==', item.lotCode),
        limit(1),
      ))
      if (!snap.empty) {
        await updateDoc(snap.docs[0].ref, { sent: false, sentToCornerAt: null })
      }
    } catch { /* silencieux */ }
  }
  show(`"${item.productName}" renvoyé en cuisine`)
  await load()
}
```

Par :

```tsx
async function renvoyerCuisine(item: StockItem) {
  await updateDoc(doc(db, 'corner_stock', item.id), {
    active: false,
    retireAt: Timestamp.now(),
    retireBy: auth.currentUser?.uid || '',
    retireReason: 'returned_to_kitchen',
  })
  try {
    // Chercher d'abord par lotCode, sinon par productName (lots ajoutés sans code)
    let lotsSnap
    if (item.lotCode) {
      lotsSnap = await getDocs(query(
        collection(db, 'lots_cuisine'),
        where('lotCode', '==', item.lotCode),
        limit(1),
      ))
    } else {
      lotsSnap = await getDocs(query(
        collection(db, 'lots_cuisine'),
        where('productName', '==', item.productName),
        where('sent', '==', true),
        limit(1),
      ))
    }
    if (!lotsSnap.empty) {
      await updateDoc(lotsSnap.docs[0].ref, { sent: false, sentToCornerAt: null })
    }
  } catch { /* silencieux */ }
  show(`"${item.productName}" renvoyé en cuisine`)
  await load()
}
```

- [ ] **Step 2 : Commit**

```bash
git add src/modules/corner/pages/Vitrine.tsx
git commit -m "fix(vitrine): retour cuisine reset sent=false même sans lotCode"
```

---

## Task 3: Fix Dashboard cuisine — ruptures weekend (Sam+Dim cumulées jusqu'à lundi midi)

**Files:**
- Modify: `src/modules/cuisine/pages/Dashboard.tsx`

**Règle :** Si aujourd'hui est lundi ET heure < 12h → fenêtre depuis samedi 13h. Sinon règle normale (avant 10h → hier 13h, après 10h → aujourd'hui 0h).

- [ ] **Step 1 : Remplacer le calcul de `cutoffStart` (~ligne 224)**

Localiser le `useEffect` qui crée `cutoffStart` et construit la query `ruptures_actives`. Remplacer :

```ts
const cutoffStart = new Date()
cutoffStart.setDate(cutoffStart.getDate() - 1)
cutoffStart.setHours(13, 0, 0, 0)
```

Par :

```ts
const now = new Date()
const dow = now.getDay() // 0=dim, 1=lun
const hour = now.getHours()

const cutoffStart = new Date(now)
if (dow === 1 && hour < 12) {
  // Lundi avant midi → depuis samedi 13h (2 jours avant)
  cutoffStart.setDate(now.getDate() - 2)
  cutoffStart.setHours(13, 0, 0, 0)
} else if (hour < 10) {
  // Avant 10h → depuis hier 13h
  cutoffStart.setDate(now.getDate() - 1)
  cutoffStart.setHours(13, 0, 0, 0)
} else {
  // Après 10h → depuis minuit aujourd'hui
  cutoffStart.setHours(0, 0, 0, 0)
}
```

- [ ] **Step 2 : Commit**

```bash
git add src/modules/cuisine/pages/Dashboard.tsx
git commit -m "fix(dashboard-cuisine): ruptures cumulent sam+dim jusqu'à lundi midi"
```

---

## Task 4: Fabrication depuis réception — filtre viande + badge 4j

**Files:**
- Modify: `src/modules/cuisine/pages/Fabrication.tsx`

**Contexte :** Le mode "depuis réception" charge toutes les réceptions. On veut uniquement `gepCategory IN ['VIANDE', 'VIANDE_HACHEE']` + masquer celles > 4 jours (avec toggle pour les afficher).

- [ ] **Step 1 : Lire Fabrication.tsx lignes 100-250 pour localiser le chargement des réceptions**

```bash
sed -n '100,250p' src/modules/cuisine/pages/Fabrication.tsx
```

Repérer la fonction qui charge `receptions` (probablement `loadReceptions`).

- [ ] **Step 2 : Ajouter l'état `showExpiredReceptions`**

Dans le bloc d'états (après `const [receptionsLoaded, setReceptionsLoaded] = useState(false)`) ajouter :

```tsx
const [showExpiredReceptions, setShowExpiredReceptions] = useState(false)
```

- [ ] **Step 3 : Filtrer la requête Firestore par gepCategory viande**

Localiser la query qui charge `receptions` (collection `receptions`). Modifier pour ne charger que les réceptions avec `gepCategory` viande. Ajouter un filtre JS sur `category` (le champ Firestore de la réception) :

```tsx
// Après avoir récupéré les docs réceptions :
const VIANDE_CATS = ['VIANDE', 'VIANDE_HACHEE']
const fourDaysAgo = new Date()
fourDaysAgo.setDate(fourDaysAgo.getDate() - 4)

const allReceptions = snap.docs
  .map(d => ({ id: d.id, ...(d.data() as any) })) as ReceptionSource[]

// Filtrer : uniquement viande + gepCategory
const filtered = allReceptions.filter(r => {
  const cat = (r.category || '').toUpperCase()
  return VIANDE_CATS.some(vc => cat.includes(vc.replace('_', ''))) ||
    VIANDE_CATS.includes(cat)
})
setReceptions(filtered)
```

Note : le champ `category` dans `receptions` correspond à `gepCategory` du catalogue. Vérifier en lisant les docs Firestore si le champ s'appelle `category` ou `gepCategory`. Adapter.

- [ ] **Step 4 : Dans le rendu de la liste réceptions, ajouter le badge "⚠️ Périmé (>4j)" et le toggle**

Localiser l'endroit où `receptions` est rendue (mode `reception` dans le formulaire). Envelopper la liste avec :

```tsx
{/* Toggle voir périmés */}
<button
  onClick={() => setShowExpiredReceptions(v => !v)}
  style={{
    background: 'none', border: 'none', color: 'var(--on-surface-3)',
    fontSize: 12, cursor: 'pointer', padding: '4px 0', fontFamily: 'Manrope, sans-serif',
  }}
>
  {showExpiredReceptions ? '▲ Masquer périmés' : `▼ Voir réceptions > 4j`}
</button>

{receptions
  .filter(r => {
    const receivedAt = r.receivedAt?.toDate?.() ?? null
    const isExpired = receivedAt && receivedAt < fourDaysAgo
    return showExpiredReceptions ? true : !isExpired
  })
  .map(r => {
    const receivedAt = r.receivedAt?.toDate?.() ?? null
    const isExpired = receivedAt && new Date(receivedAt) < fourDaysAgo
    return (
      <div key={r.id} style={{ /* style existant */ }}>
        {/* contenu existant */}
        {isExpired && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
            background: 'rgba(192,57,43,0.12)', color: 'var(--danger)', marginLeft: 6,
          }}>
            ⚠️ +4j
          </span>
        )}
      </div>
    )
  })
}
```

- [ ] **Step 5 : Commit**

```bash
git add src/modules/cuisine/pages/Fabrication.tsx
git commit -m "feat(fabrication): réception filtrée viande uniquement, badge >4j"
```

---

## Task 5: Fabrication — lots visibles + permissions tous rôles

**Files:**
- Modify: `src/modules/cuisine/pages/Fabrication.tsx`

**Problème :** Des lots dans `livraisons` (sent=true) ne sont pas visibles dans Fabrication. La cause probable est un filtre `where('archived','==',false)` trop restrictif. De plus, supprimer/modifier devrait être possible pour tous les rôles.

- [ ] **Step 1 : Lire Fabrication.tsx lignes 250-400 pour voir la liste des lots**

```bash
sed -n '250,400p' src/modules/cuisine/pages/Fabrication.tsx
```

Repérer la query qui charge `lots_cuisine` pour la liste (pas Dashboard). Elle utilise probablement `where('archived','==',false)`.

- [ ] **Step 2 : Étendre le filtre pour inclure les lots sent=true et non archivés définitivement**

Si la query actuelle est :
```ts
query(collection(db, 'lots_cuisine'), where('archived', '==', false), ...)
```

Changer pour charger TOUS les lots non archivés OU les lots `sent=true` récents :
```ts
// Charger lots non archivés (inclut sent=true ET sent=false)
query(
  collection(db, 'lots_cuisine'),
  where('archived', '==', false),
  orderBy('producedAt', 'desc'),
  limit(100),
)
```

Si le filtre était déjà ça, vérifier si `sent=true` met `archived=true` quelque part (dans Livraison.tsx cuisine). Si oui, changer ce comportement : `sent=true` ne doit PAS archiver automatiquement.

- [ ] **Step 3 : Supprimer la restriction de rôle sur delete/modifier**

Chercher dans Fabrication.tsx des checks de rôle du type `user?.role === 'patron'` ou `['patron','administrateur','manager'].includes(user?.role)` autour des boutons supprimer/modifier. Retirer ces checks pour que tous les rôles puissent supprimer/modifier.

- [ ] **Step 4 : Commit**

```bash
git add src/modules/cuisine/pages/Fabrication.tsx
git commit -m "fix(fabrication): lots sent=true visibles, delete/modify tous rôles"
```

---

## Task 6: Notifications cuisine — retirer TooGoodToGo + plats du jour (côté cuisine)

**Files:**
- Modify: `functions/src/index.ts`

**Contexte :** Les CF `notifPlatsJour` (11h) et `notifCartonsChambrefroide` (9h30) envoient des FCM à `cuisine` et `corner`. L'utilisateur veut les retirer du côté cuisine uniquement.

- [ ] **Step 1 : Lire les fonctions dans index.ts**

```bash
grep -n "notifPlatsJour\|notifCartonsChambrefroide" functions/src/index.ts
```

Repérer les lignes de ces deux fonctions.

- [ ] **Step 2 : Retirer `cuisine` des requêtes de destinataires dans `notifPlatsJour`**

Localiser la query Firestore qui récupère les tokens FCM dans `notifPlatsJour`. Elle ressemble à :
```ts
where('role', 'in', ['cuisine', 'corner', ...])
```
Supprimer `'cuisine'` de ce tableau. Tester que `corner` et autres rôles restent.

- [ ] **Step 3 : Retirer `cuisine` des requêtes de destinataires dans `notifCartonsChambrefroide`**

Même opération pour `notifCartonsChambrefroide`.

- [ ] **Step 4 : Build + deploy uniquement ces 2 fonctions**

```bash
cd functions && npm run build && cd ..
firebase deploy --only functions:notifPlatsJour,functions:notifCartonsChambrefroide
```

- [ ] **Step 5 : Commit**

```bash
git add functions/src/index.ts functions/lib/index.js functions/lib/index.js.map
git commit -m "fix(functions): retirer cuisine des notifs plats du jour et cartons"
```

---

## Task 7: WhatsApp deep link — lien envoi Timour après ruptures

**Files:**
- Modify: `src/modules/corner/pages/Ruptures.tsx`

**Comportement voulu :** Après le `handleSend` réussi (ligne ~248 `setSent(true)`), afficher un bouton "📲 Envoyer sur WhatsApp à Timour" qui ouvre `https://wa.me/33781468107?text=<message encodé>`. Le message = le texte de ruptures groupé par priorité, identique au dashboard cuisine.

- [ ] **Step 1 : Ajouter l'état `waLink` et la fonction `buildWhatsAppLink`**

Après les états existants (~ligne 70), ajouter :

```tsx
const [waLink, setWaLink] = useState<string | null>(null)
```

Après la fonction `buildText` (~ligne 171), ajouter :

```tsx
function buildWhatsAppMessage(): string {
  const { date, time } = nowISO()
  const urgentItems   = Object.entries(stockChecks).filter(([, v]) => v === 'urgent').map(([name]) => `🔴 ${name}`)
  const moinsUrgent   = Object.entries(stockChecks).filter(([, v]) => v === 'moins-urgent').map(([name]) => `🟠 ${name}`)
  const lines = [
    `RUPTURES CORNER — ${date} ${time}`,
    '',
    ...(urgentItems.length > 0 ? urgentItems : []),
    ...(moinsUrgent.length > 0 ? moinsUrgent : []),
    urgentItems.length === 0 && moinsUrgent.length === 0 ? 'Aucune rupture' : '',
  ].filter(l => l !== undefined)
  return lines.join('\n')
}
```

- [ ] **Step 2 : Générer le lien après l'envoi dans `handleSend`**

Juste avant `setSent(true)` (~ligne 248), ajouter :

```tsx
const waMsg = buildWhatsAppMessage()
if (urgentItems.length > 0 || moinsUrgentItems.length > 0) {
  setWaLink(`https://wa.me/33781468107?text=${encodeURIComponent(waMsg)}`)
}
```

- [ ] **Step 3 : Afficher le bouton WhatsApp dans le rendu après l'envoi**

Trouver où `sent` est affiché (message de confirmation). Après ce bloc, ajouter :

```tsx
{waLink && (
  <a
    href={waLink}
    target="_blank"
    rel="noopener noreferrer"
    style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      width: '100%', padding: '13px 16px', borderRadius: 12, textDecoration: 'none',
      background: 'rgba(37,211,102,0.12)', border: '1.5px solid rgba(37,211,102,0.3)',
      color: '#25d366', fontWeight: 700, fontSize: 14, fontFamily: 'Manrope, sans-serif',
    }}
    onClick={() => setWaLink(null)}
  >
    📲 Envoyer sur WhatsApp à Timour
  </a>
)}
```

- [ ] **Step 4 : Reset `waLink` quand le form reset**

Dans le reset du form (`setStockChecks({})` etc.), ajouter `setWaLink(null)`.

- [ ] **Step 5 : Commit**

```bash
git add src/modules/corner/pages/Ruptures.tsx
git commit -m "feat(ruptures): bouton WhatsApp wa.me Timour après envoi"
```

---

## Task 8: Commandes clients — accès tous rôles + filtre date

**Files:**
- Modify: `src/router/index.tsx`
- Modify: `src/modules/cuisine/index.tsx`
- Modify: `src/modules/corner/pages/Commandes.tsx`

**Objectif :** Créer une route `/commandes` accessible à tous + ajouter dans nav cuisine + filtre "Cette semaine" / "Ce mois" dans Commandes.tsx.

- [ ] **Step 1 : Ajouter la route `/commandes` dans le router (tous rôles)**

Dans `src/router/index.tsx`, ajouter l'import :
```tsx
const Commandes = lazy(() => import('../modules/corner/pages/Commandes'))
```

Puis après la route `/livraisons` :
```tsx
{/* Commandes clients — tous les rôles */}
<Route
  path="/commandes"
  element={
    <AuthGuard allowedRoles={['patron', 'administrateur', 'manager', 'cuisine', 'corner']}>
      <Layout><Commandes /></Layout>
    </AuthGuard>
  }
/>
```

- [ ] **Step 2 : Ajouter "Commandes clients" dans la nav cuisine**

Dans `src/modules/cuisine/index.tsx`, ajouter dans le tableau de navigation :
```tsx
{ path: 'commandes', label: 'Commandes clients' },
```
Et ajouter la route dans le `<Routes>` cuisine :
```tsx
import Commandes from '../corner/pages/Commandes'
// Dans <Routes> :
<Route path="commandes" element={<Commandes />} />
```

- [ ] **Step 3 : Ajouter les filtres date dans Commandes.tsx**

Lire les 80 premières lignes de `src/modules/corner/pages/Commandes.tsx` pour comprendre la structure actuelle.

```bash
head -80 src/modules/corner/pages/Commandes.tsx
```

Ajouter un état `dateFilter` et les onglets filtres. Avant le contenu principal de la liste, ajouter :

```tsx
const [dateFilter, setDateFilter] = useState<'semaine' | 'mois'>('semaine')
```

Et deux boutons onglets :
```tsx
<div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--surface-mid)', borderRadius: 12, marginBottom: 12 }}>
  {(['semaine', 'mois'] as const).map(f => (
    <button
      key={f}
      onClick={() => setDateFilter(f)}
      style={{
        flex: 1, padding: '8px 0', borderRadius: 9, border: 'none', cursor: 'pointer',
        background: dateFilter === f ? 'var(--surface)' : 'transparent',
        color: dateFilter === f ? 'var(--primary)' : 'var(--on-surface-3)',
        fontWeight: 700, fontSize: 13, fontFamily: 'Manrope, sans-serif',
        boxShadow: dateFilter === f ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
      }}
    >
      {f === 'semaine' ? 'Cette semaine' : 'Ce mois'}
    </button>
  ))}
</div>
```

Puis filtrer les commandes affichées selon `dateFilter` (ajouter la logique de filtrage sur `dateLivraison`).

- [ ] **Step 4 : Commit**

```bash
git add src/router/index.tsx src/modules/cuisine/index.tsx src/modules/corner/pages/Commandes.tsx
git commit -m "feat(commandes): accès tous rôles, route /commandes, filtre semaine/mois"
```

---

## Task 9: Firestore rules — nouvelles collections GMAO + CRETA GEL

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1 : Ajouter les règles**

Dans `firestore.rules`, après les règles existantes, ajouter :

```
match /gmao_demandes/{id} {
  allow read: if isAnyRole();
  allow create, update: if isPatronOrManager();
  allow delete: if isPatron();
}

match /creta_gel_docs/{id} {
  allow read: if isAnyRole();
  allow create, update, delete: if isPatronOrManager();
}
```

- [ ] **Step 2 : Déployer les rules**

```bash
firebase deploy --only firestore:rules
```

- [ ] **Step 3 : Commit**

```bash
git add firestore.rules
git commit -m "feat(firestore): rules gmao_demandes + creta_gel_docs"
```

---

## Task 10: Page AdminDocuments — GMAO + CRETA GEL

**Files:**
- Create: `src/pages/AdminDocuments.tsx`

- [ ] **Step 1 : Créer le fichier `src/pages/AdminDocuments.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { Timestamp, addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, updateDoc } from 'firebase/firestore'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { db, storage, auth } from '../firebase/config'
import { useToast } from '../hooks/useToast'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/config'

// ── Types ────────────────────────────────────────────────────────────
type GmaoDemande = {
  id: string
  motif: string
  departement: string
  date: string
  numeroIntervention: string
  statut: 'en cours' | 'en attente' | 'terminé'
  photoUrl?: string
  createdAt: any
  updatedAt?: any
}

type CretaGelDoc = {
  id: string
  label: string
  fileUrl: string
  fileType: string
  date: string
  createdAt: any
}

const DEPARTEMENTS = [
  'Plomberie', 'Électricité', 'Froid / Frigo', 'Climatisation',
  'Informatique', 'Ménage / Nettoyage', 'Structure / Menuiserie', 'Autre',
]

const STATUT_COLORS: Record<string, string> = {
  'en cours':  'rgba(180,83,9,0.15)',
  'en attente': 'rgba(0,66,117,0.10)',
  'terminé':   'rgba(45,122,79,0.12)',
}
const STATUT_TEXT: Record<string, string> = {
  'en cours':  '#b45309',
  'en attente': 'var(--primary)',
  'terminé':   'var(--success)',
}

function todayISO() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`
}

export default function AdminDocuments() {
  const { show } = useToast()
  const [tab, setTab] = useState<'gmao' | 'creta'>('gmao')

  // ── GMAO state ───────────────────────────────────────────────────
  const [demandes, setDemandes] = useState<GmaoDemande[]>([])
  const [loadingDemandes, setLoadingDemandes] = useState(false)
  const [showGmaoForm, setShowGmaoForm] = useState(false)
  const [gmaoMotif, setGmaoMotif] = useState('')
  const [gmaoDept, setGmaoDept] = useState(DEPARTEMENTS[0])
  const [gmaoDate, setGmaoDate] = useState(todayISO())
  const [gmaoNumero, setGmaoNumero] = useState('')
  const [gmaoPhoto, setGmaoPhoto] = useState<File | null>(null)
  const [gmaoPhotoPreview, setGmaoPhotoPreview] = useState<string | null>(null)
  const [savingGmao, setSavingGmao] = useState(false)
  const [sendingChristelle, setSendingChristelle] = useState<string | null>(null)
  const gmaoPhotoRef = useRef<HTMLInputElement>(null)

  // ── CRETA GEL state ──────────────────────────────────────────────
  const [cretaDocs, setCretaDocs] = useState<CretaGelDoc[]>([])
  const [loadingCreta, setLoadingCreta] = useState(false)
  const [cretaLabel, setCretaLabel] = useState('')
  const [cretaDate, setCretaDate] = useState(todayISO())
  const [cretaFile, setCretaFile] = useState<File | null>(null)
  const [savingCreta, setSavingCreta] = useState(false)
  const cretaFileRef = useRef<HTMLInputElement>(null)

  // ── Chargement ───────────────────────────────────────────────────
  async function loadDemandes() {
    setLoadingDemandes(true)
    try {
      const snap = await getDocs(query(collection(db, 'gmao_demandes'), orderBy('createdAt', 'desc')))
      setDemandes(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as GmaoDemande[])
    } catch { /* silencieux */ }
    finally { setLoadingDemandes(false) }
  }

  async function loadCretaDocs() {
    setLoadingCreta(true)
    try {
      const snap = await getDocs(query(collection(db, 'creta_gel_docs'), orderBy('createdAt', 'desc')))
      setCretaDocs(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as CretaGelDoc[])
    } catch { /* silencieux */ }
    finally { setLoadingCreta(false) }
  }

  useEffect(() => { loadDemandes(); loadCretaDocs() }, [])

  // ── GMAO helpers ─────────────────────────────────────────────────
  async function saveGmaoDemande() {
    if (!gmaoMotif.trim()) { show('Motif requis', 'error'); return }
    setSavingGmao(true)
    try {
      let photoUrl: string | undefined
      if (gmaoPhoto) {
        const path = `gmao/${auth.currentUser?.uid}_${Date.now()}_${gmaoPhoto.name}`
        await uploadBytes(storageRef(storage, path), gmaoPhoto)
        photoUrl = await getDownloadURL(storageRef(storage, path))
      }
      await addDoc(collection(db, 'gmao_demandes'), {
        motif: gmaoMotif.trim(),
        departement: gmaoDept,
        date: gmaoDate,
        numeroIntervention: gmaoNumero.trim(),
        statut: 'en cours',
        ...(photoUrl ? { photoUrl } : {}),
        createdAt: Timestamp.now(),
      })
      setGmaoMotif(''); setGmaoNumero(''); setGmaoPhoto(null); setGmaoPhotoPreview(null)
      setShowGmaoForm(false)
      show('Demande GMAO créée')
      await loadDemandes()
    } catch (e: any) { show(e?.message || 'Erreur', 'error') }
    finally { setSavingGmao(false) }
  }

  async function updateStatut(id: string, statut: GmaoDemande['statut']) {
    await updateDoc(doc(db, 'gmao_demandes', id), { statut, updatedAt: Timestamp.now() })
    setDemandes(prev => prev.map(d => d.id === id ? { ...d, statut } : d))
  }

  async function deleteDemande(id: string) {
    if (!confirm('Supprimer cette demande ?')) return
    await deleteDoc(doc(db, 'gmao_demandes', id))
    setDemandes(prev => prev.filter(d => d.id !== id))
    show('Demande supprimée')
  }

  async function sendToChristelle(demande: GmaoDemande) {
    setSendingChristelle(demande.id)
    try {
      const fn = httpsCallable(functions, 'sendGmaoEmail')
      await fn({ demandeId: demande.id, to: 'cvandaele@la-grande-epicerie.fr' })
      show('Email envoyé à Christelle ✓')
    } catch (e: any) { show(e?.message || 'Erreur envoi email', 'error') }
    finally { setSendingChristelle(null) }
  }

  // ── CRETA GEL helpers ────────────────────────────────────────────
  async function saveCretaDoc() {
    if (!cretaFile || !cretaLabel.trim()) { show('Fichier + libellé requis', 'error'); return }
    setSavingCreta(true)
    try {
      const path = `creta_gel/${auth.currentUser?.uid}_${Date.now()}_${cretaFile.name}`
      await uploadBytes(storageRef(storage, path), cretaFile)
      const fileUrl = await getDownloadURL(storageRef(storage, path))
      await addDoc(collection(db, 'creta_gel_docs'), {
        label: cretaLabel.trim(),
        fileUrl,
        fileType: cretaFile.type,
        date: cretaDate,
        createdAt: Timestamp.now(),
      })
      setCretaLabel(''); setCretaFile(null); setCretaDate(todayISO())
      show('Document ajouté')
      await loadCretaDocs()
    } catch (e: any) { show(e?.message || 'Erreur', 'error') }
    finally { setSavingCreta(false) }
  }

  async function deleteCretaDoc(id: string) {
    if (!confirm('Supprimer ce document ?')) return
    await deleteDoc(doc(db, 'creta_gel_docs', id))
    setCretaDocs(prev => prev.filter(d => d.id !== id))
    show('Document supprimé')
  }

  // ── Rendu ────────────────────────────────────────────────────────
  return (
    <div className="page">
      <div style={{ marginBottom: 4 }}>
        <p className="section-label" style={{ marginBottom: 2 }}>Administration</p>
        <h1 style={{
          fontFamily: 'Epilogue, sans-serif', fontSize: 26, fontWeight: 800,
          color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0,
        }}>
          Documents
        </h1>
      </div>

      {/* Onglets */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--surface-mid)', borderRadius: 14 }}>
        {([
          { key: 'gmao', label: '🔧 GMAO' },
          { key: 'creta', label: '🧊 CRETA GEL' },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)} style={{
            flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: tab === key ? 'var(--surface)' : 'transparent',
            color: tab === key ? 'var(--primary)' : 'var(--on-surface-3)',
            fontWeight: 700, fontFamily: 'Manrope, sans-serif', fontSize: 13,
            boxShadow: tab === key ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── GMAO ── */}
      {tab === 'gmao' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p className="section-label">Demandes de réparation</p>
            <button
              onClick={() => setShowGmaoForm(v => !v)}
              className={showGmaoForm ? 'btn-secondary' : 'btn-primary'}
              style={{ width: 'auto', padding: '10px 18px', fontSize: 13 }}
            >
              {showGmaoForm ? 'Annuler' : '+ Nouvelle demande'}
            </button>
          </div>

          {showGmaoForm && (
            <div className="card" style={{ border: '1.5px solid rgba(0,66,117,0.12)' }}>
              <p style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 800, fontSize: 15, color: 'var(--on-surface)', margin: '0 0 16px' }}>
                Nouvelle demande GMAO
              </p>

              {/* Motif */}
              <div style={{ marginBottom: 12 }}>
                <p className="section-label" style={{ marginBottom: 5 }}>Motif *</p>
                <textarea
                  className="input-filled"
                  rows={3}
                  placeholder="Décrire le problème…"
                  value={gmaoMotif}
                  onChange={e => setGmaoMotif(e.target.value)}
                  style={{ resize: 'vertical', minHeight: 80 }}
                />
              </div>

              {/* Département */}
              <div style={{ marginBottom: 12 }}>
                <p className="section-label" style={{ marginBottom: 5 }}>Département</p>
                <select className="input-filled" value={gmaoDept} onChange={e => setGmaoDept(e.target.value)}>
                  {DEPARTEMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              {/* Date + N° intervention */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div>
                  <p className="section-label" style={{ marginBottom: 5 }}>Date</p>
                  <input type="date" className="input-filled" value={gmaoDate} onChange={e => setGmaoDate(e.target.value)} />
                </div>
                <div>
                  <p className="section-label" style={{ marginBottom: 5 }}>N° intervention</p>
                  <input
                    className="input-filled"
                    placeholder="Ex: 2024-001"
                    value={gmaoNumero}
                    onChange={e => setGmaoNumero(e.target.value)}
                  />
                </div>
              </div>

              {/* Photo / scan */}
              <div style={{ marginBottom: 16 }}>
                <p className="section-label" style={{ marginBottom: 5 }}>Photo / scan (optionnel)</p>
                <input
                  ref={gmaoPhotoRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0] ?? null
                    setGmaoPhoto(f)
                    setGmaoPhotoPreview(f && f.type.startsWith('image/') ? URL.createObjectURL(f) : null)
                  }}
                />
                <button
                  onClick={() => gmaoPhotoRef.current?.click()}
                  className="btn-secondary"
                  style={{ width: 'auto', padding: '10px 16px', fontSize: 13 }}
                >
                  📎 {gmaoPhoto ? gmaoPhoto.name : 'Choisir un fichier'}
                </button>
                {gmaoPhotoPreview && (
                  <img src={gmaoPhotoPreview} alt="aperçu" style={{ marginTop: 10, maxWidth: '100%', borderRadius: 10, maxHeight: 200, objectFit: 'contain' }} />
                )}
              </div>

              <button onClick={saveGmaoDemande} disabled={savingGmao} className="btn-primary">
                {savingGmao ? 'Enregistrement…' : 'Créer la demande'}
              </button>
            </div>
          )}

          {loadingDemandes ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          ) : demandes.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '44px 20px' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🔧</div>
              <p style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 16, color: 'var(--on-surface)', margin: '0 0 6px' }}>
                Aucune demande GMAO
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {demandes.map(d => (
                <div key={d.id} className="card" style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 800, fontSize: 14, color: 'var(--on-surface)', marginBottom: 2 }}>
                        {d.departement}
                        {d.numeroIntervention && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', marginLeft: 8 }}>#{d.numeroIntervention}</span>
                        )}
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--on-surface-2)', margin: '0 0 6px', lineHeight: 1.4 }}>{d.motif}</p>
                      <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: 0 }}>
                        {new Date(d.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
                      </p>
                    </div>
                    {/* Statut badge */}
                    <span style={{
                      flexShrink: 0, fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99,
                      background: STATUT_COLORS[d.statut] ?? 'var(--surface-mid)',
                      color: STATUT_TEXT[d.statut] ?? 'var(--on-surface-3)',
                      whiteSpace: 'nowrap',
                    }}>
                      {d.statut}
                    </span>
                  </div>

                  {/* Photo */}
                  {d.photoUrl && (
                    <a href={d.photoUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block', marginBottom: 10 }}>
                      <img src={d.photoUrl} alt="doc" style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 8, objectFit: 'cover' }} />
                    </a>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {/* Changer statut */}
                    {d.statut !== 'terminé' && (
                      <select
                        value={d.statut}
                        onChange={e => updateStatut(d.id, e.target.value as GmaoDemande['statut'])}
                        style={{
                          fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 8,
                          border: '1px solid var(--border)', background: 'var(--surface)',
                          color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif', cursor: 'pointer',
                        }}
                      >
                        <option value="en cours">En cours</option>
                        <option value="en attente">En attente</option>
                        <option value="terminé">Terminé</option>
                      </select>
                    )}

                    {/* Envoyer à Christelle */}
                    {d.statut !== 'terminé' && (
                      <button
                        onClick={() => sendToChristelle(d)}
                        disabled={sendingChristelle === d.id}
                        style={{
                          fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8,
                          border: '1px solid rgba(0,66,117,0.2)',
                          background: 'rgba(0,66,117,0.06)', color: 'var(--primary)',
                          cursor: 'pointer', fontFamily: 'Manrope, sans-serif',
                        }}
                      >
                        {sendingChristelle === d.id ? '⏳' : '📧 Christelle'}
                      </button>
                    )}

                    {/* Supprimer */}
                    <button
                      onClick={() => deleteDemande(d.id)}
                      style={{
                        fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8,
                        border: '1px solid rgba(192,57,43,0.2)',
                        background: 'rgba(192,57,43,0.06)', color: 'var(--danger)',
                        cursor: 'pointer', fontFamily: 'Manrope, sans-serif',
                      }}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── CRETA GEL ── */}
      {tab === 'creta' && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Formulaire upload */}
            <div className="card" style={{ border: '1.5px solid rgba(0,66,117,0.12)' }}>
              <p style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 800, fontSize: 14, color: 'var(--on-surface)', margin: '0 0 14px' }}>
                Ajouter un bon de livraison
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <p className="section-label" style={{ marginBottom: 5 }}>Libellé *</p>
                  <input className="input-filled" placeholder="Ex: BL 2024-04-15" value={cretaLabel} onChange={e => setCretaLabel(e.target.value)} />
                </div>
                <div>
                  <p className="section-label" style={{ marginBottom: 5 }}>Date</p>
                  <input type="date" className="input-filled" value={cretaDate} onChange={e => setCretaDate(e.target.value)} />
                </div>
              </div>
              <input
                ref={cretaFileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
                onChange={e => setCretaFile(e.target.files?.[0] ?? null)}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <button
                  onClick={() => cretaFileRef.current?.click()}
                  className="btn-secondary"
                  style={{ width: 'auto', padding: '10px 16px', fontSize: 13 }}
                >
                  📎 {cretaFile ? cretaFile.name : 'Choisir fichier'}
                </button>
              </div>
              <button onClick={saveCretaDoc} disabled={savingCreta || !cretaFile || !cretaLabel.trim()} className="btn-primary">
                {savingCreta ? 'Upload…' : 'Ajouter'}
              </button>
            </div>

            {/* Liste */}
            {loadingCreta ? (
              <div style={{ textAlign: 'center', padding: '30px 0' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
            ) : cretaDocs.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>🧊</div>
                <p style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 15, color: 'var(--on-surface)', margin: 0 }}>
                  Aucun document CRETA GEL
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {cretaDocs.map(d => (
                  <div key={d.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                    borderRadius: 12, background: 'var(--surface-low)', border: '1px solid var(--border-soft)',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--on-surface)', marginBottom: 2 }}>{d.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>
                        {new Date(d.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
                      </div>
                    </div>
                    <a
                      href={d.fileUrl} target="_blank" rel="noopener noreferrer"
                      style={{
                        fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8,
                        border: '1px solid rgba(0,66,117,0.2)', background: 'rgba(0,66,117,0.06)',
                        color: 'var(--primary)', textDecoration: 'none', flexShrink: 0,
                      }}
                    >
                      👁 Voir
                    </a>
                    <button
                      onClick={() => deleteCretaDoc(d.id)}
                      style={{
                        fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 8,
                        border: '1px solid rgba(192,57,43,0.2)', background: 'rgba(192,57,43,0.06)',
                        color: 'var(--danger)', cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      🗑
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2 : Commit**

```bash
git add src/pages/AdminDocuments.tsx
git commit -m "feat(documents): page GMAO + CRETA GEL"
```

---

## Task 11: Router + Layout — route /admin/documents + lien sidebar

**Files:**
- Modify: `src/router/index.tsx`
- Modify: `src/components/Layout.tsx`

- [ ] **Step 1 : Ajouter la route `/admin/documents` dans le router**

Dans `src/router/index.tsx`, ajouter l'import :
```tsx
const AdminDocuments = lazy(() => import('../pages/AdminDocuments'))
```

Après la route `/admin/produits` :
```tsx
{/* Documents GMAO + CRETA GEL — patron + administrateur */}
<Route
  path="/admin/documents"
  element={
    <AuthGuard allowedRoles={['patron', 'administrateur']}>
      <Layout><AdminDocuments /></Layout>
    </AuthGuard>
  }
/>
```

- [ ] **Step 2 : Ajouter le lien dans le sidebar de Layout.tsx**

Lire `src/components/Layout.tsx` pour trouver où sont les liens admin (vers `/admin/settings`, `/admin/produits` etc.). Après le lien vers `/admin/produits`, ajouter :

```tsx
{(user?.role === 'patron' || user?.role === 'administrateur') && (
  <NavLink to="/admin/documents" ...>
    📁 Documents
  </NavLink>
)}
```

En respectant le style des autres liens admin existants.

- [ ] **Step 3 : Commit**

```bash
git add src/router/index.tsx src/components/Layout.tsx
git commit -m "feat(router): route /admin/documents + lien sidebar"
```

---

## Task 12: Cloud Functions — gmaoWeeklyReminder + sendGmaoEmail

**Files:**
- Modify: `functions/src/index.ts`

- [ ] **Step 1 : Ajouter la CF `sendGmaoEmail` (callable)**

Dans `functions/src/index.ts`, après les fonctions existantes, ajouter :

```ts
export const sendGmaoEmail = onCall({ region: 'europe-west1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Auth required')
  const { demandeId, to } = request.data as { demandeId: string; to: string }

  const demandeSnap = await admin.firestore().collection('gmao_demandes').doc(demandeId).get()
  if (!demandeSnap.exists) throw new HttpsError('not-found', 'Demande introuvable')
  const d = demandeSnap.data() as any

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  })

  await transporter.sendMail({
    from: `"Matias App" <${process.env.GMAIL_USER}>`,
    to,
    subject: `[GMAO] ${d.departement} — ${d.motif?.substring(0, 60)}`,
    html: `
      <h2>Demande GMAO non terminée</h2>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:8px;font-weight:bold;background:#f5f5f5">Département</td><td style="padding:8px">${d.departement}</td></tr>
        <tr><td style="padding:8px;font-weight:bold;background:#f5f5f5">Motif</td><td style="padding:8px">${d.motif}</td></tr>
        <tr><td style="padding:8px;font-weight:bold;background:#f5f5f5">Date</td><td style="padding:8px">${d.date}</td></tr>
        <tr><td style="padding:8px;font-weight:bold;background:#f5f5f5">N° intervention</td><td style="padding:8px">${d.numeroIntervention || '—'}</td></tr>
        <tr><td style="padding:8px;font-weight:bold;background:#f5f5f5">Statut</td><td style="padding:8px">${d.statut}</td></tr>
      </table>
      ${d.photoUrl ? `<br><a href="${d.photoUrl}">📎 Voir le document joint</a>` : ''}
    `,
  })
  return { success: true }
})
```

- [ ] **Step 2 : Ajouter la CF `gmaoWeeklyReminder` (scheduler)**

```ts
export const gmaoWeeklyReminder = onSchedule({
  schedule: 'every monday 09:00',
  timeZone: 'Europe/Paris',
  region: 'europe-west1',
}, async () => {
  const snap = await admin.firestore()
    .collection('gmao_demandes')
    .where('statut', '==', 'en cours')
    .get()

  if (snap.empty) return

  const demandes = snap.docs.map(d => d.data() as any)
  const html = `
    <h2>⚠️ Rappel hebdomadaire GMAO — ${demandes.length} demande(s) en cours</h2>
    ${demandes.map(d => `
      <div style="border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:12px">
        <strong>${d.departement}</strong>${d.numeroIntervention ? ` — #${d.numeroIntervention}` : ''}<br>
        ${d.motif}<br>
        <small style="color:#666">Depuis le ${d.date}</small>
        ${d.photoUrl ? `<br><a href="${d.photoUrl}">📎 Document</a>` : ''}
      </div>
    `).join('')}
  `

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  })

  await transporter.sendMail({
    from: `"Matias App" <${process.env.GMAIL_USER}>`,
    to: ['a.cozzika@gmail.com', 'sebastien.coenca@gmail.com'],
    subject: `[GMAO] ${demandes.length} demande(s) en cours`,
    html,
  })
})
```

- [ ] **Step 3 : Vérifier les imports au début du fichier**

S'assurer que `nodemailer`, `onSchedule`, `onCall`, `HttpsError` sont déjà importés. Si `onSchedule` n'est pas importé, ajouter :
```ts
import { onSchedule } from 'firebase-functions/v2/scheduler'
```

- [ ] **Step 4 : Build + deploy**

```bash
cd functions && npm run build && cd ..
firebase deploy --only functions:sendGmaoEmail,functions:gmaoWeeklyReminder
```

- [ ] **Step 5 : Commit**

```bash
git add functions/src/index.ts functions/lib/index.js functions/lib/index.js.map
git commit -m "feat(functions): sendGmaoEmail + gmaoWeeklyReminder hebdo"
```

---

## Task 13: Deploy complet hosting

- [ ] **Step 1 : Build + deploy hosting**

```bash
npm run build && firebase deploy --only hosting
```

- [ ] **Step 2 : Test final**

Vérifier dans l'app :
1. `/admin/documents` accessible en patron/admin ✓
2. GMAO : créer demande → photo → statut → bouton Christelle ✓
3. CRETA GEL : upload PDF/image → affichage lien ✓
4. Vitrine pastilles : AUJ.=orange, DEMAIN=violet ✓
5. Retour cuisine sans lotCode → lot ne réapparaît plus dans "Lot cuisine" ✓
6. Ruptures lundi avant midi → fenêtre samedi 13h ✓
7. Commandes accessible par cuisine + filtre date ✓
8. WhatsApp bouton après envoi ruptures ✓

---

## Notes importantes

- **Firestore rules** : `isPatronOrManager()` inclut déjà `administrateur` (vérifier dans les rules existantes).
- **gepCategory viande** : vérifier dans une réception réelle si le champ s'appelle `category` ou `gepCategory`. Si `gepCategory`, adapter le filtre dans Task 4.
- **notifCartonsChambrefroide** : TooGoodToGo est géré côté corner uniquement. La CF est pour le rappel cartons. Confirmer avec l'utilisateur si la CF cartons doit aussi être retirée de cuisine ou uniquement `notifPlatsJour`.
- **Commandes.tsx** : la page existe dans `src/modules/corner/pages/Commandes.tsx`. Elle sera réutilisée à la fois dans `/corner/commandes` et dans le nouveau `/commandes` global + cuisine.
