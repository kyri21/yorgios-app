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
import * as crypto from 'crypto'

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
    data: { link },
    webpush: {
      notification: { icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'yorgios-cmd', renotify: true },
      fcmOptions: { link },
    },
  })
}

// ─────────────────────────────────────────────────────────────────
// UTILITAIRES — TOKEN ACTION EMAIL
// ─────────────────────────────────────────────────────────────────

/** Génère un token HMAC-SHA256 pour les boutons d'action dans les emails */
function makeActionToken(cmdId: string, statut: string): string {
  const secret = process.env.YORGIOS_WP_SECRET
  if (!secret) throw new Error('YORGIOS_WP_SECRET non configuré — génération de token refusée')
  return crypto.createHmac('sha256', secret).update(`${cmdId}:${statut}`).digest('hex')
}

function verifyActionToken(cmdId: string, statut: string, token: string): boolean {
  return makeActionToken(cmdId, statut) === token
}

const CF_BASE = 'https://europe-west1-cuisine-yorgios.cloudfunctions.net'

function actionLink(cmdId: string, statut: string): string {
  const token = makeActionToken(cmdId, statut)
  return `${CF_BASE}/updateCommandeStatus?cmdId=${encodeURIComponent(cmdId)}&statut=${encodeURIComponent(statut)}&token=${token}`
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
// COMMANDES — Nouvelle commande → notif immédiate (patron + manager + cuisine) + email
// ─────────────────────────────────────────────────────────────────

export const onNewCommande = onDocumentCreated(
  { document: 'commandes_externes/{cmdId}', region: 'europe-west1', database: 'test' },
  async (event) => {
    const cmd = event.data?.data()
    if (!cmd) return

    // ── Anti-spam : max 3 commandes par numéro de téléphone sur 24h ──
    // (query simple sur telephone uniquement, filtrage date en mémoire pour éviter index composite)
    try {
      const telephone = cmd.telephone || cmd.tel || ''
      if (telephone) {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
        const existing = await db.collection('commandes_externes')
          .where('telephone', '==', telephone)
          .get()
        const recentCount = existing.docs.filter(d => {
          const ds = d.data().dateSaisie
          const t = ds?.toDate ? ds.toDate() : null
          return t && t >= since
        }).length
        if (recentCount > 3) {
          console.warn(`[anti-spam] Trop de commandes pour ${telephone} — suppression`)
          await event.data!.ref.delete()
          return
        }
      }
    } catch (e) {
      console.error('[anti-spam] Erreur vérification (ignorée):', e)
    }

    // ── Produits ──
    const produitsList = Array.isArray(cmd.produits) && cmd.produits.length
      ? cmd.produits.map((p: any) => `  - ${p.produit}${p.quantite ? ' × ' + p.quantite : ''}${p.unite ? ' ' + p.unite : ''}`).join('\n')
      : '  Non précisé'

    // ── Message messagerie interne ──
    const now = Timestamp.now()
    const expiresAt = Timestamp.fromMillis(now.toMillis() + 7 * 86400_000)
    const messageText = [
      '📬 NOUVELLE COMMANDE CLIENT',
      `━━━━━━━━━━━━━━━━━━`,
      `Client : ${cmd.prenom} ${cmd.nom}`,
      cmd.telephone ? `Tél : ${cmd.telephone}` : null,
      `Livraison : ${cmd.dateLivraison} à ${cmd.heureLivraison}`,
      cmd.adresseLivraison ? `Adresse : ${cmd.adresseLivraison}` : null,
      cmd.nombreConvives ? `Convives : ${cmd.nombreConvives}` : null,
      `━━━━━━━━━━━━━━━━━━`,
      `Produits :`,
      produitsList,
      cmd.instructionsSpeciales ? `━━━━━━━━━━━━━━━━━━\nNote : ${cmd.instructionsSpeciales}` : null,
      `━━━━━━━━━━━━━━━━━━`,
      `Statut : EN ATTENTE — voir onglet Commandes clients`,
    ].filter(Boolean).join('\n')

    try {
      await db.collection('messages').add({
        channelId: 'corner-cuisine',
        senderId: 'system',
        senderName: 'Commandes',
        senderRole: 'system',
        text: messageText,
        createdAt: now,
        expiresAt,
      })
    } catch (e) {
      console.error('[onNewCommande] Erreur écriture message:', e)
    }

    // ── Push FCM ──
    try {
      await notifyRoles(
        `📬 Nouvelle commande — ${cmd.prenom} ${cmd.nom}`,
        `${cmd.dateLivraison} à ${cmd.heureLivraison}`,
        '/corner/commandes',
        ['patron', 'manager', 'cuisine'],
      )
    } catch (e) {
      console.error('[onNewCommande] Erreur FCM:', e)
    }

    // ── Email au patron ──
    try {
      const gmailUser = process.env.GMAIL_USER
      const gmailPass = process.env.GMAIL_APP_PASSWORD
      if (gmailUser && gmailPass) {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user: gmailUser, pass: gmailPass },
        })
        const cmdCfgSnap = await db.doc('settings/commandes_emails').get()
        const cmdCfg = cmdCfgSnap.data() ?? {}
        const cmdDest: string[] = Array.isArray(cmdCfg.destinataires) && cmdCfg.destinataires.length > 0
          ? cmdCfg.destinataires : ['a.cozzika@gmail.com']
        await transporter.sendMail({
          from: `"Matias" <${gmailUser}>`,
          to: cmdDest,
          subject: `📬 Nouvelle commande — ${cmd.prenom} ${cmd.nom} (${cmd.dateLivraison})`,
          text: [
            `Bonjour Alexandre,`,
            ``,
            `Une nouvelle commande vient d'être enregistrée.`,
            ``,
            `Client : ${cmd.prenom} ${cmd.nom}`,
            cmd.telephone ? `Téléphone : ${cmd.telephone}` : null,
            cmd.email ? `Email : ${cmd.email}` : null,
            ``,
            `Livraison : ${cmd.dateLivraison} à ${cmd.heureLivraison}`,
            cmd.adresseLivraison ? `Adresse : ${cmd.adresseLivraison}` : null,
            cmd.nombreConvives ? `Convives : ${cmd.nombreConvives}` : null,
            ``,
            `Produits :`,
            produitsList,
            cmd.instructionsSpeciales ? `\nInstructions : ${cmd.instructionsSpeciales}` : null,
            ``,
            `Voir dans l'application : onglet Commandes clients.`,
          ].filter(Boolean).join('\n'),
        })
      }
    } catch (e) {
      console.error('[onNewCommande] Erreur email:', e)
    }
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

    if (after.statut === 'Accepté' && before.statut !== 'Accepté') {
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

    if (after.statut === 'Devis envoyé' && before.statut !== 'Devis envoyé') {
      await notifyRoles(
        `📄 Devis envoyé — ${after.id}`,
        `${after.prenom} ${after.nom} · en attente de confirmation client`,
        '/corner/commandes',
        ['patron', 'manager'],
      )
    }

    if (after.statut === 'Refusé' && before.statut !== 'Refusé') {
      await notifyRoles(
        `❌ Commande refusée — ${after.id}`,
        `${after.prenom} ${after.nom} — refusée.`,
        '/corner/commandes',
        ['patron', 'manager'],
      )
    }

    if (after.statut === 'Annulé' && before.statut !== 'Annulé') {
      await notifyRoles(
        `🚫 Commande annulée — ${after.id}`,
        `${after.prenom} ${after.nom} — annulée.`,
        '/corner/commandes',
        ['patron', 'manager'],
      )
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
      .where('statut', 'in', ['Accepté'])
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

    // ── Email récap J-2 ──
    try {
      const gmailUser = process.env.GMAIL_USER
      const gmailPass = process.env.GMAIL_APP_PASSWORD
      if (gmailUser && gmailPass) {
        const formatDate = (iso: string) => {
          const [y, m, d] = iso.split('-')
          const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
          const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
          const dt = new Date(iso)
          return `${days[dt.getDay()]} ${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`
        }

        let htmlBody = `
          <div style="font-family: sans-serif; max-width: 640px; margin: 0 auto; color: #1c1c18;">
            <h2 style="color: #004275; border-bottom: 2px solid #004275; padding-bottom: 8px;">
              ⏰ Rappel J-2 — Commandes du ${formatDate(dateStr)}
            </h2>
            <p style="color: #5a5a55; font-size: 14px;">
              ${snap.size} commande(s) à livrer dans <strong>2 jours</strong>.
            </p>
        `

        for (const d of snap.docs) {
          const cmd = d.data()
          const produitsList = Array.isArray(cmd.produits) && cmd.produits.length
            ? cmd.produits.map((p: any) => `${p.produit}${p.quantite ? ' × ' + p.quantite : ''}${p.unite ? ' ' + p.unite : ''}`).join(', ')
            : '—'
          const statut = cmd.statut || '?'
          const couleurStatut = statut === 'Accepté' ? '#2d7a4f' : '#004275'

          htmlBody += `
            <div style="background: #f6f3ed; border-left: 4px solid ${couleurStatut}; padding: 12px 16px; margin-bottom: 10px; border-radius: 4px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <strong style="font-size: 15px;">${cmd.prenom || ''} ${cmd.nom || ''}</strong>
                <span style="background: ${couleurStatut}; color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 12px;">${statut}</span>
              </div>
              <div style="font-size: 13px; color: #5a5a55; margin-bottom: 4px;">
                🕐 ${cmd.heureLivraison || '?'} — ${cmd.mode || 'Livraison'}
                ${cmd.creneauHoraire ? ` — ${cmd.creneauHoraire}` : ''}
              </div>
              ${cmd.telephone ? `<div style="font-size: 13px; color: #5a5a55;">📞 ${cmd.telephone}</div>` : ''}
              ${cmd.adresseLivraison ? `<div style="font-size: 13px; color: #5a5a55;">📍 ${cmd.adresseLivraison}</div>` : ''}
              <div style="font-size: 13px; color: #1c1c18; margin-top: 6px;">🛒 ${produitsList}</div>
              ${cmd.prixEstime ? `<div style="font-size: 13px; color: #004275; margin-top: 4px; font-weight: 600;">💶 ${cmd.prixEstime} €</div>` : ''}
              ${cmd.instructionsSpeciales ? `<div style="font-size: 12px; color: #b45309; margin-top: 4px; font-style: italic;">⚠️ ${cmd.instructionsSpeciales}</div>` : ''}
            </div>
          `
        }

        htmlBody += `
            <p style="font-size: 12px; color: #9a9a94; margin-top: 32px; border-top: 1px solid #ede9e1; padding-top: 12px;">
              Matias — rappel automatique J-2 envoyé à 14h.<br>
              Consulter toutes les commandes : <a href="https://cuisine-yorgios.web.app/corner/commandes" style="color: #004275;">App Matias</a>
            </p>
          </div>
        `

        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user: gmailUser, pass: gmailPass },
        })
        await transporter.sendMail({
          from: `"Matias" <${gmailUser}>`,
          to: 'a.cozzika@gmail.com',
          subject: `⏰ Rappel J-2 — ${snap.size} commande(s) le ${formatDate(dateStr)}`,
          html: htmlBody,
        })
        console.log(`[J-2] Email envoyé pour ${dateStr}`)
      }
    } catch (e) {
      console.error('[J-2] Erreur envoi email:', e)
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
// COMMANDES — Récap email J+7 (chaque matin à 8h Europe/Paris)
// ─────────────────────────────────────────────────────────────────

export const notifCommandesJ7 = onSchedule(
  { schedule: 'every day 08:00', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    const gmailUser = process.env.GMAIL_USER
    const gmailPass = process.env.GMAIL_APP_PASSWORD
    if (!gmailUser || !gmailPass) {
      console.error('[J7] GMAIL_USER / GMAIL_APP_PASSWORD manquants dans functions/.env')
      return
    }

    // Fenêtre : aujourd'hui → aujourd'hui + 7 jours
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const limit7 = new Date(today)
    limit7.setDate(limit7.getDate() + 7)
    const dateFrom = today.toISOString().slice(0, 10)
    const dateTo = limit7.toISOString().slice(0, 10)

    const snap = await db.collection('commandes_externes')
      .where('dateLivraison', '>=', dateFrom)
      .where('dateLivraison', '<=', dateTo)
      .where('statut', 'in', ['En cours', 'Devis envoyé', 'Accepté'])
      .orderBy('dateLivraison', 'asc')
      .get()

    if (snap.empty) {
      console.log('[J7] Aucune commande dans les 7 prochains jours — email non envoyé')
      return
    }

    // Grouper par date de livraison
    const byDate: Record<string, FirebaseFirestore.DocumentData[]> = {}
    for (const d of snap.docs) {
      const cmd: FirebaseFirestore.DocumentData = { ...d.data(), _id: d.id }
      const dl = (cmd.dateLivraison as string)
      if (!byDate[dl]) byDate[dl] = []
      byDate[dl].push(cmd)
    }

    // Construire le corps HTML
    const formatDate = (iso: string) => {
      const [y, m, d] = iso.split('-')
      const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
      const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
      const dt = new Date(iso)
      return `${days[dt.getDay()]} ${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`
    }

    let htmlBody = `
      <div style="font-family: sans-serif; max-width: 640px; margin: 0 auto; color: #1c1c18;">
        <h2 style="color: #004275; border-bottom: 2px solid #004275; padding-bottom: 8px;">
          📋 Commandes — 7 prochains jours
        </h2>
        <p style="color: #5a5a55; font-size: 14px;">
          ${snap.size} commande(s) entre le <strong>${formatDate(dateFrom)}</strong> et le <strong>${formatDate(dateTo)}</strong>.
        </p>
    `

    for (const [date, cmds] of Object.entries(byDate)) {
      htmlBody += `
        <h3 style="color: #004275; margin-top: 24px; margin-bottom: 8px;">
          📅 ${formatDate(date)} — ${cmds.length} commande(s)
        </h3>
      `
      for (const cmd of cmds) {
        const statut = cmd.statut || '?'
        const couleurStatut = statut === 'Accepté' ? '#2d7a4f' : statut === 'Devis envoyé' ? '#004275' : '#b45309'
        const produitsList = Array.isArray(cmd.produits) && cmd.produits.length
          ? cmd.produits.map((p: any) => `${p.produit}${p.quantite ? ' × ' + p.quantite : ''}${p.unite ? ' ' + p.unite : ''}`).join(', ')
          : '—'

        htmlBody += `
          <div style="background: #f6f3ed; border-left: 4px solid ${couleurStatut}; padding: 12px 16px; margin-bottom: 10px; border-radius: 4px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <strong style="font-size: 15px;">${cmd.prenom || ''} ${cmd.nom || ''}</strong>
              <span style="background: ${couleurStatut}; color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 12px;">${statut}</span>
            </div>
            <div style="font-size: 13px; color: #5a5a55; margin-bottom: 4px;">
              🕐 ${cmd.heureLivraison || '?'} — ${cmd.mode || 'Livraison'}
              ${cmd.creneauHoraire ? ` — ${cmd.creneauHoraire}` : ''}
            </div>
            ${cmd.telephone ? `<div style="font-size: 13px; color: #5a5a55;">📞 ${cmd.telephone}</div>` : ''}
            ${cmd.adresseLivraison ? `<div style="font-size: 13px; color: #5a5a55;">📍 ${cmd.adresseLivraison}</div>` : ''}
            <div style="font-size: 13px; color: #1c1c18; margin-top: 6px;">🛒 ${produitsList}</div>
            ${cmd.prixEstime ? `<div style="font-size: 13px; color: #004275; margin-top: 4px; font-weight: 600;">💶 ${cmd.prixEstime} €</div>` : ''}
            ${cmd.instructionsSpeciales ? `<div style="font-size: 12px; color: #b45309; margin-top: 4px; font-style: italic;">⚠️ ${cmd.instructionsSpeciales}</div>` : ''}
          </div>
        `
      }
    }

    htmlBody += `
        <p style="font-size: 12px; color: #9a9a94; margin-top: 32px; border-top: 1px solid #ede9e1; padding-top: 12px;">
          Matias — récap automatique envoyé chaque matin à 8h.<br>
          Consulter toutes les commandes : <a href="https://cuisine-yorgios.web.app/corner/commandes" style="color: #004275;">App Matias</a>
        </p>
      </div>
    `

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass },
    })

    await transporter.sendMail({
      from: `"Matias" <${gmailUser}>`,
      to: 'a.cozzika@gmail.com',
      subject: `📋 Commandes J+7 — ${snap.size} commande(s) à venir`,
      html: htmlBody,
    })

    console.log(`[J7] Email envoyé — ${snap.size} commande(s) du ${dateFrom} au ${dateTo}`)
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
// COMMANDES — Action email : met à jour le statut via lien cliquable
// ─────────────────────────────────────────────────────────────────

export const updateCommandeStatus = onRequest(
  { region: 'europe-west1' },
  async (req, res) => {
    const { cmdId, statut, token } = req.query as Record<string, string>

    function htmlPage(title: string, body: string, color = '#004275') {
      return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:sans-serif;background:#fcf9f3;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#fff;border-radius:16px;padding:32px 28px;max-width:400px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(28,28,24,0.10)}
h1{color:${color};font-size:22px;margin:0 0 12px}p{color:#5a5a55;font-size:15px;line-height:1.6;margin:0 0 20px}
a{display:inline-block;background:${color};color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px}</style>
</head><body><div class="card">${body}</div></body></html>`
    }

    const STATUTS_VALIDES = ['Devis envoyé', 'Accepté', 'Refusé', 'Annulé']

    if (!cmdId || !statut || !token) {
      res.status(400).send(htmlPage('Erreur', '<h1>⚠️ Paramètres manquants</h1><p>Le lien est incomplet.</p>', '#c0392b'))
      return
    }
    if (!STATUTS_VALIDES.includes(statut)) {
      res.status(400).send(htmlPage('Erreur', '<h1>⚠️ Statut invalide</h1>', '#c0392b'))
      return
    }
    if (!verifyActionToken(cmdId, statut, token)) {
      res.status(403).send(htmlPage('Accès refusé', '<h1>🔒 Token invalide</h1><p>Ce lien n\'est pas valide ou a expiré.</p>', '#c0392b'))
      return
    }

    // Trouver la commande par son champ `id`
    const snap = await db.collection('commandes_externes').where('id', '==', cmdId).limit(1).get()
    if (snap.empty) {
      res.status(404).send(htmlPage('Introuvable', `<h1>🔍 Commande introuvable</h1><p>La commande <strong>${cmdId}</strong> n'existe pas.</p>`, '#b45309'))
      return
    }

    const docRef = snap.docs[0].ref
    const current = snap.docs[0].data()

    if (current.statut === statut) {
      res.send(htmlPage('Déjà à jour', `<h1>✅ Déjà mis à jour</h1><p>La commande <strong>${cmdId}</strong> est déjà au statut <strong>${statut}</strong>.</p><a href="https://cuisine-yorgios.web.app/corner/commandes">Voir dans l'app</a>`))
      return
    }

    await docRef.update({ statut, updatedAt: Timestamp.now(), updatedViaEmail: true })

    const colors: Record<string, string> = {
      'Accepté': '#2d7a4f',
      'Devis envoyé': '#004275',
      'Refusé': '#c0392b',
      'Annulé': '#9a9a94',
    }
    const c = colors[statut] || '#004275'
    res.send(htmlPage('Statut mis à jour', `<h1 style="color:${c}">✅ Statut mis à jour</h1><p>La commande <strong>${cmdId}</strong> — ${current.prenom || ''} ${current.nom || ''}<br>est maintenant : <strong style="color:${c}">${statut}</strong></p><a href="https://cuisine-yorgios.web.app/corner/commandes">Voir toutes les commandes</a>`))
  }
)

// ─────────────────────────────────────────────────────────────────
// COMMANDES — Relance email toutes les 6h pour commandes "En cours"
//   Horaires : 6h, 12h, 18h (Europe/Paris) — pas d'envoi entre 20h et 6h
// ─────────────────────────────────────────────────────────────────

export const relanceCommandes = onSchedule(
  { schedule: '0 6,12,18 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    const cfgSnap = await db.doc('settings/commandes_emails').get()
    const cfg = cfgSnap.data() ?? {}
    if (cfg.relanceEnabled === false) {
      console.log('[relance] Désactivé dans les paramètres.')
      return
    }
    const gmailUser = process.env.GMAIL_USER
    const gmailPass = process.env.GMAIL_APP_PASSWORD
    if (!gmailUser || !gmailPass) {
      console.error('[relance] GMAIL_USER / GMAIL_APP_PASSWORD manquants')
      return
    }

    const snap = await db.collection('commandes_externes')
      .where('statut', '==', 'En cours')
      .orderBy('dateSaisie', 'asc')
      .get()

    if (snap.empty) {
      console.log('[relance] Aucune commande En cours — email non envoyé')
      return
    }

    const formatDate = (iso: string) => {
      if (!iso) return '?'
      const [y, m, d] = iso.split('-')
      const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
      const months = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'aoû', 'sep', 'oct', 'nov', 'déc']
      const dt = new Date(iso)
      return `${days[dt.getDay()]} ${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`
    }

    const heureActuelle = new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })

    let htmlBody = `
      <div style="font-family:sans-serif;max-width:660px;margin:0 auto;color:#1c1c18;">
        <h2 style="color:#b45309;border-bottom:2px solid #b45309;padding-bottom:8px;">
          ⚠️ ${snap.size} commande(s) en attente de traitement
        </h2>
        <p style="color:#5a5a55;font-size:14px;">
          Relance automatique — ${heureActuelle} (Europe/Paris).<br>
          Ces commandes sont au statut <strong>En cours</strong> et nécessitent votre attention.
        </p>
    `

    for (const d of snap.docs) {
      const cmd = d.data()
      const produitsList = Array.isArray(cmd.produits) && cmd.produits.length
        ? cmd.produits.map((p: any) => `${p.produit}${p.quantite ? ' × ' + p.quantite : ''}${p.unite ? ' ' + p.unite : ''}`).join(', ')
        : '—'

      const linkDevis  = actionLink(cmd.id, 'Devis envoyé')
      const linkAccept = actionLink(cmd.id, 'Accepté')

      htmlBody += `
        <div style="background:#f6f3ed;border-left:4px solid #b45309;padding:14px 16px;margin-bottom:14px;border-radius:6px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:6px;">
            <strong style="font-size:15px;">${cmd.prenom || ''} ${cmd.nom || ''}</strong>
            <span style="font-size:11px;font-weight:700;color:#5a5a55;">${cmd.id}</span>
          </div>
          <div style="font-size:13px;color:#5a5a55;margin-bottom:4px;">
            📅 Livraison : <strong>${formatDate(cmd.dateLivraison)}</strong> à ${cmd.heureLivraison || '?'}
          </div>
          ${cmd.telephone ? `<div style="font-size:13px;color:#5a5a55;">📞 ${cmd.telephone}</div>` : ''}
          ${cmd.email ? `<div style="font-size:13px;color:#5a5a55;">✉️ ${cmd.email}</div>` : ''}
          <div style="font-size:13px;color:#1c1c18;margin-top:6px;">🛒 ${produitsList}</div>
          ${cmd.prixEstime ? `<div style="font-size:13px;color:#004275;margin-top:4px;font-weight:600;">💶 ${parseFloat(cmd.prixEstime).toFixed(2)} €</div>` : ''}
          ${cmd.instructionsSpeciales ? `<div style="font-size:12px;color:#b45309;margin-top:4px;font-style:italic;">⚠️ ${cmd.instructionsSpeciales}</div>` : ''}
          <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;">
            <a href="${linkDevis}" style="background:#004275;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
              📄 Devis envoyé
            </a>
            <a href="${linkAccept}" style="background:#2d7a4f;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
              ✅ Commande acceptée
            </a>
          </div>
        </div>
      `
    }

    htmlBody += `
        <p style="font-size:12px;color:#9a9a94;margin-top:32px;border-top:1px solid #ede9e1;padding-top:12px;">
          Matias — relance automatique toutes les 6h (06h·12h·18h).<br>
          Pas d'envoi entre 20h et 6h.<br>
          <a href="https://cuisine-yorgios.web.app/corner/commandes" style="color:#004275;">Gérer toutes les commandes dans l'app</a>
        </p>
      </div>
    `

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass },
    })

    const destList: string[] = Array.isArray(cfg.destinataires) && cfg.destinataires.length > 0
      ? cfg.destinataires
      : ['a.cozzika@gmail.com']
    await transporter.sendMail({
      from: `"Matias" <${gmailUser}>`,
      to: destList,
      subject: `⚠️ ${snap.size} commande(s) En cours — action requise`,
      html: htmlBody,
    })

    console.log(`[relance] Email envoyé — ${snap.size} commande(s) En cours`)
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

export const sendPasswordReset = onCall(
  { region: 'europe-west1' },
  async (request) => {
    // Garde : réservé à 'administrateur' UNIQUEMENT (aligné sur updateUserPassword).
    // Retourne un resetLink que l'appelant peut utiliser sur n'importe quel compte →
    // c'est une capacité de reset de credential, donc même périmètre que updateUserPassword
    // (un patron ne doit pas pouvoir réinitialiser un administrateur).
    // Le "mot de passe oublié" public du login passe par sendPasswordResetEmail côté client.
    if (!request.auth) throw new HttpsError('unauthenticated', 'Non authentifié')
    const callerSnap = await db.collection('users').doc(request.auth.uid).get()
    if (callerSnap.data()?.role !== 'administrateur') {
      throw new HttpsError('permission-denied', 'Réservé à l\'administrateur')
    }

    const { email } = request.data as { email: string }
    if (!email) throw new HttpsError('invalid-argument', 'Email manquant')

    const gmailUser = process.env.GMAIL_USER
    const gmailPass = process.env.GMAIL_APP_PASSWORD
    if (!gmailUser || !gmailPass) throw new HttpsError('internal', 'Configuration email manquante')

    // Génère le lien Firebase (sécurisé, expire en 1h)
    const resetLink = await getAuth().generatePasswordResetLink(email)

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass },
    })

    await transporter.sendMail({
      from: `"Matias" <${gmailUser}>`,
      to: email,
      subject: 'Réinitialisation du mot de passe Matias',
      text: [
        `Bonjour,`,
        ``,
        `Une demande de réinitialisation de mot de passe a été effectuée pour votre compte Matias.`,
        ``,
        `Le lien de réinitialisation vous a été communiqué directement dans l'application.`,
        `Il est valable 1 heure.`,
        ``,
        `Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.`,
        ``,
        `L'équipe Matias`,
      ].join('\n'),
    })

    return { ok: true, resetLink }
  }
)

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

    // Anti-escalade : seul un administrateur peut agir sur un compte administrateur.
    const targetSnap = await db.collection('users').doc(uid).get()
    if (targetSnap.data()?.role === 'administrateur' && callerSnap.data()?.role !== 'administrateur') {
      throw new HttpsError('permission-denied', 'Seul un administrateur peut agir sur un compte administrateur')
    }

    await getAuth().deleteUser(uid)
    await db.collection('users').doc(uid).delete()

    return { ok: true }
  }
)

// ─────────────────────────────────────────────────────────────────

export const updateUserPassword = onCall(
  { region: 'europe-west1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Non authentifié')

    const callerSnap = await db.collection('users').doc(request.auth.uid).get()
    if (callerSnap.data()?.role !== 'administrateur') {
      throw new HttpsError('permission-denied', 'Réservé à l\'administrateur')
    }

    const { uid, password } = request.data as { uid: string; password: string }
    if (!uid)                     throw new HttpsError('invalid-argument', 'uid manquant')
    if (!password || password.length < 6) throw new HttpsError('invalid-argument', 'Mot de passe minimum 6 caractères')

    await getAuth().updateUser(uid, { password })
    return { ok: true }
  }
)

// ─────────────────────────────────────────────────────────────────
// ADMIN — Mettre à jour l'email d'un utilisateur
// ─────────────────────────────────────────────────────────────────

export const updateUserEmail = onCall(
  { region: 'europe-west1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Non authentifié')

    const callerSnap = await db.collection('users').doc(request.auth.uid).get()
    if (!['patron', 'administrateur'].includes(callerSnap.data()?.role)) {
      throw new HttpsError('permission-denied', 'Réservé au patron / administrateur')
    }

    const { uid, email } = request.data as { uid: string; email: string }
    if (!uid) throw new HttpsError('invalid-argument', 'uid manquant')
    if (!email || !email.includes('@')) throw new HttpsError('invalid-argument', 'Email invalide')
    if (uid === request.auth.uid) throw new HttpsError('invalid-argument', 'Impossible de modifier son propre email ici')

    // Anti-escalade : seul un administrateur peut agir sur un compte administrateur.
    const targetSnap = await db.collection('users').doc(uid).get()
    if (targetSnap.data()?.role === 'administrateur' && callerSnap.data()?.role !== 'administrateur') {
      throw new HttpsError('permission-denied', 'Seul un administrateur peut agir sur un compte administrateur')
    }

    await getAuth().updateUser(uid, { email })
    await db.collection('users').doc(uid).update({ email, updatedAt: Timestamp.now() })

    return { ok: true }
  }
)

// ─────────────────────────────────────────────────────────────────
// ADMIN — Désactiver / réactiver un compte utilisateur
// ─────────────────────────────────────────────────────────────────

export const setUserDisabled = onCall(
  { region: 'europe-west1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Non authentifié')

    const callerSnap = await db.collection('users').doc(request.auth.uid).get()
    if (!['patron', 'administrateur'].includes(callerSnap.data()?.role)) {
      throw new HttpsError('permission-denied', 'Réservé au patron / administrateur')
    }

    const { uid, disabled, disabledUntil } = request.data as {
      uid: string; disabled: boolean; disabledUntil?: string // ISO date YYYY-MM-DD
    }
    if (!uid) throw new HttpsError('invalid-argument', 'uid manquant')
    if (uid === request.auth.uid) throw new HttpsError('invalid-argument', 'Impossible de désactiver son propre compte')

    // Anti-escalade : seul un administrateur peut agir sur un compte administrateur.
    const targetSnap = await db.collection('users').doc(uid).get()
    if (targetSnap.data()?.role === 'administrateur' && callerSnap.data()?.role !== 'administrateur') {
      throw new HttpsError('permission-denied', 'Seul un administrateur peut agir sur un compte administrateur')
    }

    await getAuth().updateUser(uid, { disabled })
    await db.collection('users').doc(uid).update({
      disabled,
      disabledUntil: disabledUntil ?? null,
      updatedAt: Timestamp.now(),
    })

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
      ['corner', 'patron', 'administrateur', 'manager'],
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
      ['corner', 'patron', 'administrateur', 'manager'],
    )
    console.log('[11h] Notif plats du jour envoyée.')
  }
)

// ─────────────────────────────────────────────────────────────────
// UTILITAIRE — Timestamp Paris pour une heure donnée d'un jour donné
// ─────────────────────────────────────────────────────────────────

function buildParisTimestamp(dateISO: string, hour: number, minute = 0): FirebaseFirestore.Timestamp {
  // noonUTC sert à détecter l'offset DST Paris (été/hiver) pour ce jour
  const noonUTC = new Date(`${dateISO}T12:00:00Z`)
  const parisNoonH = parseInt(noonUTC.toLocaleString('en-US', {
    timeZone: 'Europe/Paris', hour: 'numeric', hour12: false,
  }))
  const offsetH = parisNoonH - 12 // +2 été, +1 hiver
  const utcHour = hour - offsetH
  const d = new Date(`${dateISO}T00:00:00Z`)
  d.setUTCHours(utcHour, minute, 0, 0)
  return Timestamp.fromDate(d)
}

// ─────────────────────────────────────────────────────────────────
// UTILITAIRE — Chargement du shift d'un employé depuis le planning
// ─────────────────────────────────────────────────────────────────

async function getEmployeeShift(dateISO: string, employeeId: string) {
  const dateObj = new Date(dateISO + 'T12:00:00Z')
  const jsDay = dateObj.getUTCDay()
  const dayIndex = jsDay === 0 ? 6 : jsDay - 1
  const monday = new Date(dateObj)
  monday.setUTCDate(monday.getUTCDate() - dayIndex)
  const weekId = monday.toISOString().slice(0, 10)

  const daySnap = await db.doc(`planningWeeks/${weekId}/days/${dayIndex}`).get()
  if (!daySnap.exists) return null
  const hoursMap = daySnap.data()?.hours as Record<string, string[]> | undefined
  if (!hoursMap) return null

  const workedHours = Object.entries(hoursMap)
    .filter(([, emps]) => (emps as string[]).includes(employeeId))
    .map(([h]) => parseInt(h))
    .sort((a, b) => a - b)
  if (!workedHours.length) return null

  return { weekId, dayIndex, firstHour: workedHours[0], lastHour: workedHours[workedHours.length - 1] }
}

// ─────────────────────────────────────────────────────────────────
// POINTAGE — Retard → email HTML tous responsables + event planning
// ─────────────────────────────────────────────────────────────────

export const onPointageLate = onDocumentCreated(
  { document: 'pointages/{id}', region: 'europe-west1', database: 'test' },
  async (event) => {
    const data = event.data?.data()
    if (!data) return
    if (data.typePointage !== 'arrivée' || data.statut !== 'validé') return

    const userSnap = await db.collection('users').doc(data.userId).get()
    const employeeId = userSnap.data()?.employeeId as string | undefined
    if (!employeeId) {
      console.log(`[retard] ${data.userName} sans lien planning — ignoré.`)
      return
    }

    const shift = await getEmployeeShift(data.date as string, employeeId)
    if (!shift) return

    const pointageTime = (data.timestamp as FirebaseFirestore.Timestamp).toDate()
    const parisLocale = pointageTime.toLocaleString('fr-FR', {
      timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const [hStr, mStr] = parisLocale.split(':')
    const actualMinutes = parseInt(hStr) * 60 + parseInt(mStr)
    const lateMinutes = actualMinutes - shift.firstHour * 60

    // Stocker les minutes de retard sur le doc pointage (no-loop : onDocumentCreated ne refire pas sur update)
    await event.data!.ref.update({
      lateMinutes: lateMinutes > 0 ? lateMinutes : 0,
      plannedStartHour: shift.firstHour,
      plannedEndHour: shift.lastHour + 1,
    })

    if (lateMinutes <= 10) {
      console.log(`[retard] ${data.userName} à l'heure (${lateMinutes} min).`)
      return
    }

    // Créer / mettre à jour l'event retard dans le planning
    const eventsRef = db.doc(`planningWeeks/${shift.weekId}/events/${data.date}`)
    const eventsSnap = await eventsRef.get()
    const existingEvents: any[] = eventsSnap.exists ? (eventsSnap.data()?.events ?? []) : []
    const filtered = existingEvents.filter((e: any) => !(e.empId === employeeId && e.type === 'retard'))
    filtered.push({ empId: employeeId, type: 'retard', minutes: lateMinutes })
    await eventsRef.set(
      { date: data.date, events: filtered, updatedAt: Timestamp.now(), updatedBy: 'system' },
      { merge: true },
    )

    // Push FCM aux responsables
    await notifyRoles(
      `⏰ Retard — ${data.userName}`,
      `Prévu ${shift.firstHour}h00, pointé ${parisLocale} (+${lateMinutes} min)`,
      '/admin/pointages',
      ['patron', 'administrateur', 'manager'],
    )

    // Email HTML à tous les responsables
    const gmailUser = process.env.GMAIL_USER
    const gmailPass = process.env.GMAIL_APP_PASSWORD
    if (!gmailUser || !gmailPass) return

    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } })
    const dayLabel = new Date(data.date + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
        <div style="background:#b45309;padding:18px 22px;border-radius:10px 10px 0 0">
          <h2 style="color:#fff;margin:0;font-size:18px">⏰ Retard — ${data.userName}</h2>
          <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px">Yorgios · ${dayLabel}</p>
        </div>
        <div style="background:#fff;border:1px solid #e5e5e5;border-top:none;padding:22px;border-radius:0 0 10px 10px">
          <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
            <tr><td style="padding:7px 0;color:#666;font-size:13px;width:140px">Employé</td><td style="font-weight:700;color:#1a1a1a">${data.userName}</td></tr>
            <tr style="background:#fafafa"><td style="padding:7px 0;color:#666;font-size:13px">Heure prévue</td><td style="font-weight:600;color:#1a1a1a">${shift.firstHour}h00</td></tr>
            <tr><td style="padding:7px 0;color:#666;font-size:13px">Heure pointée</td><td style="font-weight:700;color:#b45309">${parisLocale}</td></tr>
            <tr style="background:#fafafa"><td style="padding:7px 0;color:#666;font-size:13px">Retard</td><td style="font-weight:700;color:#c0392b;font-size:16px">+${lateMinutes} minutes</td></tr>
            <tr><td style="padding:7px 0;color:#666;font-size:13px">Zone</td><td style="color:#1a1a1a">${data.zoneLabel}</td></tr>
          </table>
          <p style="margin:0;font-size:12px;color:#999">Ce retard a été automatiquement enregistré dans le récapitulatif mensuel.</p>
        </div>
      </div>`

    const alertTo = await getAlertEmails()
    await transporter.sendMail({
      from: `"Matias" <${gmailUser}>`,
      to: alertTo,
      subject: `⏰ Retard ${data.userName} — ${lateMinutes} min (${dayLabel})`,
      html,
    }).catch((e: any) => console.error('[retard] Email error:', e))
    console.log(`[retard] Email + event planning créés pour ${data.userName} (${lateMinutes} min).`)
  }
)

// ─────────────────────────────────────────────────────────────────
// AUTO-CHECKOUT — Toutes les 30 min : crée pointage sortie automatique
// si l'employé n'a pas pointé sa sortie 1h après la fin de shift prévue
// ─────────────────────────────────────────────────────────────────

export const autoCheckoutSortie = onSchedule(
  { schedule: '*/30 7-23 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' })
    const parisNow = new Date().toLocaleString('fr-FR', {
      timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const [nowH, nowM] = parisNow.split(':').map(Number)
    const nowTotalMin = nowH * 60 + nowM

    // Tous les arrivées validées d'aujourd'hui
    const arrivees = await db.collection('pointages')
      .where('date', '==', today)
      .where('typePointage', '==', 'arrivée')
      .where('statut', '==', 'validé')
      .get()
    if (arrivees.empty) return

    for (const arriveeDoc of arrivees.docs) {
      const d = arriveeDoc.data()
      const userId = d.userId as string

      // Vérifier si un départ existe déjà (validé ou auto)
      const departSnap = await db.collection('pointages')
        .where('userId', '==', userId)
        .where('date', '==', today)
        .where('typePointage', '==', 'départ')
        .limit(1)
        .get()
      if (!departSnap.empty) continue

      // Récupérer le shift depuis le planning
      const userSnap = await db.collection('users').doc(userId).get()
      const employeeId = userSnap.data()?.employeeId as string | undefined
      if (!employeeId) continue

      const shift = await getEmployeeShift(today, employeeId)
      if (!shift) continue

      const shiftEndMin = (shift.lastHour + 1) * 60  // ex: lastHour=14 → fin 15h = 900 min
      if (nowTotalMin < shiftEndMin + 60) continue    // pas encore 1h après la fin

      // Créer le pointage sortie automatique à l'heure de fin prévue
      const userName = userSnap.data()?.displayName || userSnap.data()?.email?.split('@')[0] || 'Inconnu'
      const plannedEndTimestamp = buildParisTimestamp(today, shift.lastHour + 1)

      await db.collection('pointages').add({
        userId,
        userName,
        date: today,
        typePointage: 'départ',
        zoneId: 'auto',
        zoneLabel: 'Automatique (fin de shift)',
        timestamp: plannedEndTimestamp,
        latitude: 0, longitude: 0, accuracy: 0, distanceToZone: 0,
        statut: 'validé',
        autoCheckout: true,
        plannedEndHour: shift.lastHour + 1,
        _serverValidated: true,
      })
      console.log(`[auto-checkout] Sortie créée pour ${userName} — shift fin ${shift.lastHour + 1}h`)
    }
  }
)

// ─────────────────────────────────────────────────────────────────
// DÉTECTION NO-SHOW — Toutes les 30 min : un employé PRÉVU au planning
// qui n'a jamais pointé son arrivée (≥ 30 min après l'heure de début).
// Comble le trou : onPointageLate ne se déclenche QUE s'il y a un pointage,
// donc "ne rien faire" rendait l'absent invisible. Ici on part du planning.
// Action = ALERTE SEULEMENT (FCM + email) — aucun événement écrit dans le
// planning : le manager qualifie lui-même (absence / congé / oubli de pointage).
// ─────────────────────────────────────────────────────────────────

const NO_SHOW_GRACE_MIN = 30

export const detectNoShow = onSchedule(
  { schedule: '*/30 7-23 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' })
    const parisNow = new Date().toLocaleString('fr-FR', {
      timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const [nowH, nowM] = parisNow.split(':').map(Number)
    const nowTotalMin = nowH * 60 + nowM

    // weekId + dayIndex d'aujourd'hui (même calcul que getEmployeeShift)
    const dateObj = new Date(today + 'T12:00:00Z')
    const jsDay = dateObj.getUTCDay()
    const dayIndex = jsDay === 0 ? 6 : jsDay - 1
    const monday = new Date(dateObj)
    monday.setUTCDate(monday.getUTCDate() - dayIndex)
    const weekId = monday.toISOString().slice(0, 10)

    const daySnap = await db.doc(`planningWeeks/${weekId}/days/${dayIndex}`).get()
    if (!daySnap.exists) return
    const hoursMap = daySnap.data()?.hours as Record<string, string[]> | undefined
    if (!hoursMap) return

    // Heure de début prévue par employé (1re heure travaillée)
    const firstHourByEmp: Record<string, number> = {}
    for (const [h, emps] of Object.entries(hoursMap)) {
      const hour = parseInt(h)
      for (const empId of (emps as string[])) {
        if (firstHourByEmp[empId] === undefined || hour < firstHourByEmp[empId]) firstHourByEmp[empId] = hour
      }
    }
    const scheduledEmpIds = Object.keys(firstHourByEmp)
    if (!scheduledEmpIds.length) return

    // Employés déjà couverts par une absence/congé/maladie ce jour → exclus (pas de no-show)
    const eventsSnap = await db.doc(`planningWeeks/${weekId}/events/${today}`).get()
    const dayEvents: any[] = eventsSnap.exists ? (eventsSnap.data()?.events ?? []) : []
    const coveredEmps = new Set(
      dayEvents
        .filter((e: any) => ['conge', 'malade', 'absence', 'sans_solde', 'jour_off'].includes(e.type))
        .map((e: any) => e.empId),
    )

    for (const empId of scheduledEmpIds) {
      if (coveredEmps.has(empId)) continue

      const firstHour = firstHourByEmp[empId]
      // Pas encore l'heure (+ grâce) → on attend
      if (nowTotalMin < firstHour * 60 + NO_SHOW_GRACE_MIN) continue

      // Idempotence : déjà alerté aujourd'hui pour cet employé ?
      const markerRef = db.doc(`pointages_noshow/${today}_${empId}`)
      if ((await markerRef.get()).exists) continue

      // Retrouver le compte utilisateur lié (nécessaire pour vérifier le pointage)
      const usersSnap = await db.collection('users').where('employeeId', '==', empId).limit(1).get()
      if (usersSnap.empty) {
        // Employé non lié à un compte → ne peut pas pointer → on n'alerte pas (sinon bruit quotidien)
        console.log(`[no-show] ${empId} sans compte lié — ignoré.`)
        continue
      }
      const userId = usersSnap.docs[0].id

      // A-t-il pointé son arrivée aujourd'hui ?
      const arrSnap = await db.collection('pointages')
        .where('userId', '==', userId)
        .where('date', '==', today)
        .where('typePointage', '==', 'arrivée')
        .where('statut', '==', 'validé')
        .limit(1)
        .get()
      if (!arrSnap.empty) continue  // présent → onPointageLate gère l'éventuel retard

      // → NO-SHOW confirmé. Nom de l'employé pour l'alerte.
      const empSnap = await db.doc(`employees/${empId}`).get()
      const empName = (empSnap.data()?.name as string) || usersSnap.docs[0].data()?.displayName || 'Employé'
      const dayLabel = new Date(today + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

      // Marqueur AVANT l'envoi (évite double alerte si l'envoi traîne sur deux ticks)
      await markerRef.set({
        date: today, employeeId: empId, employeeName: empName,
        plannedStartHour: firstHour, alertedAt: Timestamp.now(),
      })

      await notifyRoles(
        `🚫 Absent non pointé — ${empName}`,
        `Prévu ${firstHour}h00, toujours pas pointé (+${nowTotalMin - firstHour * 60} min). À vérifier.`,
        '/admin/pointages',
        ['patron', 'administrateur', 'manager'],
      )

      const gmailUser = process.env.GMAIL_USER
      const gmailPass = process.env.GMAIL_APP_PASSWORD
      if (!gmailUser || !gmailPass) { console.log(`[no-show] ${empName} — alerte FCM seule (pas d'email configuré).`); continue }

      const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } })
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
          <div style="background:#c0392b;padding:18px 22px;border-radius:10px 10px 0 0">
            <h2 style="color:#fff;margin:0;font-size:18px">🚫 Absent non pointé — ${empName}</h2>
            <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:13px">Yorgios · ${dayLabel}</p>
          </div>
          <div style="background:#fff;border:1px solid #e5e5e5;border-top:none;padding:22px;border-radius:0 0 10px 10px">
            <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
              <tr><td style="padding:7px 0;color:#666;font-size:13px;width:160px">Employé</td><td style="font-weight:700;color:#1a1a1a">${empName}</td></tr>
              <tr style="background:#fafafa"><td style="padding:7px 0;color:#666;font-size:13px">Heure prévue</td><td style="font-weight:600;color:#1a1a1a">${firstHour}h00</td></tr>
              <tr><td style="padding:7px 0;color:#666;font-size:13px">Statut</td><td style="font-weight:700;color:#c0392b">Aucun pointage d'arrivée</td></tr>
            </table>
            <p style="margin:0;font-size:12px;color:#999">Alerte automatique. Aucune absence n'a été inscrite au planning — à qualifier manuellement (absence, congé, ou simple oubli de pointage).</p>
          </div>
        </div>`

      const alertTo = await getAlertEmails()
      await transporter.sendMail({
        from: `"Matias" <${gmailUser}>`,
        to: alertTo,
        subject: `🚫 Absent non pointé — ${empName} (${dayLabel})`,
        html,
      }).catch((e: any) => console.error('[no-show] Email error:', e))
      console.log(`[no-show] Alerte envoyée pour ${empName} (prévu ${firstHour}h, non pointé).`)
    }
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
// LIVRAISON — Réception corner → notif + email patron + admin + manager
// Se déclenche à la mise à jour d'un doc livraisons/ quand
// receptionAt passe de null à une valeur saisie
// ─────────────────────────────────────────────────────────────────

const RESPONSABLES_EMAILS_FALLBACK = ['a.cozzika@gmail.com', 'kyriazis@outlook.fr', 'sebastien.coenca@gmail.com']

async function getAlertEmails(): Promise<string[]> {
  const snap = await db.doc('settings/alert_emails').get()
  const list = (snap.data()?.responsables as string[]) ?? []
  return list.length > 0 ? list : RESPONSABLES_EMAILS_FALLBACK
}

export const onLivraisonReception = onDocumentUpdated(
  { document: 'livraisons/{livId}', region: 'europe-west1', database: 'test' },
  async (event) => {
    const before = event.data?.before?.data()
    const after  = event.data?.after?.data()
    if (!before || !after) return

    // Ne déclencher que quand receptionAt passe de absent à défini (réception enregistrée)
    if (before.receptionAt != null) return
    if (after.receptionAt == null) return

    const produit = (after.productName as string) || 'produit inconnu'
    const lot = (after.lotCode as string) || event.params.livId
    const tempC = after.receptionTempC as number | null
    const maxTol = after.ruleMaxTol as number | null
    const result = (after.result as string) || 'A_VERIFIER'
    const emoji = result === 'ACCEPTE' ? '✅' : result === 'REFUSE' ? '❌' : '⚠️'

    const tempLabel = tempC != null ? `${tempC}°C` : 'sans temp.'
    await notifyRoles(
      `${emoji} Réception corner — ${produit}`,
      `Réception : ${tempLabel} (${result}) · Lot ${lot}`,
      '/corner/livraison',
      ['patron', 'administrateur', 'manager'],
    )
    console.log(`[livraison-reception] Notif envoyée pour lot ${lot} — ${tempLabel} ${result}`)

    if (result === 'REFUSE') {
      const gmailUser = process.env.GMAIL_USER
      const gmailPass = process.env.GMAIL_APP_PASSWORD
      if (!gmailUser || !gmailPass) return
      const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } })
      const now = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
          <div style="background:#c0392b;padding:20px 24px;border-radius:10px 10px 0 0">
            <h2 style="color:#fff;margin:0;font-size:20px">❌ ALERTE — Produit refusé à la réception</h2>
            <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px">Action immédiate requise — Yorgios Corner</p>
          </div>
          <div style="background:#fff;border:1px solid #e5e5e5;border-top:none;padding:24px;border-radius:0 0 10px 10px">
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
              <tr><td style="padding:8px 0;color:#666;font-size:13px;width:140px">Produit</td><td style="padding:8px 0;font-weight:700;font-size:15px;color:#1a1a1a">${produit}</td></tr>
              <tr style="background:#fafafa"><td style="padding:8px 0;color:#666;font-size:13px">N° lot</td><td style="padding:8px 0;font-weight:600;color:#1a1a1a">${lot}</td></tr>
              <tr><td style="padding:8px 0;color:#666;font-size:13px">Température mesurée</td><td style="padding:8px 0;font-weight:700;color:#c0392b;font-size:16px">${tempC != null ? `${tempC}°C` : '—'}</td></tr>
              <tr style="background:#fafafa"><td style="padding:8px 0;color:#666;font-size:13px">Tolérance max GEP</td><td style="padding:8px 0;font-weight:600;color:#1a1a1a">${maxTol != null ? `${maxTol}°C` : '—'}</td></tr>
              <tr><td style="padding:8px 0;color:#666;font-size:13px">Date / heure</td><td style="padding:8px 0;color:#1a1a1a">${now}</td></tr>
              <tr style="background:#fafafa"><td style="padding:8px 0;color:#666;font-size:13px">Statut</td><td style="padding:8px 0;font-weight:700;color:#c0392b">⛔ REFUSÉ — EN ATTENTE D'ACTION</td></tr>
            </table>
            <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px;margin-bottom:20px">
              <p style="margin:0;font-weight:700;color:#856404;font-size:14px">Action requise :</p>
              <ul style="margin:8px 0 0;padding-left:20px;color:#856404;font-size:13px">
                <li>Consulter la décision prise par le corner (retour / quarantaine / destruction)</li>
                <li>Valider ou modifier la décision dans l'application</li>
                <li>Informer le fournisseur si nécessaire</li>
                <li>Archiver le bon de non-conformité</li>
              </ul>
            </div>
            <a href="https://cuisine-yorgios.web.app/corner/livraison" style="display:inline-block;background:#004275;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Voir dans l'application →</a>
            <p style="margin:20px 0 0;font-size:11px;color:#999">Un email de confirmation avec la décision du corner sera envoyé dès qu'elle sera enregistrée.</p>
          </div>
        </div>`
      const alertTo = await getAlertEmails()
      await transporter.sendMail({
        from: `"Matias" <${gmailUser}>`,
        to: alertTo,
        subject: `❌ ALERTE réception — ${produit} refusé (${tempC != null ? `${tempC}°C` : '?'})`,
        html,
      }).catch((e: any) => console.error('[livraison-reception] Email error:', e))
      console.log(`[livraison-reception] Email REFUSE envoyé pour lot ${lot}`)
    }
  }
)

// ─────────────────────────────────────────────────────────────────
// NON-CONFORMITÉ — Email décision corner → patron + admin + manager
// Se déclenche à la création d'un doc non_conformites/
// ─────────────────────────────────────────────────────────────────

export const onNonConformiteCreated = onDocumentCreated(
  { document: 'non_conformites/{ncId}', region: 'europe-west1', database: 'test' },
  async (event) => {
    const data = event.data?.data()
    if (!data) return

    const produit = (data.productName as string) || 'produit inconnu'
    const lot = (data.lotCode as string) || event.params.ncId
    const tempC = data.tempC as number | null
    const decision = (data.decision as string) || '—'
    const now = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })

    const gmailUser = process.env.GMAIL_USER
    const gmailPass = process.env.GMAIL_APP_PASSWORD
    if (!gmailUser || !gmailPass) return
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } })

    const decisionColor = decision.toLowerCase().includes('destruct') ? '#c0392b'
      : decision.toLowerCase().includes('quarant') ? '#e67e22'
      : '#2980b9'

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
        <div style="background:#856404;padding:20px 24px;border-radius:10px 10px 0 0">
          <h2 style="color:#fff;margin:0;font-size:20px">📋 Décision non-conformité enregistrée</h2>
          <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px">Le corner a enregistré une décision — Yorgios Corner</p>
        </div>
        <div style="background:#fff;border:1px solid #e5e5e5;border-top:none;padding:24px;border-radius:0 0 10px 10px">
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
            <tr><td style="padding:8px 0;color:#666;font-size:13px;width:140px">Produit</td><td style="padding:8px 0;font-weight:700;font-size:15px;color:#1a1a1a">${produit}</td></tr>
            <tr style="background:#fafafa"><td style="padding:8px 0;color:#666;font-size:13px">N° lot</td><td style="padding:8px 0;font-weight:600;color:#1a1a1a">${lot}</td></tr>
            <tr><td style="padding:8px 0;color:#666;font-size:13px">Température mesurée</td><td style="padding:8px 0;font-weight:700;color:#c0392b">${tempC != null ? `${tempC}°C` : '—'}</td></tr>
            <tr style="background:#fafafa"><td style="padding:8px 0;color:#666;font-size:13px">Date / heure</td><td style="padding:8px 0;color:#1a1a1a">${now}</td></tr>
            <tr><td style="padding:8px 0;color:#666;font-size:13px">Décision corner</td><td style="padding:8px 0;font-weight:700;color:${decisionColor};font-size:15px">${decision}</td></tr>
          </table>
          <div style="background:#f8f9fa;border:1px solid #dee2e6;border-radius:8px;padding:16px;margin-bottom:20px">
            <p style="margin:0;font-weight:700;color:#495057;font-size:14px">À valider de votre côté :</p>
            <ul style="margin:8px 0 0;padding-left:20px;color:#495057;font-size:13px">
              <li>Confirmer la décision prise par le corner</li>
              <li>Remplir le bon de non-conformité papier si nécessaire</li>
              <li>Notifier le fournisseur / faire un avoir</li>
            </ul>
          </div>
          <a href="https://cuisine-yorgios.web.app/corner/livraison" style="display:inline-block;background:#004275;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Voir dans l'application →</a>
        </div>
      </div>`

    const alertTo = await getAlertEmails()
    await transporter.sendMail({
      from: `"Matias" <${gmailUser}>`,
      to: alertTo,
      subject: `📋 NC — ${produit} : ${decision}`,
      html,
    }).catch((e: any) => console.error('[nc-created] Email error:', e))
    console.log(`[nc-created] Email décision envoyé pour lot ${lot} — ${decision}`)
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

/** Dimanche 10h00 — Rappel arrosage Costas (corner + patron + admin + manager) */
export const notifCostas = onSchedule(
  { schedule: '0 10 * * 0', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    const cfgSnap = await db.doc('settings/notifications').get()
    const cfg = cfgSnap.data() ?? {}
    if (cfg.costas?.push === false) {
      console.log('[dimanche 10h] notifCostas push désactivé.')
      return
    }
    await notifyRoles(
      'Costas a soif ! 🌱',
      "N'oublie pas de donner de l'eau à Costas aujourd'hui.",
      '/corner',
      ['corner', 'patron', 'administrateur', 'manager'],
    )
    console.log('[dimanche 10h] Notif Costas envoyée.')
  }
)

/** Lundi 8h00 — Récap hebdo hygiène + températures manquantes (email patron + manager) */
export const weeklyHygieneRecap = onSchedule(
  { schedule: '0 8 * * 1', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    const cfgSnap = await db.doc('settings/notifications').get()
    const cfg = cfgSnap.data() ?? {}
    if (cfg.weeklyHygieneLundi?.email === false) {
      console.log('[lundi 8h] weeklyHygieneRecap email désactivé.')
      return
    }
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
// GMAO — Email à Christelle (callable) + rappel hebdo lundi 9h
// ─────────────────────────────────────────────────────────────────

export const sendGmaoEmail = onCall({ region: 'europe-west1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Auth required')
  const { demandeId, to, customBody } = request.data as { demandeId: string; to: string; customBody?: string }

  const demandeSnap = await db.collection('gmao_demandes').doc(demandeId).get()
  if (!demandeSnap.exists) throw new HttpsError('not-found', 'Demande introuvable')
  const d = demandeSnap.data() as any

  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass },
  })

  const bodyHtml = customBody
    ? `<pre style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap;line-height:1.6">${customBody}</pre>`
    : `
      <h2>Demande GMAO</h2>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:8px;font-weight:bold;background:#f5f5f5">Département</td><td style="padding:8px">${d.departement}</td></tr>
        <tr><td style="padding:8px;font-weight:bold;background:#f5f5f5">Motif</td><td style="padding:8px">${d.motif}</td></tr>
        <tr><td style="padding:8px;font-weight:bold;background:#f5f5f5">Date</td><td style="padding:8px">${d.date}</td></tr>
        <tr><td style="padding:8px;font-weight:bold;background:#f5f5f5">N° intervention</td><td style="padding:8px">${d.numeroIntervention || '—'}</td></tr>
        <tr><td style="padding:8px;font-weight:bold;background:#f5f5f5">Statut</td><td style="padding:8px">${d.statut}</td></tr>
      </table>
      ${d.photoUrl ? `<br><a href="${d.photoUrl}">📎 Voir le document joint</a>` : ''}
    `

  await transporter.sendMail({
    from: `"Matias App" <${gmailUser}>`,
    to,
    cc: 'jlemperiere@la-grande-epicerie.fr',
    subject: `[GMAO] ${d.departement} — ${String(d.motif ?? '').substring(0, 60)} — YORGIOS`,
    html: bodyHtml,
  })
  return { success: true }
})

export const gmaoWeeklyReminder = onSchedule({
  schedule: 'every monday 09:00',
  timeZone: 'Europe/Paris',
  region: 'europe-west1',
}, async () => {
  const cfgSnap = await db.doc('settings/notifications').get()
  const cfg = cfgSnap.data() ?? {}
  if (cfg.gmaoRappelLundi?.email === false) {
    console.log('[lundi 9h] gmaoWeeklyReminder email désactivé.')
    return
  }
  const snap = await db.collection('gmao_demandes').where('statut', '==', 'en cours').get()
  if (snap.empty) return

  const demandes = snap.docs.map(d => d.data() as any)
  const html = `
    <h2>⚠️ Rappel hebdomadaire GMAO — ${demandes.length} demande(s) en cours</h2>
    ${demandes.map((d: any) => `
      <div style="border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:12px">
        <strong>${d.departement}</strong>${d.numeroIntervention ? ` — #${d.numeroIntervention}` : ''}<br>
        ${d.motif}<br>
        <small style="color:#666">Depuis le ${d.date}</small>
        ${d.photoUrl ? `<br><a href="${d.photoUrl}">📎 Document</a>` : ''}
      </div>
    `).join('')}
  `

  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass },
  })

  await transporter.sendMail({
    from: `"Matias App" <${gmailUser}>`,
    to: ['a.cozzika@gmail.com', 'sebastien.coenca@gmail.com'],
    subject: `[GMAO] ${demandes.length} demande(s) en cours`,
    html,
  })
})

// ─────────────────────────────────────────────────────────────────
// RUPTURES + COMMANDES — Email Timour 21h30 chaque soir
// ─────────────────────────────────────────────────────────────────

interface RuptureDataItem { name: string; type: 'urgent' | 'moins-urgent'; priority: number | null }
interface NightlyRupturesData {
  items: RuptureDataItem[]
  commandes: any[]
  priorityLevels: Array<{ level: number; name: string; color: string }>
  hasContent: boolean
}

async function buildRupturesData(): Promise<NightlyRupturesData> {
  const now = new Date()
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)

  const [ruptSnap, catSnap, cmdSnap, plSnap] = await Promise.all([
    db.collection('ruptures_actives').where('createdAt', '>=', Timestamp.fromDate(midnight)).get(),
    db.collection('catalogue').get(),
    db.collection('commandes_externes').where('statut', 'in', ['en cours', 'devis envoyé', 'accepté']).get(),
    db.doc('settings/priority_levels').get(),
  ])

  const urgentMap = new Map<string, string>()
  const moinsMap  = new Map<string, string>()
  for (const d of ruptSnap.docs) {
    const data = d.data()
    for (const name of (data.ruptures ?? [])) {
      const k = String(name).toLowerCase().trim()
      if (!urgentMap.has(k)) urgentMap.set(k, name)
    }
    for (const name of (data.presqueRuptures ?? [])) {
      const k = String(name).toLowerCase().trim()
      if (!urgentMap.has(k) && !moinsMap.has(k)) moinsMap.set(k, name)
    }
  }

  const prio = new Map<string, number | null>()
  for (const d of catSnap.docs) {
    const data = d.data()
    if (data.name) prio.set(String(data.name).toLowerCase().trim(), data.priority ?? null)
  }

  const items: RuptureDataItem[] = [
    ...[...urgentMap.values()].map(name => ({ name, type: 'urgent' as const, priority: prio.get(name.toLowerCase().trim()) ?? null })),
    ...[...moinsMap.values()].map(name => ({ name, type: 'moins-urgent' as const, priority: prio.get(name.toLowerCase().trim()) ?? null })),
  ]
  items.sort((a, b) => {
    if (a.priority === b.priority) return a.name.localeCompare(b.name, 'fr')
    if (a.priority === null) return 1
    if (b.priority === null) return -1
    return a.priority - b.priority
  })

  const commandes = cmdSnap.docs.map(d => d.data())
  const rawLevels = (plSnap.data() as any)?.levels
  const priorityLevels: Array<{ level: number; name: string; color: string }> = Array.isArray(rawLevels) ? rawLevels : [
    { level: 1, name: 'Best Seller',      color: '#c0392b' },
    { level: 2, name: 'Grande priorité',  color: '#e67e22' },
    { level: 3, name: 'Priorité moyenne', color: '#b45309' },
    { level: 4, name: 'Faible priorité',  color: '#2d7a4f' },
  ]

  return { items, commandes, priorityLevels, hasContent: items.length > 0 || commandes.length > 0 }
}

async function buildRupturesCommandesEmail(): Promise<{ subject: string; html: string; hasContent: boolean }> {
  const now = new Date()
  const { items, commandes, priorityLevels, hasContent } = await buildRupturesData()

  const dateStr = now.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' })

  // Grouper les items par priorité
  const grouped = new Map<number | null, RuptureDataItem[]>()
  for (const item of items) {
    const k = item.priority
    if (!grouped.has(k)) grouped.set(k, [])
    grouped.get(k)!.push(item)
  }
  const sortedKeys = [...grouped.keys()].sort((a, b) => {
    if (a === null) return 1
    if (b === null) return -1
    return a - b
  })

  const ruptHtml = items.length === 0
    ? '<p style="color:#666;margin:0">Aucune rupture aujourd\'hui ✓</p>'
    : sortedKeys.map(key => {
        const lvl = key != null ? priorityLevels.find(l => l.level === key) : null
        const color = lvl?.color ?? (key != null ? '#b45309' : '#ca8a04')
        const groupName = lvl?.name ?? (key != null ? `Priorité ${key}` : 'Sans priorité')
        const groupItems = grouped.get(key)!
        return `
          <div style="margin-bottom:14px">
            <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:${color}">${groupName}</p>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${groupItems.map(item => {
                const badgeColor = item.type === 'urgent' ? '#c0392b' : '#e67500'
                const bgColor    = item.type === 'urgent' ? 'rgba(192,57,43,0.10)' : 'rgba(230,117,0,0.10)'
                const border     = item.type === 'urgent' ? 'rgba(192,57,43,0.30)' : 'rgba(230,117,0,0.30)'
                const emoji      = item.type === 'urgent' ? '🔴' : '🟠'
                return `<span style="display:inline-block;padding:3px 9px;border-radius:6px;font-size:13px;font-weight:600;color:${badgeColor};background:${bgColor};border:1px solid ${border}">${emoji} ${item.name}</span>`
              }).join('')}
            </div>
          </div>`
      }).join('')

  const cmdHtml = commandes.length === 0
    ? '<p style="color:#666;margin:0">Aucune commande active</p>'
    : `<ul style="margin:0;padding-left:20px">
        ${commandes.map((c: any) => `<li style="margin-bottom:6px">
          <strong>${c.prenom ?? ''} ${c.nom ?? ''}</strong>
          ${c.dateLivraison ? ` — livraison le <strong>${c.dateLivraison}</strong>` : ''}
          ${c.statut ? ` — <em>${c.statut}</em>` : ''}
        </li>`).join('')}
      </ul>`

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#004275;border-bottom:2px solid #004275;padding-bottom:8px;margin-top:0">
        Récap soir — ${dateStr}
      </h2>

      <h3 style="color:#c0392b;margin-top:24px;margin-bottom:12px">🧾 Ruptures (${items.length})</h3>
      ${ruptHtml}

      <h3 style="color:#004275;margin-top:24px;margin-bottom:12px">📦 Commandes actives (${commandes.length})</h3>
      ${cmdHtml}

      <p style="color:#999;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:12px">
        Envoyé automatiquement par Matias — ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
  `

  return { subject: `[Yorgios] Récap ruptures + commandes — ${dateStr}`, html, hasContent }
}

/** 21h30 — Email récap ruptures + commandes à Timour */
export const notifNightlyRuptures = onSchedule({
  schedule: '30 21 * * *',
  timeZone: 'Europe/Paris',
  region: 'europe-west1',
}, async () => {
  // Vérification paramètre on/off + vacances
  const cfgSnap = await db.doc('settings/nightly_ruptures').get()
  const cfg = cfgSnap.data() ?? {}
  if (cfg.enabled === false) {
    console.log('[21h30] notifNightlyRuptures désactivé dans les paramètres.')
    return
  }
  if (cfg.pauseFrom && cfg.pauseTo) {
    const today = new Date().toLocaleDateString('fr-CA') // YYYY-MM-DD
    if (today >= cfg.pauseFrom && today <= cfg.pauseTo) {
      console.log(`[21h30] notifNightlyRuptures en pause vacances (${cfg.pauseFrom} → ${cfg.pauseTo}).`)
      return
    }
  }

  const { subject, html } = await buildRupturesCommandesEmail()
  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } })
  const ccEmails = ((cfg.ccEmails as string[]) ?? []).filter(Boolean)
  const ccList = ccEmails.length > 0 ? ccEmails.join(', ') : undefined
  await transporter.sendMail({ from: `"Matias" <${gmailUser}>`, to: 'ytimour86@gmail.com', cc: ccList, subject, html })
  console.log('[21h30] Email récap ruptures+commandes envoyé à Timour.')
})

/** Callable — test immédiat (patron/admin uniquement) */
export const sendNightlyRupturesNow = onCall({ region: 'europe-west1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Auth required')
  const userDoc = await db.collection('users').doc(request.auth.uid).get()
  const role = userDoc.data()?.role
  if (!['patron', 'administrateur'].includes(role)) throw new HttpsError('permission-denied', 'Patron/admin uniquement')

  const cfgSnap = await db.doc('settings/nightly_ruptures').get()
  const cfg = cfgSnap.data() ?? {}
  const { subject, html } = await buildRupturesCommandesEmail()
  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } })
  const ccEmails = ((cfg.ccEmails as string[]) ?? []).filter(Boolean)
  const ccList = ccEmails.length > 0 ? ccEmails.join(', ') : undefined
  await transporter.sendMail({ from: `"Matias" <${gmailUser}>`, to: 'ytimour86@gmail.com', cc: ccList, subject, html })
  return { success: true }
})

/** Callable — aperçu sans envoi (patron/admin uniquement) */
export const previewNightlyRuptures = onCall({ region: 'europe-west1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Auth required')
  const userDoc = await db.collection('users').doc(request.auth.uid).get()
  const role = userDoc.data()?.role
  if (!['patron', 'administrateur'].includes(role)) throw new HttpsError('permission-denied', 'Patron/admin uniquement')

  const { items, commandes, hasContent } = await buildRupturesData()
  const { html } = await buildRupturesCommandesEmail()
  return { items, commandes, hasContent, emailHtml: html }
})

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
const GPS_ACCURACY_LIMIT_SERVER = 200 // mètres (WiFi iPad ~50-200m)

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

    const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' })

    // ── CAS ARRIVÉE ─────────────────────────────────────────────
    if (typePointage === 'arrivée') {
      // Vérifier si un pointage arrivée existe déjà
      const existingArrivee = await db.collection('pointages')
        .where('userId', '==', uid)
        .where('date', '==', today)
        .where('typePointage', '==', 'arrivée')
        .where('statut', '==', 'validé')
        .limit(1)
        .get()

      if (!existingArrivee.empty) {
        // Auto-checkout existe ? → mode heures sup : on le supprime et on laisse passer
        const autoDepart = await db.collection('pointages')
          .where('userId', '==', uid)
          .where('date', '==', today)
          .where('typePointage', '==', 'départ')
          .where('autoCheckout', '==', true)
          .limit(1)
          .get()

        if (!autoDepart.empty) {
          await autoDepart.docs[0].ref.delete()
          console.log(`[createPointage] Auto-checkout supprimé pour ${userName} → mode heures sup`)
          // Continue : on crée la nouvelle arrivée (overtime)
        } else {
          const existing = existingArrivee.docs[0].data()
          throw new HttpsError('already-exists',
            `Pointage arrivée déjà enregistré aujourd'hui à ${existing.timestamp?.toDate?.().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) ?? '—'}`)
        }
      }
    }

    // ── CAS DÉPART ──────────────────────────────────────────────
    if (typePointage === 'départ') {
      // Vérifier doublon départ
      const existingDepart = await db.collection('pointages')
        .where('userId', '==', uid)
        .where('date', '==', today)
        .where('typePointage', '==', 'départ')
        .where('statut', '==', 'validé')
        .limit(1)
        .get()
      if (!existingDepart.empty) {
        const existing = existingDepart.docs[0].data()
        throw new HttpsError('already-exists',
          `Pointage départ déjà enregistré aujourd'hui à ${existing.timestamp?.toDate?.().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) ?? '—'}`)
      }

      // Bloquer le départ si arrivée < 1h
      const arriveeSnap = await db.collection('pointages')
        .where('userId', '==', uid)
        .where('date', '==', today)
        .where('typePointage', '==', 'arrivée')
        .where('statut', '==', 'validé')
        .limit(1)
        .get()
      if (!arriveeSnap.empty) {
        const arriveeData = arriveeSnap.docs[0].data()
        const arriveeMs = (arriveeData.timestamp as FirebaseFirestore.Timestamp).toMillis()
        const elapsedMin = (Date.now() - arriveeMs) / 60000
        if (elapsedMin < 60) {
          const remainMin = Math.ceil(60 - elapsedMin)
          const unlockTime = new Date(arriveeMs + 60 * 60000)
          const unlockStr = unlockTime.toLocaleTimeString('fr-FR', {
            timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false,
          })
          throw new HttpsError('failed-precondition',
            `BLOCKED_1H:${unlockStr}:Départ bloqué encore ${remainMin} min (disponible à ${unlockStr})`)
        }
      }
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
  { region: 'europe-west1', cors: false, secrets: ['TWILIO_AUTH_TOKEN'] },
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

/** 13h00 — Efface les demandes de ruptures non vues (nouveau cycle après-midi) */
export const clearRupturesAt13h = onSchedule(
  { schedule: '0 13 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' },
  async () => {
    const snap = await db.collection('ruptures_actives').where('viewed', '==', false).get()
    if (snap.empty) {
      console.log('[13h] Aucune rupture active non vue.')
      return
    }
    const batch = db.batch()
    snap.docs.forEach(d => batch.update(d.ref, { viewed: true }))
    await batch.commit()
    console.log(`[13h] ${snap.size} rupture(s) active(s) marquée(s) vues.`)
  }
)

// ─────────────────────────────────────────────────────────────────
// DEMANDE DE CONGÉS — email automatique à la création du doc
// ─────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
// CONGÉS — helper : écrire/supprimer les events conge dans le planning
// ─────────────────────────────────────────────────────────────────
async function applyCongeToPlanning(employeeId: string, dateDebut: string, dateFin: string, remove: boolean) {
  function toISO(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  function mondayOf(date: Date): Date {
    const d = new Date(date)
    const day = d.getDay()
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
    return d
  }

  // Collecter toutes les dates de la plage
  const dates: string[] = []
  const cur = new Date(dateDebut + 'T12:00:00Z')
  const end = new Date(dateFin + 'T12:00:00Z')
  while (cur <= end) { dates.push(toISO(cur)); cur.setUTCDate(cur.getUTCDate() + 1) }

  // Grouper par semaine (weekId = lundi ISO)
  const weekMap = new Map<string, { wid: string; dates: string[] }>()
  for (const iso of dates) {
    const mon = mondayOf(new Date(iso + 'T12:00:00Z'))
    const wid = toISO(mon)
    if (!weekMap.has(wid)) weekMap.set(wid, { wid, dates: [] })
    weekMap.get(wid)!.dates.push(iso)
  }

  // Appliquer semaine par semaine
  for (const { wid, dates: dayDates } of weekMap.values()) {
    const refs = dayDates.map(iso =>
      db.collection('planningWeeks').doc(wid).collection('events').doc(iso)
    )
    const snaps = await Promise.all(refs.map(r => r.get()))
    const batch = db.batch()
    snaps.forEach((snap, i) => {
      const dateISO = dayDates[i]
      let events: any[] = snap.exists ? (snap.data()?.events ?? []) : []
      events = events.filter((e: any) => !(e.empId === employeeId && e.type === 'conge'))
      if (!remove) events.push({ empId: employeeId, type: 'conge' })
      batch.set(refs[i], { date: dateISO, events, updatedAt: Timestamp.now(), updatedBy: 'system' })
    })
    await batch.commit()
    console.log(`[conges-planning] Semaine ${wid} — ${remove ? 'supprimé' : 'ajouté'} congé pour emp ${employeeId} (${dayDates.length} jours)`)
  }
}

// ─────────────────────────────────────────────────────────────────
// CONGÉS — réponse manager : synchro planning + email employé
// ─────────────────────────────────────────────────────────────────
export const onCongesStatutChange = onDocumentUpdated(
  { document: 'conges_demandes/{id}', region: 'europe-west1', database: 'test' },
  async (event) => {
    const before = event.data?.before.data()
    const after  = event.data?.after.data()
    if (!before || !after) return
    if (before.statut === after.statut) return

    const { uid, nom, email, dateDebut, dateFin, statut: newStatut, commentaire, traitePar } = after
    const oldStatut = before.statut

    // ── Synchro planning ──────────────────────────────────────
    if (uid && dateDebut && dateFin) {
      const userSnap = await db.collection('users').doc(uid).get()
      const employeeId = userSnap.data()?.employeeId as string | undefined
      if (employeeId) {
        if (newStatut === 'Acceptée') {
          await applyCongeToPlanning(employeeId, dateDebut, dateFin, false)
        } else if (oldStatut === 'Acceptée') {
          await applyCongeToPlanning(employeeId, dateDebut, dateFin, true)
        }
      } else {
        console.warn(`[conges] Pas d'employeeId pour uid=${uid} — planning non mis à jour`)
      }
    }

    // ── Email à l'employé ─────────────────────────────────────
    if (newStatut !== 'Acceptée' && newStatut !== 'Refusée') return
    if (!email) return

    const gmailUser = process.env.GMAIL_USER
    const gmailPass = process.env.GMAIL_APP_PASSWORD
    if (!gmailUser || !gmailPass) return

    const accepted = newStatut === 'Acceptée'
    const emoji    = accepted ? '✅' : '❌'
    const color    = accepted ? '#2d7a4f' : '#c0392b'
    const traiteParLabel = traitePar || 'La direction'

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
        <div style="background:${color};padding:20px 24px;border-radius:10px 10px 0 0">
          <h2 style="color:#fff;margin:0;font-size:20px">${emoji} Demande de congés ${accepted ? 'acceptée' : 'refusée'}</h2>
        </div>
        <div style="background:#f9f6ef;padding:24px;border-radius:0 0 10px 10px;border:1px solid #e5e2dc">
          <p style="margin:0 0 14px;font-size:14px;color:#1c1c18">Bonjour ${nom},</p>
          <p style="margin:0 0 14px;font-size:14px;color:#1c1c18">
            Votre demande de congés du <strong>${dateDebut}</strong> au <strong>${dateFin}</strong>
            a été <strong>${accepted ? 'acceptée ✓' : 'refusée ✗'}</strong> par ${traiteParLabel}.
          </p>
          ${commentaire ? `<div style="background:#ede9e1;border-radius:8px;padding:12px 16px;margin:0 0 14px;font-size:13px;color:#1c1c18"><strong>Commentaire :</strong><br>${commentaire}</div>` : ''}
          ${!accepted ? `<p style="margin:0;font-size:13px;color:#5a5a55">N'hésitez pas à contacter votre manager pour plus d'informations.</p>` : ''}
          <p style="margin:18px 0 0;font-size:11px;color:#9a9a94">Matias PWA</p>
        </div>
      </div>`

    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } })
    await transporter.sendMail({
      from: `"Matias App" <${gmailUser}>`,
      to: email,
      subject: `${emoji} Congés ${accepted ? 'acceptés' : 'refusés'} — ${dateDebut} → ${dateFin}`,
      html,
    })
    console.log(`[conges] Réponse "${newStatut}" envoyée à ${email} pour ${nom}`)
  }
)

// ─────────────────────────────────────────────────────────────────
// DEMANDE DE CONGÉS — email automatique à la création du doc
// ─────────────────────────────────────────────────────────────────
export const onCongesDemande = onDocumentCreated(
  { document: 'conges_demandes/{id}', region: 'europe-west1', database: 'test' },
  async (event) => {
    const data = event.data?.data()
    if (!data) return

    const gmailUser = process.env.GMAIL_USER
    const gmailPass = process.env.GMAIL_APP_PASSWORD
    if (!gmailUser || !gmailPass) {
      console.error('[conges] GMAIL_USER / GMAIL_APP_PASSWORD manquants')
      return
    }

    // Destinataires depuis settings/emails, fallback Alexandre + Arthur
    const emailsSnap = await db.doc('settings/emails').get()
    const raw = emailsSnap.data()?.congesDestinataires
    let dest: string[] = []
    if (Array.isArray(raw) && raw.length > 0) dest = raw
    else if (typeof raw === 'string') dest = raw.split(',').map((s: string) => s.trim()).filter(Boolean)
    if (dest.length === 0) dest = ['a.cozzika@gmail.com', 'kyriazis@outlook.fr']

    const nom       = (data.nom as string)       || (data.email as string) || 'Employé inconnu'
    const email     = (data.email as string)      || ''
    const dateDebut = (data.dateDebut as string)  || '?'
    const dateFin   = (data.dateFin as string)    || '?'
    const motif     = (data.motif as string)      || '—'
    const now       = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
        <div style="background:#004275;padding:20px 24px;border-radius:10px 10px 0 0">
          <h2 style="color:#fff;margin:0;font-size:20px">🏖 Demande de congés — ${nom}</h2>
        </div>
        <div style="background:#f9f6ef;padding:24px;border-radius:0 0 10px 10px;border:1px solid #e5e2dc">
          <table style="width:100%;border-collapse:collapse">
            <tr>
              <td style="padding:8px 0;color:#5a5a55;font-size:13px;width:140px">Demandeur</td>
              <td style="padding:8px 0;font-weight:700;color:#1c1c18;font-size:13px">${nom}${email ? ` &lt;${email}&gt;` : ''}</td>
            </tr>
            <tr style="background:#ede9e1">
              <td style="padding:8px 12px;color:#5a5a55;font-size:13px;border-radius:4px">Du</td>
              <td style="padding:8px 12px;font-weight:700;color:#1c1c18;font-size:13px">${dateDebut}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#5a5a55;font-size:13px">Au</td>
              <td style="padding:8px 0;font-weight:700;color:#1c1c18;font-size:13px">${dateFin}</td>
            </tr>
            <tr style="background:#ede9e1">
              <td style="padding:8px 12px;color:#5a5a55;font-size:13px;border-radius:4px;vertical-align:top">Motif</td>
              <td style="padding:8px 12px;color:#1c1c18;font-size:13px">${motif}</td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:11px;color:#9a9a94">Reçu le ${now} — Matias PWA</p>
        </div>
      </div>`

    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } })
    await transporter.sendMail({
      from: `"Matias App" <${gmailUser}>`,
      to: dest[0],
      cc: dest.slice(1).join(',') || undefined,
      subject: `🏖 Demande de congés — ${nom} (${dateDebut} → ${dateFin})`,
      html,
    })
    console.log(`[conges] Email envoyé à ${dest.join(', ')} pour ${nom}`)
  }
)
