// Node.js 22
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import { getAuth } from 'firebase-admin/auth'
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https'
import { google } from 'googleapis'
import * as nodemailer from 'nodemailer'
import { validateRequest as twilioValidate } from 'twilio/lib/webhooks/webhooks'

const app = initializeApp()
// Firestore DB non-default : 'test'
const db = getFirestore(app, 'test')

// ─────────────────────────────────────────────────────────────────
// UTILITAIRES FCM
// ─────────────────────────────────────────────────────────────────

/** Envoie une notification FCM à tous les rôles spécifiés */
async function notifyRoles(
  title: string,
  body: string,
  link: string,
  roles: string[] = ['patron', 'manager', 'cuisine', 'corner'],
) {
  const usersSnap = await db.collection('users').get()
  const tokens: string[] = []
  for (const u of usersSnap.docs) {
    const d = u.data()
    if (d.fcmToken && roles.includes(d.role)) tokens.push(d.fcmToken)
  }
  if (!tokens.length) return
  await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    webpush: {
      notification: { icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'yorgios-cmd', renotify: true },
      fcmOptions: { link },
    },
  })
}

// ─────────────────────────────────────────────────────────────────
// UTILITAIRES GOOGLE CALENDAR
// ─────────────────────────────────────────────────────────────────

/**
 * Crée un événement dans Google Calendar quand une commande est acceptée.
 *
 * Prérequis :
 *   - Activer l'API Google Calendar dans Google Cloud Console (projet cuisine-yorgios)
 *   - Partager le calendrier avec l'email du service account (droits "Apporter des modifications")
 *   - Définir la variable d'environnement GCAL_COMMANDES_ID dans Firebase :
 *       firebase functions:config:set gcal.calendar_id="xxx@group.calendar.google.com"
 *   - Le calendrier peut ensuite être partagé avec n'importe quel compte Google
 *     (iPhone via compte Google dans Calendrier iOS, ou directement Google Calendar)
 *
 * @returns htmlLink de l'événement créé, ou '' en cas d'erreur
 */
async function createGCalEvent(cmd: FirebaseFirestore.DocumentData): Promise<string> {
  const calendarId = process.env.GCAL_CALENDAR_ID || 'primary'

  try {
    // Credentials via Application Default Credentials (service account Firebase)
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/calendar'],
    })
    const calendar = google.calendar({ version: 'v3', auth })

    const startDateTime = `${cmd.dateLivraison}T${cmd.heureLivraison}:00`
    const endDate = new Date(`${cmd.dateLivraison}T${cmd.heureLivraison}:00`)
    endDate.setHours(endDate.getHours() + 1)
    const endDateTime = endDate.toISOString().slice(0, 19)

    const produitsList = Array.isArray(cmd.produits)
      ? cmd.produits.map((p: any) => `• ${p.produit} — ${p.quantite} ${p.unite}`).join('\n')
      : ''

    const description = [
      `Référence : ${cmd.id}`,
      `Client : ${cmd.prenom} ${cmd.nom}`,
      `Tél : ${cmd.telephone}`,
      `Email : ${cmd.email}`,
      cmd.entreprise ? `Société : ${cmd.entreprise}` : null,
      `Mode : ${cmd.mode}`,
      `Créneau : ${cmd.creneauHoraire}`,
      '',
      'Produits :',
      produitsList,
      cmd.instructionsSpeciales ? `\nInstructions : ${cmd.instructionsSpeciales}` : null,
      cmd.prixEstime ? `\nPrix estimé : ${cmd.prixEstime} €` : null,
      cmd.notesCuisine ? `\nNotes cuisine : ${cmd.notesCuisine}` : null,
    ].filter(Boolean).join('\n')

    const event = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: `🍽️ Commande ${cmd.id} — ${cmd.prenom} ${cmd.nom}`,
        description,
        location: cmd.adresseLivraison,
        start: { dateTime: startDateTime, timeZone: 'Europe/Paris' },
        end:   { dateTime: endDateTime,   timeZone: 'Europe/Paris' },
        colorId: '2', // Vert = Acceptée
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 2880 },  // J-2
            { method: 'popup', minutes: 60 },
            { method: 'email', minutes: 2880 },
          ],
        },
      },
    })

    return event.data.htmlLink || ''
  } catch (e) {
    console.error('[GCal] Erreur création événement:', e)
    return ''
  }
}

// ─────────────────────────────────────────────────────────────────
// MESSAGERIE — Notification sur nouveau message
// ─────────────────────────────────────────────────────────────────

export const onNewMessage = onDocumentCreated(
  { document: 'messages/{messageId}', region: 'europe-west1', database: 'test' },
  async (event) => {
    const msg = event.data?.data()
    if (!msg) return

    const usersSnap = await db.collection('users').get()
    const tokens: string[] = []
    for (const u of usersSnap.docs) {
      const d = u.data()
      if (d.fcmToken && u.id !== msg.senderId) tokens.push(d.fcmToken)
    }
    if (!tokens.length) return

    const body = msg.photoUrl
      ? `${msg.senderName} a envoyé une photo`
      : msg.text?.slice(0, 100) || 'Nouveau message'

    await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title: `${msg.senderName} (${msg.senderRole})`, body },
      webpush: {
        notification: { icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'yorgios-msg', renotify: true },
        fcmOptions: { link: '/messages' },
      },
    })
  }
)

// ─────────────────────────────────────────────────────────────────
// COMMANDES — Nouvelle commande → notif immédiate (patron + manager)
// ─────────────────────────────────────────────────────────────────

export const onNewCommande = onDocumentCreated(
  { document: 'commandes_externes/{cmdId}', region: 'europe-west1', database: 'test' },
  async (event) => {
    const cmd = event.data?.data()
    if (!cmd) return

    // ── Anti-spam : max 3 commandes par numéro de téléphone sur 24h ──
    const telephone = cmd.telephone || cmd.tel || ''
    if (telephone) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const existing = await db.collection('commandes_externes')
        .where('telephone', '==', telephone)
        .where('createdAt', '>=', Timestamp.fromDate(since))
        .get()
      if (existing.size > 3) {
        console.warn(`[anti-spam] Trop de commandes pour ${telephone} — suppression`)
        await event.data!.ref.delete()
        return
      }
    }

    await notifyRoles(
      `📬 Nouvelle commande — ${cmd.id}`,
      `${cmd.prenom} ${cmd.nom} · ${cmd.dateLivraison} à ${cmd.heureLivraison}`,
      '/corner/commandes',
      ['patron', 'manager'],
    )
  }
)

// ─────────────────────────────────────────────────────────────────
// COMMANDES — Statut mis à jour
//   • "Acceptée"  → créer événement Google Calendar + notif cuisine
//   • "Refusée"   → notif équipe
//   • "Livrée"    → notif patron/manager
// ─────────────────────────────────────────────────────────────────

export const onCommandeUpdated = onDocumentUpdated(
  { document: 'commandes_externes/{cmdId}', region: 'europe-west1', database: 'test',
    secrets: ['BREVO_API_KEY', 'BREVO_LIST_ID'] },
  async (event) => {
    const before = event.data?.before?.data()
    const after  = event.data?.after?.data()
    if (!before || !after) return
    if (before.statut === after.statut) return

    const docRef = event.data!.after.ref

    if (after.statut === 'Acceptée' && before.statut !== 'Acceptée') {
      // Créer l'événement Google Calendar
      const lienGcal = await createGCalEvent(after)
      if (lienGcal) {
        await docRef.update({ lienGcal })
      }
      // Notifier la cuisine
      await notifyRoles(
        `✅ Commande acceptée — ${after.id}`,
        `${after.prenom} ${after.nom} · ${after.dateLivraison} à ${after.heureLivraison}`,
        '/corner/commandes',
        ['cuisine', 'patron', 'manager'],
      )
    }

    if (after.statut === 'Refusée' && before.statut !== 'Refusée') {
      await notifyRoles(
        `❌ Commande refusée — ${after.id}`,
        `${after.prenom} ${after.nom} a été refusé(e).`,
        '/corner/commandes',
        ['patron', 'manager'],
      )
    }

    if (after.statut === 'Livrée' && before.statut !== 'Livrée') {
      await notifyRoles(
        `🚚 Commande livrée — ${after.id}`,
        `${after.prenom} ${after.nom} — livraison confirmée.`,
        '/corner/commandes',
        ['patron', 'manager'],
      )
      // CRM : sync commande Brevo + fidélité
      if (after.telephone) {
        try {
          const { syncOrderToBrevoLogic, markPromoCodeUsed } = await import('./crm')
          await syncOrderToBrevoLogic(event.params.cmdId, after)
          if (after.promoCode && after.telephone) {
            await markPromoCodeUsed(after.telephone, after.promoCode)
          }
        } catch (e) {
          console.error('[CRM] Erreur sync commande Brevo:', e)
        }
      }
    }
  }
)

// ─────────────────────────────────────────────────────────────────
// COMMANDES — Rappel J-2 (tous les jours à 14h Europe/Paris)
// ─────────────────────────────────────────────────────────────────

export const notifCommandesJ2 = onSchedule(
  { schedule: 'every day 14:00', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    const j2 = new Date()
    j2.setDate(j2.getDate() + 2)
    const dateStr = j2.toISOString().slice(0, 10)

    const snap = await db.collection('commandes_externes')
      .where('dateLivraison', '==', dateStr)
      .where('statut', 'in', ['Acceptée', 'En production'])
      .get()

    if (snap.empty) return

    for (const d of snap.docs) {
      const cmd = d.data()
      await notifyRoles(
        `⏰ Rappel J-2 — ${cmd.id}`,
        `Livraison dans 2 jours : ${cmd.prenom} ${cmd.nom} le ${cmd.dateLivraison} à ${cmd.heureLivraison}`,
        '/corner/commandes',
        ['patron', 'manager', 'cuisine'],
      )
      await d.ref.update({ notifJ2Envoyee: Timestamp.now() })
    }

    console.log(`[J-2] ${snap.size} rappel(s) envoyé(s) pour ${dateStr}`)
  }
)

// ─────────────────────────────────────────────────────────────────
// COMMANDES — Rappel Jour-J (tous les jours à 9h Europe/Paris)
// ─────────────────────────────────────────────────────────────────

export const notifCommandesJJ = onSchedule(
  { schedule: 'every day 09:00', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    const today = new Date().toISOString().slice(0, 10)

    const snap = await db.collection('commandes_externes')
      .where('dateLivraison', '==', today)
      .where('statut', 'in', ['Acceptée', 'En production'])
      .get()

    if (snap.empty) return

    for (const d of snap.docs) {
      const cmd = d.data()
      await notifyRoles(
        `🚀 Livraison aujourd'hui — ${cmd.id}`,
        `${cmd.prenom} ${cmd.nom} — à livrer à ${cmd.heureLivraison}. Bon courage !`,
        '/corner/commandes',
        ['patron', 'manager', 'cuisine'],
      )
      await d.ref.update({ notifJJEnvoyee: Timestamp.now() })
    }

    console.log(`[J-J] ${snap.size} rappel(s) envoyé(s) pour ${today}`)
  }
)

// ─────────────────────────────────────────────────────────────────
// COMMANDES — Commande prête → notif FCM + message messagerie
// ─────────────────────────────────────────────────────────────────

export const onCommandePrete = onCall(
  { region: 'europe-west1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Non authentifié')

    const { commandeId } = request.data as { commandeId: string }
    if (!commandeId) throw new HttpsError('invalid-argument', 'commandeId manquant')

    const cmdSnap = await db.collection('commandes_externes').doc(commandeId).get()
    if (!cmdSnap.exists) throw new HttpsError('not-found', 'Commande introuvable')
    const cmd = cmdSnap.data()!

    // Notif FCM à patron + manager + cuisine
    await notifyRoles(
      `📦 Commande prête — ${cmd.id}`,
      `${cmd.prenom} ${cmd.nom} · ${cmd.dateLivraison} à ${cmd.heureLivraison}`,
      '/corner/commandes',
      ['patron', 'manager', 'cuisine'],
    )

    // Message dans la messagerie
    const callerSnap = await db.collection('users').doc(request.auth.uid).get()
    const callerData = callerSnap.data() || {}
    const senderName = callerData.displayName || 'Corner'
    const senderRole = callerData.role || 'corner'
    const now = Timestamp.now()
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000)

    await db.collection('messages').add({
      senderId: request.auth.uid,
      senderName,
      senderRole,
      text: `📦 Commande PRÊTE : ${cmd.id} — ${cmd.prenom} ${cmd.nom} — livraison le ${cmd.dateLivraison} à ${cmd.heureLivraison}`,
      photoUrl: null,
      createdAt: now,
      expiresAt,
    })

    return { ok: true }
  }
)

// ─────────────────────────────────────────────────────────────────
// MESSAGERIE — Purge quotidienne des messages expirés
// ─────────────────────────────────────────────────────────────────

export const purgeOldMessages = onSchedule(
  { schedule: 'every 24 hours', region: 'europe-west1' },
  async () => {
    const cutoff = new Date()
    const snap = await db.collection('messages')
      .where('expiresAt', '<', cutoff)
      .limit(500)
      .get()

    if (snap.empty) return

    const batch = db.batch()
    snap.docs.forEach(d => batch.delete(d.ref))
    await batch.commit()

    console.log(`[purge] ${snap.size} messages supprimés`)
  }
)

// ─────────────────────────────────────────────────────────────────
// ADMIN — Créer un utilisateur (patron uniquement)
// ─────────────────────────────────────────────────────────────────

export const createUser = onCall(
  { region: 'europe-west1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Non authentifié')

    // Vérifier que l'appelant est patron ou administrateur
    const callerSnap = await db.collection('users').doc(request.auth.uid).get()
    if (!['patron', 'administrateur'].includes(callerSnap.data()?.role)) {
      throw new HttpsError('permission-denied', 'Réservé au patron / administrateur')
    }

    const { email, password, displayName, role } = request.data as {
      email: string; password: string; displayName: string; role: string
    }
    if (!email || !password || !displayName || !role) {
      throw new HttpsError('invalid-argument', 'Champs obligatoires manquants')
    }
    const validRoles = ['patron', 'manager', 'cuisine', 'corner']
    if (!validRoles.includes(role)) {
      throw new HttpsError('invalid-argument', 'Rôle invalide')
    }

    // Créer le compte Auth
    const userRecord = await getAuth().createUser({ email, password, displayName })

    // Créer le doc Firestore
    await db.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email,
      displayName,
      role,
      createdAt: Timestamp.now(),
    })

    return { uid: userRecord.uid }
  }
)

// ─────────────────────────────────────────────────────────────────
// ADMIN — Supprimer un utilisateur (patron uniquement)
// ─────────────────────────────────────────────────────────────────

export const deleteUser = onCall(
  { region: 'europe-west1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Non authentifié')

    const callerSnap = await db.collection('users').doc(request.auth.uid).get()
    if (!['patron', 'administrateur'].includes(callerSnap.data()?.role)) {
      throw new HttpsError('permission-denied', 'Réservé au patron / administrateur')
    }

    const { uid } = request.data as { uid: string }
    if (!uid) throw new HttpsError('invalid-argument', 'uid manquant')
    if (uid === request.auth.uid) throw new HttpsError('invalid-argument', 'Impossible de supprimer son propre compte')

    await getAuth().deleteUser(uid)
    await db.collection('users').doc(uid).delete()

    return { ok: true }
  }
)

// ─────────────────────────────────────────────────────────────────
// RAPPELS QUOTIDIENS — Push FCM selon l'heure (Europe/Paris)
// ─────────────────────────────────────────────────────────────────

/** Récupère les UIDs des utilisateurs qui ont pointé (arrivée validée) aujourd'hui */
async function getUidsPointedToday(): Promise<string[]> {
  const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' }) // YYYY-MM-DD
  const snap = await db.collection('pointages')
    .where('date', '==', today)
    .where('typePointage', '==', 'arrivée')
    .where('statut', '==', 'validé')
    .get()
  return snap.docs.map(d => d.data().userId as string)
}

/** Envoie une notif FCM aux UIDs spécifiés */
async function notifyUids(uids: string[], title: string, body: string, link: string) {
  if (!uids.length) return
  const usersSnap = await db.collection('users').get()
  const tokens: string[] = []
  for (const u of usersSnap.docs) {
    const d = u.data()
    if (d.fcmToken && uids.includes(u.id)) tokens.push(d.fcmToken)
  }
  if (!tokens.length) return
  await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    webpush: {
      notification: { icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'yorgios-rappel', renotify: true },
      fcmOptions: { link },
    },
  })
}

/** 8h30 — Rappel températures frigo si non saisies (corner + patron + manager) */
export const notifTemperatures = onSchedule(
  { schedule: '30 8 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' })
    const fridgeIds = ['FRIGO_3P', 'VITRINE_1', 'VITRINE_2', 'VITRINE_3', 'GRAND_FRIGO']
    const checks = await Promise.all(fridgeIds.map(fid => db.doc(`temperatures/${today}_${fid}_matin`).get()))
    const anyFilled = checks.some(s => s.exists)
    if (anyFilled) {
      console.log('[8h30] Températures déjà saisies, pas de notif.')
      return
    }
    await notifyRoles(
      '🌡️ Températures frigo',
      "N'oublie pas de saisir les températures des frigos !",
      '/corner/temperatures',
      ['corner', 'patron', 'administrateur', 'manager'],
    )
    console.log('[8h30] Notif températures envoyée.')
  }
)

/** 9h00 — TooGoodToGo — envoyé aux employés qui ont pointé ce matin */
export const notifTooGoodToGo = onSchedule(
  { schedule: '0 9 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    const uids = await getUidsPointedToday()
    if (!uids.length) { console.log('[9h] Personne n\'a pointé.'); return }
    await notifyUids(uids, '🥗 TooGoodToGo', "Il est l'heure de préparer les paniers TooGoodToGo !", '/corner')
    console.log(`[9h] Notif TooGoodToGo envoyée à ${uids.length} personne(s).`)
  }
)

/** 9h30 — Cartons chambre froide — corner + cuisine */
export const notifCartonsChambrefroide = onSchedule(
  { schedule: '30 9 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    await notifyRoles(
      '📦 Chambre froide',
      'A-t-on besoin de vider les cartons en chambre froide ?',
      '/corner',
      ['corner', 'cuisine', 'patron', 'administrateur', 'manager'],
    )
    console.log('[9h30] Notif cartons chambre froide envoyée.')
  }
)

/** 11h00 — Plats du jour — tous les employés cuisine et corner */
export const notifPlatsJour = onSchedule(
  { schedule: '0 11 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    await notifyRoles(
      '🍽️ Plats du jour',
      'Faire les plats du jour.',
      '/cuisine',
      ['cuisine', 'corner', 'patron', 'administrateur', 'manager'],
    )
    console.log('[11h] Notif plats du jour envoyée.')
  }
)

// ─────────────────────────────────────────────────────────────────
// POINTAGE — Email au patron si retard > 10 min (a.cozzika@gmail.com)
// Prérequis : GMAIL_USER + GMAIL_APP_PASSWORD dans functions/.env
// ─────────────────────────────────────────────────────────────────

export const onPointageLate = onDocumentCreated(
  { document: 'pointages/{id}', region: 'europe-west1', database: 'test' },
  async (event) => {
    const data = event.data?.data()
    if (!data) return
    if (data.typePointage !== 'arrivée' || data.statut !== 'validé') return

    // Récupérer l'employeeId lié au compte
    const userSnap = await db.collection('users').doc(data.userId).get()
    const employeeId = userSnap.data()?.employeeId as string | undefined
    if (!employeeId) {
      console.log(`[retard] ${data.userName} sans lien planning — ignoré.`)
      return
    }

    // Calculer le weekId et le dayIndex depuis la date du pointage
    const dateObj = new Date(data.date + 'T12:00:00Z')
    const jsDay = dateObj.getUTCDay() // 0=Sun
    const dayIndex = jsDay === 0 ? 6 : jsDay - 1 // 0=Mon, 6=Sun
    const monday = new Date(dateObj)
    monday.setUTCDate(monday.getUTCDate() - dayIndex)
    const weekId = monday.toISOString().slice(0, 10)

    // Charger le planning du jour
    const daySnap = await db.doc(`planningWeeks/${weekId}/days/${dayIndex}`).get()
    if (!daySnap.exists) return
    const hoursMap = daySnap.data()?.hours as Record<string, string[]> | undefined
    if (!hoursMap) return

    // Trouver la première heure prévue pour cet employé
    const workedHours = Object.entries(hoursMap)
      .filter(([, emps]) => (emps as string[]).includes(employeeId))
      .map(([h]) => parseInt(h))
      .sort((a, b) => a - b)
    if (workedHours.length === 0) return

    const firstHour = workedHours[0]

    // Comparer l'heure réelle (Paris) à l'heure prévue
    const pointageTime = (data.timestamp as FirebaseFirestore.Timestamp).toDate()
    const parisLocale = pointageTime.toLocaleString('fr-FR', {
      timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const [hStr, mStr] = parisLocale.split(':')
    const actualMinutes = parseInt(hStr) * 60 + parseInt(mStr)
    const lateMinutes = actualMinutes - firstHour * 60

    if (lateMinutes <= 10) {
      console.log(`[retard] ${data.userName} à l'heure (${lateMinutes} min).`)
      return
    }

    // Envoyer email au patron
    const gmailUser = process.env.GMAIL_USER
    const gmailPass = process.env.GMAIL_APP_PASSWORD
    if (!gmailUser || !gmailPass) {
      console.error('[retard] GMAIL_USER / GMAIL_APP_PASSWORD manquants dans functions/.env')
      return
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass },
    })

    await transporter.sendMail({
      from: `"Matias" <${gmailUser}>`,
      to: 'a.cozzika@gmail.com',
      subject: `⏰ Retard — ${data.userName} (+${lateMinutes} min)`,
      text: [
        `Bonjour Alexandre,`,
        ``,
        `${data.userName} était prévu(e) à ${firstHour}h00 mais a pointé à ${parisLocale}.`,
        `Retard : ${lateMinutes} minutes.`,
        `Zone : ${data.zoneLabel}`,
        ``,
        `Cordialement,`,
        `Matias`,
      ].join('\n'),
    })
    console.log(`[retard] Email envoyé pour ${data.userName} (${lateMinutes} min de retard).`)
  }
)

// ─────────────────────────────────────────────────────────────────
// LIVRAISON — Départ cuisine → notif patron + admin + manager
// Se déclenche à la création d'un doc dans livraisons/
// ─────────────────────────────────────────────────────────────────

export const onLivraisonTemperature = onDocumentCreated(
  { document: 'livraisons/{livId}', region: 'europe-west1', database: 'test' },
  async (event) => {
    const data = event.data?.data()
    if (!data) return

    const produit = (data.productName as string) || 'produit inconnu'
    const lot = (data.lotCode as string) || event.params.livId
    const tempC = data.departTempC as number | undefined
    const tempStr = tempC !== undefined ? `${tempC}°C` : '?°C'
    const result = (data.result as string) || 'A_VERIFIER'
    const emoji = result === 'ACCEPTE' ? '✅' : result === 'REFUSE' ? '❌' : '⚠️'

    await notifyRoles(
      `${emoji} Livraison envoyée — ${produit}`,
      `Départ : ${tempStr} (${result}) · Lot ${lot}`,
      '/corner/livraison',
      ['patron', 'administrateur', 'manager'],
    )
    console.log(`[livraison-depart] Notif envoyée pour lot ${lot} — ${tempStr} ${result}`)
  }
)

// ─────────────────────────────────────────────────────────────────
// LIVRAISON — Réception corner → notif patron + admin + manager
// Se déclenche à la mise à jour d'un doc livraisons/ quand
// receptionTempC passe de null à une valeur saisie
// ─────────────────────────────────────────────────────────────────

export const onLivraisonReception = onDocumentUpdated(
  { document: 'livraisons/{livId}', region: 'europe-west1', database: 'test' },
  async (event) => {
    const before = event.data?.before?.data()
    const after  = event.data?.after?.data()
    if (!before || !after) return

    // Ne déclencher que quand receptionTempC passe de null/absent à une valeur
    if (before.receptionTempC != null) return
    if (after.receptionTempC == null) return

    const produit = (after.productName as string) || 'produit inconnu'
    const lot = (after.lotCode as string) || event.params.livId
    const tempC = after.receptionTempC as number
    const result = (after.result as string) || 'A_VERIFIER'
    const emoji = result === 'ACCEPTE' ? '✅' : result === 'REFUSE' ? '❌' : '⚠️'

    await notifyRoles(
      `${emoji} Réception corner — ${produit}`,
      `Réception : ${tempC}°C (${result}) · Lot ${lot}`,
      '/corner/livraison',
      ['patron', 'administrateur', 'manager'],
    )
    console.log(`[livraison-reception] Notif envoyée pour lot ${lot} — ${tempC}°C ${result}`)
  }
)

/** 15h00 — Urgences corner — aux employés qui ont pointé */
export const notifUrgences = onSchedule(
  { schedule: '0 15 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    const uids = await getUidsPointedToday()
    if (!uids.length) { console.log('[15h] Personne n\'a pointé.'); return }
    await notifyUids(
      uids,
      '⚡ Urgences du soir',
      "C'est l'heure d'informer la cuisine de vos urgences et ruptures !",
      '/corner/ruptures',
    )
    console.log(`[15h] Notif urgences envoyée à ${uids.length} personne(s).`)
  }
)

/** 22h00 — Rappel températures soir si non saisies (corner + patron + manager) */
export const notifTemperaturesEvening = onSchedule(
  { schedule: '0 22 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' })
    const fridgeIds = ['FRIGO_3P', 'VITRINE_1', 'VITRINE_2', 'VITRINE_3', 'GRAND_FRIGO']
    const checks = await Promise.all(fridgeIds.map(fid => db.doc(`temperatures/${today}_${fid}_soir`).get()))
    const anyFilled = checks.some(s => s.exists)
    if (anyFilled) {
      console.log('[22h] Températures soir déjà saisies, pas de notif.')
      return
    }
    await notifyRoles(
      '🌡️ Températures soir manquantes',
      "Les relevés de température du soir n'ont pas encore été saisis !",
      '/corner/temperatures',
      ['corner', 'patron', 'administrateur', 'manager'],
    )
    console.log('[22h] Notif températures soir envoyée.')
  }
)

/** Samedi 18h00 — Rappel hygiène hebdo si non faite (corner + patron + manager) */
export const notifHygieneHebdo = onSchedule(
  { schedule: '0 18 * * 6', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }))
    // Calcul ISO week
    const date = new Date(now); date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7)
    const w1 = new Date(date.getFullYear(), 0, 4)
    const isoWeek = 1 + Math.round(((date.getTime() - w1.getTime()) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7)
    const weekId = `${date.getFullYear()}-W${String(isoWeek).padStart(2, '0')}_hebdo`
    const snap = await db.doc(`hygiene_corner/${weekId}`).get()
    if (snap.exists) {
      console.log('[hebdo] Hygiène hebdo déjà faite, pas de notif.')
      return
    }
    await notifyRoles(
      '🧼 Hygiène hebdo non faite',
      "La checklist d'hygiène hebdomadaire n'a pas encore été complétée cette semaine !",
      '/corner/hygiene',
      ['corner', 'patron', 'administrateur', 'manager'],
    )
    console.log('[hebdo] Notif hygiène hebdo envoyée.')
  }
)

/** Avant-dernier jour du mois à 18h — Rappel hygiène mensuelle si non faite */
export const notifHygieneMensuel = onSchedule(
  { schedule: '0 18 28-31 * *', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }))
    // Vérifier que demain est bien le dernier jour du mois
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1)
    const dayAfter = new Date(tomorrow); dayAfter.setDate(tomorrow.getDate() + 1)
    if (tomorrow.getMonth() === dayAfter.getMonth()) {
      // Demain n'est pas le dernier jour du mois → sortir
      return
    }
    const p = (n: number) => String(n).padStart(2, '0')
    const monthId = `${now.getFullYear()}-${p(now.getMonth() + 1)}_mensuel`
    const snap = await db.doc(`hygiene_corner/${monthId}`).get()
    if (snap.exists) {
      console.log('[mensuel] Hygiène mensuelle déjà faite, pas de notif.')
      return
    }
    await notifyRoles(
      '🧼 Hygiène mensuelle non faite',
      "La checklist d'hygiène mensuelle n'a pas encore été complétée ce mois-ci !",
      '/corner/hygiene',
      ['corner', 'patron', 'administrateur', 'manager'],
    )
    console.log('[mensuel] Notif hygiène mensuelle envoyée.')
  }
)

/** Lundi 8h00 — Récap hebdo hygiène + températures manquantes (email patron + manager) */
export const weeklyHygieneRecap = onSchedule(
  { schedule: '0 8 * * 1', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    const gmailUser = process.env.GMAIL_USER
    const gmailPass = process.env.GMAIL_APP_PASSWORD
    if (!gmailUser || !gmailPass) {
      console.error('[weeklyRecap] GMAIL_USER / GMAIL_APP_PASSWORD manquants dans functions/.env')
      return
    }

    // Calculer la semaine précédente (lundi → dimanche)
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }))
    const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1 // 0=lundi
    const lastMonday = new Date(now)
    lastMonday.setDate(now.getDate() - dayOfWeek - 7)
    const days: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(lastMonday)
      d.setDate(lastMonday.getDate() + i)
      days.push(d.toLocaleDateString('fr-CA'))
    }
    const weekLabel = `${days[0]} → ${days[6]}`

    // Vérifier températures manquantes
    const fridgeIds = ['FRIGO_3P', 'VITRINE_1', 'VITRINE_2', 'VITRINE_3', 'GRAND_FRIGO']
    const sessions = ['matin', 'soir']
    const missingTemps: string[] = []
    for (const day of days) {
      for (const session of sessions) {
        const missing: string[] = []
        for (const fid of fridgeIds) {
          const snap = await db.doc(`temperatures/${day}_${fid}_${session}`).get()
          if (!snap.exists) missing.push(fid)
        }
        if (missing.length > 0) {
          missingTemps.push(`  ${day} ${session} : ${missing.join(', ')}`)
        }
      }
    }

    // Vérifier hygiène manquante (quotidien uniquement)
    const missingHygiene: string[] = []
    for (const day of days) {
      const snap = await db.doc(`hygiene_corner/${day}_quotidien`).get()
      if (!snap.exists) missingHygiene.push(`  ${day}`)
    }

    // Vérifier hygiène hebdo (semaine ISO)
    const isoYear = lastMonday.getFullYear()
    const isoWeek = (() => {
      const tmp = new Date(Date.UTC(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate()))
      const dayNum = tmp.getUTCDay() || 7
      tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum)
      const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
      return Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
    })()
    const weekId = `${isoYear}-W${String(isoWeek).padStart(2, '0')}`
    const hebdoSnap = await db.doc(`hygiene_corner/${weekId}_hebdo`).get()
    const missingHebdo = !hebdoSnap.exists ? `  ${weekId}_hebdo` : null

    // Si rien à signaler
    if (missingTemps.length === 0 && missingHygiene.length === 0 && !missingHebdo) {
      console.log('[weeklyRecap] Tout est complet, aucun email envoyé.')
      return
    }

    // Récupérer emails patron + manager
    const usersSnap = await db.collection('users').get()
    const emails: string[] = []
    for (const u of usersSnap.docs) {
      const d = u.data()
      if (['patron', 'administrateur', 'manager'].includes(d.role) && d.email) {
        emails.push(d.email as string)
      }
    }
    if (!emails.length) { console.log('[weeklyRecap] Aucun email destinataire trouvé.'); return }

    // Construire le corps de l'email
    const lines: string[] = [
      `Bonjour,`,
      ``,
      `Récapitulatif de la semaine ${weekLabel} — éléments manquants :`,
      ``,
    ]
    if (missingTemps.length > 0) {
      lines.push(`🌡️ TEMPÉRATURES MANQUANTES (${missingTemps.length} relevés) :`)
      lines.push(...missingTemps)
      lines.push(``)
    }
    if (missingHygiene.length > 0) {
      lines.push(`🧹 HYGIÈNE QUOTIDIENNE MANQUANTE (${missingHygiene.length} jour(s)) :`)
      lines.push(...missingHygiene)
      lines.push(``)
    }
    if (missingHebdo) {
      lines.push(`📋 HYGIÈNE HEBDO MANQUANTE :`)
      lines.push(missingHebdo)
      lines.push(``)
    }
    lines.push(`Cordialement,`, `Matias`)

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass },
    })
    await transporter.sendMail({
      from: `"Matias" <${gmailUser}>`,
      to: emails.join(', '),
      subject: `📋 Récap semaine ${weekLabel} — éléments manquants`,
      text: lines.join('\n'),
    })
    console.log(`[weeklyRecap] Email envoyé à ${emails.join(', ')} — ${missingTemps.length} temp, ${missingHygiene.length} hygiene manquants.`)
  }
)

// ─────────────────────────────────────────────────────────────────
// CONFIGURATION POST-DÉPLOIEMENT
// ─────────────────────────────────────────────────────────────────
//
// 1. Activer l'API Google Calendar dans Google Cloud Console
//    → console.cloud.google.com > APIs > "Google Calendar API" > Activer
//
// 2. Définir l'ID du calendrier dédié :
//    firebase functions:config:set gcal.calendar_id="xxx@group.calendar.google.com"
//    Ou dans Firebase Console > Functions > Variables d'environnement :
//      GCAL_CALENDAR_ID = "xxx@group.calendar.google.com"
//
// 3. Partager le Google Calendar avec le service account Firebase :
//    → Récupérer l'email du SA : Firebase Console > Paramètres > Comptes de service
//    → Google Calendar > Paramètres du calendrier > Partager avec des personnes
//    → Ajouter l'email SA avec "Apporter des modifications aux événements"
//
// 4. Le calendrier peut ensuite être partagé avec n'importe quel compte Google :
//    → iPhone : Réglages > Mail > Comptes > Ajouter un compte Google > activer Calendrier
//    → Android : Google Agenda > Paramètres > ajouter le compte

// ─────────────────────────────────────────────────────────────────
// CRM — Captation contact Brevo
// ─────────────────────────────────────────────────────────────────

export const syncContactToBrevo = onCall(
  { region: 'europe-west1', secrets: ['BREVO_API_KEY', 'BREVO_LIST_ID'] },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Authentification requise')
    const { syncContactToBrevoLogic } = await import('./crm')
    return syncContactToBrevoLogic(req.data)
  }
)

// ─────────────────────────────────────────────────────────────────
// CRM — Validation code promo (Matias — appelants authentifiés)
// ─────────────────────────────────────────────────────────────────

export const validatePromoCode = onCall(
  { region: 'europe-west1' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Authentification requise')
    const { validatePromoCodeLogic } = await import('./crm')
    return validatePromoCodeLogic(req.data.clientPhone, req.data.code)
  }
)

// ─────────────────────────────────────────────────────────────────
// CRM — Validation code promo (WordPress, header X-Yorgios-Secret)
// ─────────────────────────────────────────────────────────────────

export const validatePromoCodePublic = onRequest(
  { region: 'europe-west1', secrets: ['YORGIOS_WP_SECRET'], cors: true },
  async (req, res) => {
    const secret = req.headers['x-yorgios-secret']
    if (!secret || secret !== process.env.YORGIOS_WP_SECRET) {
      res.status(403).json({ error: 'Forbidden' }); return
    }
    const { validatePromoCodeLogic } = await import('./crm')
    const result = await validatePromoCodeLogic(req.body.clientPhone, req.body.code)
    res.json(result)
  }
)

// ─────────────────────────────────────────────────────────────────
// POINTAGE — Validation GPS côté serveur (A3)
// Le client envoie lat/lng/accuracy, le serveur détermine le statut
// et écrit en Firestore via admin SDK (impossible à falsifier)
// ─────────────────────────────────────────────────────────────────

const POINTAGE_ZONES_SERVER = [
  { id: 'cuisine', label: 'Cuisine', lat: 48.8739,  lng: 2.3498,  radiusMeters: 80  },
  { id: 'corner',  label: 'Corner',  lat: 48.85034, lng: 2.32394, radiusMeters: 100 },
]
const GPS_ACCURACY_LIMIT_SERVER = 50 // mètres

function haversineServer(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (x: number) => x * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export const createPointage = onCall(
  { region: 'europe-west1' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Authentification requise')

    const { latitude, longitude, accuracy, typePointage } = req.data as {
      latitude: number; longitude: number; accuracy: number; typePointage: 'arrivée' | 'départ'
    }

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      throw new HttpsError('invalid-argument', 'Coordonnées GPS invalides')
    }
    if (!['arrivée', 'départ'].includes(typePointage)) {
      throw new HttpsError('invalid-argument', 'Type de pointage invalide')
    }

    const uid = req.auth.uid
    const userSnap = await db.collection('users').doc(uid).get()
    const userData = userSnap.data()
    const userName = userData?.displayName || userData?.email?.split('@')[0] || 'Inconnu'

    // Double-check du rôle côté serveur — managers ne pointent pas
    const role = userData?.role || ''
    if (['manager'].includes(role)) {
      throw new HttpsError('permission-denied', 'Les managers ne pointent pas')
    }

    // Précision GPS insuffisante → refus immédiat
    if (accuracy > GPS_ACCURACY_LIMIT_SERVER) {
      throw new HttpsError('failed-precondition', `Signal GPS trop imprécis (±${Math.round(accuracy)} m)`)
    }

    // Anti-doublon : pas deux pointages de même type valides le même jour
    const today = new Date().toISOString().slice(0, 10)
    const existingSnap = await db.collection('pointages')
      .where('userId', '==', uid)
      .where('date', '==', today)
      .where('typePointage', '==', typePointage)
      .where('statut', '==', 'validé')
      .limit(1)
      .get()
    if (!existingSnap.empty) {
      const existing = existingSnap.docs[0].data()
      throw new HttpsError('already-exists', `Pointage ${typePointage} déjà enregistré aujourd'hui à ${existing.timestamp?.toDate?.().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) ?? '—'}`)
    }

    // Calcul zone côté serveur
    let detectedZone: { id: string; label: string; dist: number } | null = null
    let minDistance = Infinity
    for (const zone of POINTAGE_ZONES_SERVER) {
      const dist = Math.round(haversineServer(latitude, longitude, zone.lat, zone.lng))
      if (dist < minDistance) minDistance = dist
      if (dist <= zone.radiusMeters) {
        detectedZone = { id: zone.id, label: zone.label, dist }
        break
      }
    }

    const statut: 'validé' | 'refusé' = detectedZone ? 'validé' : 'refusé'

    await db.collection('pointages').add({
      userId: uid,
      userName,
      date: today,
      typePointage,
      zoneId:        detectedZone?.id    ?? 'hors_zone',
      zoneLabel:     detectedZone?.label ?? 'Hors zone',
      timestamp:     Timestamp.now(),
      latitude,
      longitude,
      accuracy:      Math.round(accuracy),
      distanceToZone: detectedZone?.dist ?? minDistance,
      statut,
      _serverValidated: true,
    })

    if (statut === 'refusé') {
      throw new HttpsError(
        'out-of-range',
        `Hors zone autorisée. ${POINTAGE_ZONES_SERVER.map(z => `${z.label} (${Math.round(haversineServer(latitude, longitude, z.lat, z.lng))} m)`).join(', ')}`
      )
    }

    return { statut, zoneId: detectedZone!.id, zoneLabel: detectedZone!.label }
  }
)

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

    if (authToken && authToken !== 'xxxx' && signature) {
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
      console.warn('incomingSms: TWILIO_AUTH_TOKEN not configured, skipping signature check')
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
    const trackingUrl: string | null = pickDropMatch?.[0] ?? genericMatch?.[0] ?? null

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
    }

    // ── 9. Réponse TwiML vide (pas de SMS de retour)
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
  },
)
