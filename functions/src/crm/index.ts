/**
 * CRM Cloud Functions — Brevo + Fidélité
 *
 * Secrets Firebase requis (firebase functions:secrets:set) :
 *   BREVO_API_KEY    — clé API Brevo
 *   BREVO_LIST_ID    — ID liste Brevo (3)
 *   YORGIOS_WP_SECRET — secret header WordPress
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM (optionnel)
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getNewTier, getCurrentTier } from '../domain/loyalty'

// ── Init Firebase (réutilise l'app déjà initialisée par index.ts) ──────────
function getDb() {
  const apps = getApps()
  const app = apps.length ? apps[0] : initializeApp()
  return getFirestore(app, 'test')
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface ContactPayload {
  prenom: string
  nom?: string
  telephone: string      // E.164
  email?: string
  entreprise?: string
  whatsappOptIn: boolean
  emailOptIn: boolean
  source: 'corner_matias'
  vendeurUid: string
  capturedAt: string     // ISO string
}

export interface PromoValidationResult {
  valid: boolean
  discountPercent?: number
  error?: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Convertit un numéro français en E.164. Retourne null si invalide. */
export function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-\.\(\)]/g, '')
  if (/^06\d{8}$/.test(cleaned)) return '+33' + cleaned.slice(1)
  if (/^07\d{8}$/.test(cleaned)) return '+33' + cleaned.slice(1)
  if (/^\+336\d{8}$/.test(cleaned)) return cleaned
  if (/^\+337\d{8}$/.test(cleaned)) return cleaned
  return null
}

/** Convertit E.164 en ID Firestore (sans le +) */
function phoneToDocId(e164: string): string {
  return e164.replace(/^\+/, '')
}

/** Génère un code promo unique format YRG-FIDELITE-XXXX */
function generatePromoCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let suffix = ''
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)]
  }
  return `YRG-FIDELITE-${suffix}`
}

/** Appelle l'API Brevo */
async function brevoPost(path: string, body: object): Promise<{ ok: boolean; status: number; data: any }> {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('BREVO_API_KEY non configuré')

  const res = await fetch(`https://api.brevo.com/v3${path}`, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

/** Met à jour un contact Brevo (PATCH) */
async function brevoPatch(path: string, body: object): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('BREVO_API_KEY non configuré')

  await fetch(`https://api.brevo.com/v3${path}`, {
    method: 'PUT',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

// ── Logique métier ─────────────────────────────────────────────────────────

/**
 * syncContactToBrevoLogic
 * Crée/met à jour le contact dans Brevo + Firestore customers/
 */
export async function syncContactToBrevoLogic(payload: ContactPayload): Promise<{ success: boolean; docId: string }> {
  const db = getDb()
  const phoneId = phoneToDocId(payload.telephone)
  const listId = parseInt(process.env.BREVO_LIST_ID ?? '3', 10)

  // 1. Appel Brevo
  const brevoBody = {
    ...(payload.email ? { email: payload.email } : { email: undefined }),
    attributes: {
      PRENOM: payload.prenom,
      NOM: payload.nom ?? '',
      SMS: payload.telephone,
      COMPANY: payload.entreprise ?? '',
      WHATSAPP_OPTIN: payload.whatsappOptIn,
      EMAIL_OPTIN: payload.emailOptIn,
      SOURCE: payload.source,
      DATE_CAPTATION: payload.capturedAt,
      VENDEUR: payload.vendeurUid,
      NB_COMMANDES: 0,
      PANIER_MOYEN: 0,
      CODE_PROMO_ACTIF: '',
    },
    listIds: [listId],
    updateEnabled: true,
    smsBlacklisted: !payload.whatsappOptIn,
    emailBlacklisted: !payload.emailOptIn,
  }

  // Brevo nécessite un email OU un numéro SMS comme identifiant
  // On utilise le SMS comme identifiant principal
  const brevoBodyWithSms = { ...brevoBody, attributes: { ...brevoBody.attributes } }
  const brevoResult = await brevoPost('/contacts', brevoBodyWithSms)

  const now = Timestamp.now()

  // 2. Upsert Firestore customers/{phoneId}
  const custRef = db.collection('customers').doc(phoneId)
  const existing = await custRef.get()

  if (!existing.exists) {
    await custRef.set({
      prenom: payload.prenom,
      ...(payload.nom && { nom: payload.nom }),
      ...(payload.email && { email: payload.email }),
      ...(payload.entreprise && { entreprise: payload.entreprise }),
      emailOptIn: payload.emailOptIn,
      whatsappOptIn: payload.whatsappOptIn,
      orderCount: 0,
      avgBasket: 0,
      lastOrderAt: null,
      activePromoCode: null,
      loyaltyTier: 'none',
      createdAt: now,
      source: payload.source,
    })
  } else {
    // Mise à jour opt-ins si le contact est recapturé
    await custRef.update({
      whatsappOptIn: payload.whatsappOptIn,
      emailOptIn: payload.emailOptIn,
    })
  }

  // 3. Log CRM
  const logRef = await db.collection('crm_sync_log').add({
    action: 'sync_contact',
    contactId: phoneId,
    vendeurUid: payload.vendeurUid,
    brevoStatus: brevoResult.status,
    brevoOk: brevoResult.ok,
    payload: { prenom: payload.prenom, source: payload.source },
    timestamp: now,
  })

  console.log(`[CRM] Contact synchronisé: ${phoneId} — Brevo: ${brevoResult.status}`)
  return { success: brevoResult.ok, docId: logRef.id }
}

/**
 * syncOrderToBrevoLogic
 * Appelée quand une commande passe au statut "Livrée".
 * Met à jour NB_COMMANDES + PANIER_MOYEN dans Brevo,
 * crée une transaction Brevo, puis vérifie la fidélité.
 */
export async function syncOrderToBrevoLogic(orderId: string, orderData: Record<string, any>): Promise<void> {
  const db = getDb()
  const rawPhone: string = orderData.telephone ?? ''
  const e164 = normalizePhone(rawPhone)
  if (!e164) {
    console.warn(`[CRM] Téléphone invalide pour commande ${orderId}: "${rawPhone}"`)
    return
  }

  const phoneId = phoneToDocId(e164)
  const custRef = db.collection('customers').doc(phoneId)
  const custSnap = await custRef.get()

  // Initialise le client s'il n'existe pas encore (commande directe sans captation CRM)
  if (!custSnap.exists) {
    await custRef.set({
      prenom: orderData.prenom ?? '',
      emailOptIn: false,
      whatsappOptIn: false,
      orderCount: 0,
      avgBasket: 0,
      lastOrderAt: null,
      activePromoCode: null,
      loyaltyTier: 'none',
      createdAt: Timestamp.now(),
      source: 'commande_directe',
    })
  }

  const custData = (await custRef.get()).data()!
  const prevCount = custData.orderCount ?? 0
  const prevAvg   = custData.avgBasket   ?? 0
  const amount    = typeof orderData.prixEstime === 'number' ? orderData.prixEstime : 0

  // Recalcul moyenne panier
  const newCount = prevCount + 1
  const newAvg   = prevCount === 0
    ? amount
    : Math.round(((prevAvg * prevCount + amount) / newCount) * 100) / 100

  // Mise à jour Firestore
  await custRef.update({
    orderCount: newCount,
    avgBasket: newAvg,
    lastOrderAt: Timestamp.now(),
    loyaltyTier: getCurrentTier(newCount),
  })

  // Mise à jour Brevo
  await brevoPatch(`/contacts/${encodeURIComponent(e164)}`, {
    attributes: {
      NB_COMMANDES: newCount,
      PANIER_MOYEN: newAvg,
    },
  })

  // Transaction Brevo (eCommerce)
  const orderBrevoBody = {
    id: orderId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'delivered',
    amount,
    email: orderData.email ?? '',
    billing: {
      phone: e164,
      givenName: orderData.prenom ?? '',
      familyName: orderData.nom ?? '',
    },
    products: (orderData.produits ?? []).map((p: any, i: number) => ({
      productId: `prod_${i}`,
      quantity: parseInt(p.quantite ?? '1', 10) || 1,
      price: amount,
      name: p.produit ?? 'Produit',
    })),
  }
  await brevoPost('/orders', orderBrevoBody)

  // Log
  await db.collection('crm_sync_log').add({
    action: 'sync_order',
    contactId: phoneId,
    orderId,
    newCount,
    newAvg,
    timestamp: Timestamp.now(),
  })

  // Vérification fidélité
  await checkLoyaltyLogic(phoneId, newCount, newAvg, custData.prenom ?? orderData.prenom ?? '')
}

/**
 * checkLoyaltyLogic
 * Si un palier est atteint, génère un code promo unique et notifie le client.
 */
export async function checkLoyaltyLogic(
  phoneId: string,
  orderCount: number,
  _avgBasket: number,
  prenom: string,
): Promise<void> {
  const db = getDb()
  const tier = getNewTier(orderCount)
  if (!tier) return  // Pas de nouveau palier atteint

  const code = generatePromoCode()
  const now = Timestamp.now()
  const expiresAt = tier.validityDays
    ? Timestamp.fromMillis(now.toMillis() + tier.validityDays * 86_400_000)
    : null

  const promoData = {
    code,
    discountPercent: tier.discountPercent,
    expiresAt,
    used: false,
    earnedAtOrder: orderCount,
  }

  // Écriture Firestore
  await db.collection('customers').doc(phoneId).update({
    activePromoCode: promoData,
    loyaltyTier: tier.tier,
  })

  // Mise à jour Brevo
  const e164 = '+' + phoneId
  await brevoPatch(`/contacts/${encodeURIComponent(e164)}`, {
    attributes: { CODE_PROMO_ACTIF: code },
  })

  // Email Brevo transactionnel (si emailOptIn)
  const custSnap = await db.collection('customers').doc(phoneId).get()
  const custData = custSnap.data()

  if (custData?.emailOptIn && custData?.email) {
    // TODO: Envoyer email transactionnel Brevo avec template fidélité
    console.log(`[CRM] Email fidélité à envoyer à ${custData.email} — code ${code}`)
  }

  // WhatsApp Twilio (optionnel — nécessite TWILIO_* secrets configurés)
  const twilioSid  = process.env.TWILIO_ACCOUNT_SID
  const twilioAuth = process.env.TWILIO_AUTH_TOKEN
  const twilioFrom = process.env.TWILIO_WHATSAPP_FROM
  if (twilioSid && twilioAuth && twilioFrom) {
    try {
      const body = `Bonjour ${prenom} ! 🎉 Merci pour votre fidélité. ` +
        `Vous avez atteint ${orderCount} commandes et gagnez ${tier.discountPercent}% de réduction. ` +
        `Votre code : ${code}${tier.validityDays ? ` (valable ${tier.validityDays} jours)` : ' (illimité)'}.`

      const params = new URLSearchParams({
        From: twilioFrom,
        To: `whatsapp:${e164}`,
        Body: body,
      })
      await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: 'Basic ' + Buffer.from(`${twilioSid}:${twilioAuth}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        }
      )
    } catch (e) {
      console.warn('[CRM] Twilio WhatsApp erreur:', e)
    }
  }

  // Log
  await db.collection('crm_sync_log').add({
    action: 'promo_generated',
    contactId: phoneId,
    code,
    tier: tier.tier,
    discountPercent: tier.discountPercent,
    orderCount,
    timestamp: Timestamp.now(),
  })

  console.log(`[CRM] Code promo ${code} généré pour ${phoneId} (palier ${tier.tier})`)
}

/**
 * validatePromoCodeLogic
 * Vérifie la validité d'un code promo pour un client donné.
 */
export async function validatePromoCodeLogic(
  clientPhone: string,
  code: string,
): Promise<PromoValidationResult> {
  if (!clientPhone || !code) {
    return { valid: false, error: 'Téléphone et code requis' }
  }

  const e164 = normalizePhone(clientPhone)
  if (!e164) return { valid: false, error: 'Numéro de téléphone invalide' }

  const db = getDb()
  const phoneId = phoneToDocId(e164)
  const custSnap = await db.collection('customers').doc(phoneId).get()

  if (!custSnap.exists) {
    return { valid: false, error: 'Client inconnu' }
  }

  const custData = custSnap.data()!
  const promo = custData.activePromoCode

  if (!promo) return { valid: false, error: 'Aucun code actif pour ce client' }
  if (promo.code !== code) return { valid: false, error: 'Code incorrect' }
  if (promo.used) return { valid: false, error: 'Code déjà utilisé' }
  if (promo.expiresAt && promo.expiresAt.toMillis() < Date.now()) {
    return { valid: false, error: 'Code expiré' }
  }

  return { valid: true, discountPercent: promo.discountPercent }
}

/**
 * markPromoCodeUsed
 * Marque le code promo comme utilisé (appelé quand commande → "Livrée")
 */
export async function markPromoCodeUsed(clientPhone: string, code: string): Promise<void> {
  const e164 = normalizePhone(clientPhone)
  if (!e164) return
  const db = getDb()
  const phoneId = phoneToDocId(e164)
  const custSnap = await db.collection('customers').doc(phoneId).get()
  if (!custSnap.exists) return

  const promo = custSnap.data()?.activePromoCode
  if (promo?.code !== code || promo?.used) return

  await db.collection('customers').doc(phoneId).update({
    'activePromoCode.used': true,
  })

  // Effacer CODE_PROMO_ACTIF dans Brevo
  await brevoPatch(`/contacts/${encodeURIComponent(e164)}`, {
    attributes: { CODE_PROMO_ACTIF: '' },
  })

  await db.collection('crm_sync_log').add({
    action: 'promo_used',
    contactId: phoneId,
    code,
    timestamp: Timestamp.now(),
  })
}
