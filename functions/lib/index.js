"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearRupturesAt13h = exports.incomingSms = exports.createPointage = exports.validatePromoCodePublic = exports.validatePromoCode = exports.syncContactToBrevo = exports.sendNightlyRupturesNow = exports.notifNightlyRuptures = exports.gmaoWeeklyReminder = exports.sendGmaoEmail = exports.weeklyHygieneRecap = exports.notifHygieneMensuel = exports.notifHygieneHebdo = exports.notifTemperaturesEvening = exports.notifUrgences = exports.onLivraisonReception = exports.onLivraisonTemperature = exports.onPointageLate = exports.notifPlatsJour = exports.notifCartonsChambrefroide = exports.notifTooGoodToGo = exports.notifTemperatures = exports.updateUserPassword = exports.deleteUser = exports.createUser = exports.sendPasswordReset = exports.purgeOldMessages = exports.relanceCommandes = exports.updateCommandeStatus = exports.onCommandePrete = exports.notifCommandesJ7 = exports.notifCommandesJJ = exports.notifCommandesJ2 = exports.onCommandeUpdated = exports.onNewCommande = exports.onNewMessage = void 0;
// Node.js 22
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const messaging_1 = require("firebase-admin/messaging");
const auth_1 = require("firebase-admin/auth");
const firestore_2 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_1 = require("firebase-functions/v2/https");
const googleapis_1 = require("googleapis");
const nodemailer = __importStar(require("nodemailer"));
const webhooks_1 = require("twilio/lib/webhooks/webhooks");
const crypto = __importStar(require("crypto"));
const app = (0, app_1.initializeApp)();
// Firestore DB non-default : 'test'
const db = (0, firestore_1.getFirestore)(app, 'test');
// ─────────────────────────────────────────────────────────────────
// UTILITAIRES FCM
// ─────────────────────────────────────────────────────────────────
/** Envoie une notification FCM à tous les rôles spécifiés */
async function notifyRoles(title, body, link, roles = ['patron', 'manager', 'cuisine', 'corner']) {
    const usersSnap = await db.collection('users').get();
    const tokens = [];
    for (const u of usersSnap.docs) {
        const d = u.data();
        if (d.fcmToken && roles.includes(d.role))
            tokens.push(d.fcmToken);
    }
    if (!tokens.length)
        return;
    await (0, messaging_1.getMessaging)().sendEachForMulticast({
        tokens,
        notification: { title, body },
        webpush: {
            notification: { icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'yorgios-cmd', renotify: true },
            fcmOptions: { link },
        },
    });
}
// ─────────────────────────────────────────────────────────────────
// UTILITAIRES — TOKEN ACTION EMAIL
// ─────────────────────────────────────────────────────────────────
/** Génère un token HMAC-SHA256 pour les boutons d'action dans les emails */
function makeActionToken(cmdId, statut) {
    const secret = process.env.YORGIOS_WP_SECRET || 'matias-fallback-secret';
    return crypto.createHmac('sha256', secret).update(`${cmdId}:${statut}`).digest('hex').slice(0, 32);
}
function verifyActionToken(cmdId, statut, token) {
    return makeActionToken(cmdId, statut) === token;
}
const CF_BASE = 'https://europe-west1-cuisine-yorgios.cloudfunctions.net';
function actionLink(cmdId, statut) {
    const token = makeActionToken(cmdId, statut);
    return `${CF_BASE}/updateCommandeStatus?cmdId=${encodeURIComponent(cmdId)}&statut=${encodeURIComponent(statut)}&token=${token}`;
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
async function createGCalEvent(cmd) {
    const calendarId = process.env.GCAL_CALENDAR_ID || 'primary';
    try {
        // Credentials via Application Default Credentials (service account Firebase)
        const auth = new googleapis_1.google.auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/calendar'],
        });
        const calendar = googleapis_1.google.calendar({ version: 'v3', auth });
        const startDateTime = `${cmd.dateLivraison}T${cmd.heureLivraison}:00`;
        const endDate = new Date(`${cmd.dateLivraison}T${cmd.heureLivraison}:00`);
        endDate.setHours(endDate.getHours() + 1);
        const endDateTime = endDate.toISOString().slice(0, 19);
        const produitsList = Array.isArray(cmd.produits)
            ? cmd.produits.map((p) => `• ${p.produit} — ${p.quantite} ${p.unite}`).join('\n')
            : '';
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
        ].filter(Boolean).join('\n');
        const event = await calendar.events.insert({
            calendarId,
            requestBody: {
                summary: `🍽️ Commande ${cmd.id} — ${cmd.prenom} ${cmd.nom}`,
                description,
                location: cmd.adresseLivraison,
                start: { dateTime: startDateTime, timeZone: 'Europe/Paris' },
                end: { dateTime: endDateTime, timeZone: 'Europe/Paris' },
                colorId: '2', // Vert = Acceptée
                reminders: {
                    useDefault: false,
                    overrides: [
                        { method: 'popup', minutes: 2880 }, // J-2
                        { method: 'popup', minutes: 60 },
                        { method: 'email', minutes: 2880 },
                    ],
                },
            },
        });
        return event.data.htmlLink || '';
    }
    catch (e) {
        console.error('[GCal] Erreur création événement:', e);
        return '';
    }
}
// ─────────────────────────────────────────────────────────────────
// MESSAGERIE — Notification sur nouveau message
// ─────────────────────────────────────────────────────────────────
exports.onNewMessage = (0, firestore_2.onDocumentCreated)({ document: 'messages/{messageId}', region: 'europe-west1', database: 'test' }, async (event) => {
    var _a, _b;
    const msg = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    if (!msg)
        return;
    const usersSnap = await db.collection('users').get();
    const tokens = [];
    for (const u of usersSnap.docs) {
        const d = u.data();
        if (d.fcmToken && u.id !== msg.senderId)
            tokens.push(d.fcmToken);
    }
    if (!tokens.length)
        return;
    const body = msg.photoUrl
        ? `${msg.senderName} a envoyé une photo`
        : ((_b = msg.text) === null || _b === void 0 ? void 0 : _b.slice(0, 100)) || 'Nouveau message';
    await (0, messaging_1.getMessaging)().sendEachForMulticast({
        tokens,
        notification: { title: `${msg.senderName} (${msg.senderRole})`, body },
        webpush: {
            notification: { icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'yorgios-msg', renotify: true },
            fcmOptions: { link: '/messages' },
        },
    });
});
// ─────────────────────────────────────────────────────────────────
// COMMANDES — Nouvelle commande → notif immédiate (patron + manager + cuisine) + email
// ─────────────────────────────────────────────────────────────────
exports.onNewCommande = (0, firestore_2.onDocumentCreated)({ document: 'commandes_externes/{cmdId}', region: 'europe-west1', database: 'test' }, async (event) => {
    var _a;
    const cmd = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    if (!cmd)
        return;
    // ── Anti-spam : max 3 commandes par numéro de téléphone sur 24h ──
    // (query simple sur telephone uniquement, filtrage date en mémoire pour éviter index composite)
    try {
        const telephone = cmd.telephone || cmd.tel || '';
        if (telephone) {
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const existing = await db.collection('commandes_externes')
                .where('telephone', '==', telephone)
                .get();
            const recentCount = existing.docs.filter(d => {
                const ds = d.data().dateSaisie;
                const t = (ds === null || ds === void 0 ? void 0 : ds.toDate) ? ds.toDate() : null;
                return t && t >= since;
            }).length;
            if (recentCount > 3) {
                console.warn(`[anti-spam] Trop de commandes pour ${telephone} — suppression`);
                await event.data.ref.delete();
                return;
            }
        }
    }
    catch (e) {
        console.error('[anti-spam] Erreur vérification (ignorée):', e);
    }
    // ── Produits ──
    const produitsList = Array.isArray(cmd.produits) && cmd.produits.length
        ? cmd.produits.map((p) => `  - ${p.produit}${p.quantite ? ' × ' + p.quantite : ''}${p.unite ? ' ' + p.unite : ''}`).join('\n')
        : '  Non précisé';
    // ── Message messagerie interne ──
    const now = firestore_1.Timestamp.now();
    const expiresAt = firestore_1.Timestamp.fromMillis(now.toMillis() + 7 * 86400000);
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
    ].filter(Boolean).join('\n');
    try {
        await db.collection('messages').add({
            channelId: 'corner-cuisine',
            senderId: 'system',
            senderName: 'Commandes',
            senderRole: 'system',
            text: messageText,
            createdAt: now,
            expiresAt,
        });
    }
    catch (e) {
        console.error('[onNewCommande] Erreur écriture message:', e);
    }
    // ── Push FCM ──
    try {
        await notifyRoles(`📬 Nouvelle commande — ${cmd.prenom} ${cmd.nom}`, `${cmd.dateLivraison} à ${cmd.heureLivraison}`, '/corner/commandes', ['patron', 'manager', 'cuisine']);
    }
    catch (e) {
        console.error('[onNewCommande] Erreur FCM:', e);
    }
    // ── Email au patron ──
    try {
        const gmailUser = process.env.GMAIL_USER;
        const gmailPass = process.env.GMAIL_APP_PASSWORD;
        if (gmailUser && gmailPass) {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: { user: gmailUser, pass: gmailPass },
            });
            await transporter.sendMail({
                from: `"Matias" <${gmailUser}>`,
                to: 'a.cozzika@gmail.com',
                cc: 'yorgios.system@gmail.com, commande.yorgios@gmail.com',
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
            });
        }
    }
    catch (e) {
        console.error('[onNewCommande] Erreur email:', e);
    }
});
// ─────────────────────────────────────────────────────────────────
// COMMANDES — Statut mis à jour
//   • "Acceptée"  → créer événement Google Calendar + notif cuisine
//   • "Refusée"   → notif équipe
//   • "Livrée"    → notif patron/manager
// ─────────────────────────────────────────────────────────────────
exports.onCommandeUpdated = (0, firestore_2.onDocumentUpdated)({ document: 'commandes_externes/{cmdId}', region: 'europe-west1', database: 'test',
    secrets: ['BREVO_API_KEY', 'BREVO_LIST_ID'] }, async (event) => {
    var _a, _b, _c, _d;
    const before = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
    const after = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
    if (!before || !after)
        return;
    if (before.statut === after.statut)
        return;
    const docRef = event.data.after.ref;
    if (after.statut === 'Accepté' && before.statut !== 'Accepté') {
        // Créer l'événement Google Calendar
        const lienGcal = await createGCalEvent(after);
        if (lienGcal) {
            await docRef.update({ lienGcal });
        }
        // Notifier la cuisine
        await notifyRoles(`✅ Commande acceptée — ${after.id}`, `${after.prenom} ${after.nom} · ${after.dateLivraison} à ${after.heureLivraison}`, '/corner/commandes', ['cuisine', 'patron', 'manager']);
    }
    if (after.statut === 'Devis envoyé' && before.statut !== 'Devis envoyé') {
        await notifyRoles(`📄 Devis envoyé — ${after.id}`, `${after.prenom} ${after.nom} · en attente de confirmation client`, '/corner/commandes', ['patron', 'manager']);
    }
    if (after.statut === 'Refusé' && before.statut !== 'Refusé') {
        await notifyRoles(`❌ Commande refusée — ${after.id}`, `${after.prenom} ${after.nom} — refusée.`, '/corner/commandes', ['patron', 'manager']);
    }
    if (after.statut === 'Annulé' && before.statut !== 'Annulé') {
        await notifyRoles(`🚫 Commande annulée — ${after.id}`, `${after.prenom} ${after.nom} — annulée.`, '/corner/commandes', ['patron', 'manager']);
    }
});
// ─────────────────────────────────────────────────────────────────
// COMMANDES — Rappel J-2 (tous les jours à 14h Europe/Paris)
// ─────────────────────────────────────────────────────────────────
exports.notifCommandesJ2 = (0, scheduler_1.onSchedule)({ schedule: 'every day 14:00', timeZone: 'Europe/Paris', region: 'europe-west1' }, async () => {
    const j2 = new Date();
    j2.setDate(j2.getDate() + 2);
    const dateStr = j2.toISOString().slice(0, 10);
    const snap = await db.collection('commandes_externes')
        .where('dateLivraison', '==', dateStr)
        .where('statut', 'in', ['Accepté'])
        .get();
    if (snap.empty)
        return;
    for (const d of snap.docs) {
        const cmd = d.data();
        await notifyRoles(`⏰ Rappel J-2 — ${cmd.id}`, `Livraison dans 2 jours : ${cmd.prenom} ${cmd.nom} le ${cmd.dateLivraison} à ${cmd.heureLivraison}`, '/corner/commandes', ['patron', 'manager', 'cuisine']);
        await d.ref.update({ notifJ2Envoyee: firestore_1.Timestamp.now() });
    }
    // ── Email récap J-2 ──
    try {
        const gmailUser = process.env.GMAIL_USER;
        const gmailPass = process.env.GMAIL_APP_PASSWORD;
        if (gmailUser && gmailPass) {
            const formatDate = (iso) => {
                const [y, m, d] = iso.split('-');
                const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
                const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
                const dt = new Date(iso);
                return `${days[dt.getDay()]} ${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
            };
            let htmlBody = `
          <div style="font-family: sans-serif; max-width: 640px; margin: 0 auto; color: #1c1c18;">
            <h2 style="color: #004275; border-bottom: 2px solid #004275; padding-bottom: 8px;">
              ⏰ Rappel J-2 — Commandes du ${formatDate(dateStr)}
            </h2>
            <p style="color: #5a5a55; font-size: 14px;">
              ${snap.size} commande(s) à livrer dans <strong>2 jours</strong>.
            </p>
        `;
            for (const d of snap.docs) {
                const cmd = d.data();
                const produitsList = Array.isArray(cmd.produits) && cmd.produits.length
                    ? cmd.produits.map((p) => `${p.produit}${p.quantite ? ' × ' + p.quantite : ''}${p.unite ? ' ' + p.unite : ''}`).join(', ')
                    : '—';
                const statut = cmd.statut || '?';
                const couleurStatut = statut === 'Accepté' ? '#2d7a4f' : '#004275';
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
          `;
            }
            htmlBody += `
            <p style="font-size: 12px; color: #9a9a94; margin-top: 32px; border-top: 1px solid #ede9e1; padding-top: 12px;">
              Matias — rappel automatique J-2 envoyé à 14h.<br>
              Consulter toutes les commandes : <a href="https://cuisine-yorgios.web.app/corner/commandes" style="color: #004275;">App Matias</a>
            </p>
          </div>
        `;
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: { user: gmailUser, pass: gmailPass },
            });
            await transporter.sendMail({
                from: `"Matias" <${gmailUser}>`,
                to: 'a.cozzika@gmail.com',
                subject: `⏰ Rappel J-2 — ${snap.size} commande(s) le ${formatDate(dateStr)}`,
                html: htmlBody,
            });
            console.log(`[J-2] Email envoyé pour ${dateStr}`);
        }
    }
    catch (e) {
        console.error('[J-2] Erreur envoi email:', e);
    }
    console.log(`[J-2] ${snap.size} rappel(s) envoyé(s) pour ${dateStr}`);
});
// ─────────────────────────────────────────────────────────────────
// COMMANDES — Rappel Jour-J (tous les jours à 9h Europe/Paris)
// ─────────────────────────────────────────────────────────────────
exports.notifCommandesJJ = (0, scheduler_1.onSchedule)({ schedule: 'every day 09:00', timeZone: 'Europe/Paris', region: 'europe-west1' }, async () => {
    const today = new Date().toISOString().slice(0, 10);
    const snap = await db.collection('commandes_externes')
        .where('dateLivraison', '==', today)
        .where('statut', 'in', ['Acceptée', 'En production'])
        .get();
    if (snap.empty)
        return;
    for (const d of snap.docs) {
        const cmd = d.data();
        await notifyRoles(`🚀 Livraison aujourd'hui — ${cmd.id}`, `${cmd.prenom} ${cmd.nom} — à livrer à ${cmd.heureLivraison}. Bon courage !`, '/corner/commandes', ['patron', 'manager', 'cuisine']);
        await d.ref.update({ notifJJEnvoyee: firestore_1.Timestamp.now() });
    }
    console.log(`[J-J] ${snap.size} rappel(s) envoyé(s) pour ${today}`);
});
// ─────────────────────────────────────────────────────────────────
// COMMANDES — Récap email J+7 (chaque matin à 8h Europe/Paris)
// ─────────────────────────────────────────────────────────────────
exports.notifCommandesJ7 = (0, scheduler_1.onSchedule)({ schedule: 'every day 08:00', timeZone: 'Europe/Paris', region: 'europe-west1' }, async () => {
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailUser || !gmailPass) {
        console.error('[J7] GMAIL_USER / GMAIL_APP_PASSWORD manquants dans functions/.env');
        return;
    }
    // Fenêtre : aujourd'hui → aujourd'hui + 7 jours
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const limit7 = new Date(today);
    limit7.setDate(limit7.getDate() + 7);
    const dateFrom = today.toISOString().slice(0, 10);
    const dateTo = limit7.toISOString().slice(0, 10);
    const snap = await db.collection('commandes_externes')
        .where('dateLivraison', '>=', dateFrom)
        .where('dateLivraison', '<=', dateTo)
        .where('statut', 'in', ['En cours', 'Devis envoyé', 'Accepté'])
        .orderBy('dateLivraison', 'asc')
        .get();
    if (snap.empty) {
        console.log('[J7] Aucune commande dans les 7 prochains jours — email non envoyé');
        return;
    }
    // Grouper par date de livraison
    const byDate = {};
    for (const d of snap.docs) {
        const cmd = { ...d.data(), _id: d.id };
        const dl = cmd.dateLivraison;
        if (!byDate[dl])
            byDate[dl] = [];
        byDate[dl].push(cmd);
    }
    // Construire le corps HTML
    const formatDate = (iso) => {
        const [y, m, d] = iso.split('-');
        const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
        const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
        const dt = new Date(iso);
        return `${days[dt.getDay()]} ${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
    };
    let htmlBody = `
      <div style="font-family: sans-serif; max-width: 640px; margin: 0 auto; color: #1c1c18;">
        <h2 style="color: #004275; border-bottom: 2px solid #004275; padding-bottom: 8px;">
          📋 Commandes — 7 prochains jours
        </h2>
        <p style="color: #5a5a55; font-size: 14px;">
          ${snap.size} commande(s) entre le <strong>${formatDate(dateFrom)}</strong> et le <strong>${formatDate(dateTo)}</strong>.
        </p>
    `;
    for (const [date, cmds] of Object.entries(byDate)) {
        htmlBody += `
        <h3 style="color: #004275; margin-top: 24px; margin-bottom: 8px;">
          📅 ${formatDate(date)} — ${cmds.length} commande(s)
        </h3>
      `;
        for (const cmd of cmds) {
            const statut = cmd.statut || '?';
            const couleurStatut = statut === 'Accepté' ? '#2d7a4f' : statut === 'Devis envoyé' ? '#004275' : '#b45309';
            const produitsList = Array.isArray(cmd.produits) && cmd.produits.length
                ? cmd.produits.map((p) => `${p.produit}${p.quantite ? ' × ' + p.quantite : ''}${p.unite ? ' ' + p.unite : ''}`).join(', ')
                : '—';
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
        `;
        }
    }
    htmlBody += `
        <p style="font-size: 12px; color: #9a9a94; margin-top: 32px; border-top: 1px solid #ede9e1; padding-top: 12px;">
          Matias — récap automatique envoyé chaque matin à 8h.<br>
          Consulter toutes les commandes : <a href="https://cuisine-yorgios.web.app/corner/commandes" style="color: #004275;">App Matias</a>
        </p>
      </div>
    `;
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
    });
    await transporter.sendMail({
        from: `"Matias" <${gmailUser}>`,
        to: 'a.cozzika@gmail.com',
        subject: `📋 Commandes J+7 — ${snap.size} commande(s) à venir`,
        html: htmlBody,
    });
    console.log(`[J7] Email envoyé — ${snap.size} commande(s) du ${dateFrom} au ${dateTo}`);
});
// ─────────────────────────────────────────────────────────────────
// COMMANDES — Commande prête → notif FCM + message messagerie
// ─────────────────────────────────────────────────────────────────
exports.onCommandePrete = (0, https_1.onCall)({ region: 'europe-west1' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Non authentifié');
    const { commandeId } = request.data;
    if (!commandeId)
        throw new https_1.HttpsError('invalid-argument', 'commandeId manquant');
    const cmdSnap = await db.collection('commandes_externes').doc(commandeId).get();
    if (!cmdSnap.exists)
        throw new https_1.HttpsError('not-found', 'Commande introuvable');
    const cmd = cmdSnap.data();
    // Notif FCM à patron + manager + cuisine
    await notifyRoles(`📦 Commande prête — ${cmd.id}`, `${cmd.prenom} ${cmd.nom} · ${cmd.dateLivraison} à ${cmd.heureLivraison}`, '/corner/commandes', ['patron', 'manager', 'cuisine']);
    // Message dans la messagerie
    const callerSnap = await db.collection('users').doc(request.auth.uid).get();
    const callerData = callerSnap.data() || {};
    const senderName = callerData.displayName || 'Corner';
    const senderRole = callerData.role || 'corner';
    const now = firestore_1.Timestamp.now();
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await db.collection('messages').add({
        senderId: request.auth.uid,
        senderName,
        senderRole,
        text: `📦 Commande PRÊTE : ${cmd.id} — ${cmd.prenom} ${cmd.nom} — livraison le ${cmd.dateLivraison} à ${cmd.heureLivraison}`,
        photoUrl: null,
        createdAt: now,
        expiresAt,
    });
    return { ok: true };
});
// ─────────────────────────────────────────────────────────────────
// COMMANDES — Action email : met à jour le statut via lien cliquable
// ─────────────────────────────────────────────────────────────────
exports.updateCommandeStatus = (0, https_1.onRequest)({ region: 'europe-west1' }, async (req, res) => {
    const { cmdId, statut, token } = req.query;
    function htmlPage(title, body, color = '#004275') {
        return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:sans-serif;background:#fcf9f3;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#fff;border-radius:16px;padding:32px 28px;max-width:400px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(28,28,24,0.10)}
h1{color:${color};font-size:22px;margin:0 0 12px}p{color:#5a5a55;font-size:15px;line-height:1.6;margin:0 0 20px}
a{display:inline-block;background:${color};color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px}</style>
</head><body><div class="card">${body}</div></body></html>`;
    }
    const STATUTS_VALIDES = ['Devis envoyé', 'Accepté', 'Refusé', 'Annulé'];
    if (!cmdId || !statut || !token) {
        res.status(400).send(htmlPage('Erreur', '<h1>⚠️ Paramètres manquants</h1><p>Le lien est incomplet.</p>', '#c0392b'));
        return;
    }
    if (!STATUTS_VALIDES.includes(statut)) {
        res.status(400).send(htmlPage('Erreur', '<h1>⚠️ Statut invalide</h1>', '#c0392b'));
        return;
    }
    if (!verifyActionToken(cmdId, statut, token)) {
        res.status(403).send(htmlPage('Accès refusé', '<h1>🔒 Token invalide</h1><p>Ce lien n\'est pas valide ou a expiré.</p>', '#c0392b'));
        return;
    }
    // Trouver la commande par son champ `id`
    const snap = await db.collection('commandes_externes').where('id', '==', cmdId).limit(1).get();
    if (snap.empty) {
        res.status(404).send(htmlPage('Introuvable', `<h1>🔍 Commande introuvable</h1><p>La commande <strong>${cmdId}</strong> n'existe pas.</p>`, '#b45309'));
        return;
    }
    const docRef = snap.docs[0].ref;
    const current = snap.docs[0].data();
    if (current.statut === statut) {
        res.send(htmlPage('Déjà à jour', `<h1>✅ Déjà mis à jour</h1><p>La commande <strong>${cmdId}</strong> est déjà au statut <strong>${statut}</strong>.</p><a href="https://cuisine-yorgios.web.app/corner/commandes">Voir dans l'app</a>`));
        return;
    }
    await docRef.update({ statut, updatedAt: firestore_1.Timestamp.now(), updatedViaEmail: true });
    const colors = {
        'Accepté': '#2d7a4f',
        'Devis envoyé': '#004275',
        'Refusé': '#c0392b',
        'Annulé': '#9a9a94',
    };
    const c = colors[statut] || '#004275';
    res.send(htmlPage('Statut mis à jour', `<h1 style="color:${c}">✅ Statut mis à jour</h1><p>La commande <strong>${cmdId}</strong> — ${current.prenom || ''} ${current.nom || ''}<br>est maintenant : <strong style="color:${c}">${statut}</strong></p><a href="https://cuisine-yorgios.web.app/corner/commandes">Voir toutes les commandes</a>`));
});
// ─────────────────────────────────────────────────────────────────
// COMMANDES — Relance email toutes les 6h pour commandes "En cours"
//   Horaires : 6h, 12h, 18h (Europe/Paris) — pas d'envoi entre 20h et 6h
// ─────────────────────────────────────────────────────────────────
exports.relanceCommandes = (0, scheduler_1.onSchedule)({ schedule: '0 6,12,18 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' }, async () => {
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailUser || !gmailPass) {
        console.error('[relance] GMAIL_USER / GMAIL_APP_PASSWORD manquants');
        return;
    }
    const snap = await db.collection('commandes_externes')
        .where('statut', '==', 'En cours')
        .orderBy('dateSaisie', 'asc')
        .get();
    if (snap.empty) {
        console.log('[relance] Aucune commande En cours — email non envoyé');
        return;
    }
    const formatDate = (iso) => {
        if (!iso)
            return '?';
        const [y, m, d] = iso.split('-');
        const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
        const months = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'aoû', 'sep', 'oct', 'nov', 'déc'];
        const dt = new Date(iso);
        return `${days[dt.getDay()]} ${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
    };
    const heureActuelle = new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
    let htmlBody = `
      <div style="font-family:sans-serif;max-width:660px;margin:0 auto;color:#1c1c18;">
        <h2 style="color:#b45309;border-bottom:2px solid #b45309;padding-bottom:8px;">
          ⚠️ ${snap.size} commande(s) en attente de traitement
        </h2>
        <p style="color:#5a5a55;font-size:14px;">
          Relance automatique — ${heureActuelle} (Europe/Paris).<br>
          Ces commandes sont au statut <strong>En cours</strong> et nécessitent votre attention.
        </p>
    `;
    for (const d of snap.docs) {
        const cmd = d.data();
        const produitsList = Array.isArray(cmd.produits) && cmd.produits.length
            ? cmd.produits.map((p) => `${p.produit}${p.quantite ? ' × ' + p.quantite : ''}${p.unite ? ' ' + p.unite : ''}`).join(', ')
            : '—';
        const linkDevis = actionLink(cmd.id, 'Devis envoyé');
        const linkAccept = actionLink(cmd.id, 'Accepté');
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
      `;
    }
    htmlBody += `
        <p style="font-size:12px;color:#9a9a94;margin-top:32px;border-top:1px solid #ede9e1;padding-top:12px;">
          Matias — relance automatique toutes les 6h (06h·12h·18h).<br>
          Pas d'envoi entre 20h et 6h.<br>
          <a href="https://cuisine-yorgios.web.app/corner/commandes" style="color:#004275;">Gérer toutes les commandes dans l'app</a>
        </p>
      </div>
    `;
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
    });
    await transporter.sendMail({
        from: `"Matias" <${gmailUser}>`,
        to: 'a.cozzika@gmail.com',
        subject: `⚠️ ${snap.size} commande(s) En cours — action requise`,
        html: htmlBody,
    });
    console.log(`[relance] Email envoyé — ${snap.size} commande(s) En cours`);
});
// ─────────────────────────────────────────────────────────────────
// MESSAGERIE — Purge quotidienne des messages expirés
// ─────────────────────────────────────────────────────────────────
exports.purgeOldMessages = (0, scheduler_1.onSchedule)({ schedule: 'every 24 hours', region: 'europe-west1' }, async () => {
    const cutoff = new Date();
    const snap = await db.collection('messages')
        .where('expiresAt', '<', cutoff)
        .limit(500)
        .get();
    if (snap.empty)
        return;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    console.log(`[purge] ${snap.size} messages supprimés`);
});
// ─────────────────────────────────────────────────────────────────
// ADMIN — Créer un utilisateur (patron uniquement)
// ─────────────────────────────────────────────────────────────────
exports.sendPasswordReset = (0, https_1.onCall)({ region: 'europe-west1' }, async (request) => {
    const { email } = request.data;
    if (!email)
        throw new https_1.HttpsError('invalid-argument', 'Email manquant');
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailUser || !gmailPass)
        throw new https_1.HttpsError('internal', 'Configuration email manquante');
    // Génère le lien Firebase (sécurisé, expire en 1h)
    const resetLink = await (0, auth_1.getAuth)().generatePasswordResetLink(email);
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
    });
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
    });
    return { ok: true, resetLink };
});
// ─────────────────────────────────────────────────────────────────
exports.createUser = (0, https_1.onCall)({ region: 'europe-west1' }, async (request) => {
    var _a;
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Non authentifié');
    // Vérifier que l'appelant est patron ou administrateur
    const callerSnap = await db.collection('users').doc(request.auth.uid).get();
    if (!['patron', 'administrateur'].includes((_a = callerSnap.data()) === null || _a === void 0 ? void 0 : _a.role)) {
        throw new https_1.HttpsError('permission-denied', 'Réservé au patron / administrateur');
    }
    const { email, password, displayName, role } = request.data;
    if (!email || !password || !displayName || !role) {
        throw new https_1.HttpsError('invalid-argument', 'Champs obligatoires manquants');
    }
    const validRoles = ['patron', 'manager', 'cuisine', 'corner'];
    if (!validRoles.includes(role)) {
        throw new https_1.HttpsError('invalid-argument', 'Rôle invalide');
    }
    // Créer le compte Auth
    const userRecord = await (0, auth_1.getAuth)().createUser({ email, password, displayName });
    // Créer le doc Firestore
    await db.collection('users').doc(userRecord.uid).set({
        uid: userRecord.uid,
        email,
        displayName,
        role,
        createdAt: firestore_1.Timestamp.now(),
    });
    return { uid: userRecord.uid };
});
// ─────────────────────────────────────────────────────────────────
// ADMIN — Supprimer un utilisateur (patron uniquement)
// ─────────────────────────────────────────────────────────────────
exports.deleteUser = (0, https_1.onCall)({ region: 'europe-west1' }, async (request) => {
    var _a;
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Non authentifié');
    const callerSnap = await db.collection('users').doc(request.auth.uid).get();
    if (!['patron', 'administrateur'].includes((_a = callerSnap.data()) === null || _a === void 0 ? void 0 : _a.role)) {
        throw new https_1.HttpsError('permission-denied', 'Réservé au patron / administrateur');
    }
    const { uid } = request.data;
    if (!uid)
        throw new https_1.HttpsError('invalid-argument', 'uid manquant');
    if (uid === request.auth.uid)
        throw new https_1.HttpsError('invalid-argument', 'Impossible de supprimer son propre compte');
    await (0, auth_1.getAuth)().deleteUser(uid);
    await db.collection('users').doc(uid).delete();
    return { ok: true };
});
// ─────────────────────────────────────────────────────────────────
exports.updateUserPassword = (0, https_1.onCall)({ region: 'europe-west1' }, async (request) => {
    var _a;
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Non authentifié');
    const callerSnap = await db.collection('users').doc(request.auth.uid).get();
    if (!['patron', 'administrateur'].includes((_a = callerSnap.data()) === null || _a === void 0 ? void 0 : _a.role)) {
        throw new https_1.HttpsError('permission-denied', 'Réservé au patron / administrateur');
    }
    const { uid, password } = request.data;
    if (!uid)
        throw new https_1.HttpsError('invalid-argument', 'uid manquant');
    if (!password || password.length < 6)
        throw new https_1.HttpsError('invalid-argument', 'Mot de passe minimum 6 caractères');
    await (0, auth_1.getAuth)().updateUser(uid, { password });
    return { ok: true };
});
// ─────────────────────────────────────────────────────────────────
// RAPPELS QUOTIDIENS — Push FCM selon l'heure (Europe/Paris)
// ─────────────────────────────────────────────────────────────────
/** Récupère les UIDs des utilisateurs qui ont pointé (arrivée validée) aujourd'hui */
async function getUidsPointedToday() {
    const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' }); // YYYY-MM-DD
    const snap = await db.collection('pointages')
        .where('date', '==', today)
        .where('typePointage', '==', 'arrivée')
        .where('statut', '==', 'validé')
        .get();
    return snap.docs.map(d => d.data().userId);
}
/** Envoie une notif FCM aux UIDs spécifiés */
async function notifyUids(uids, title, body, link) {
    if (!uids.length)
        return;
    const usersSnap = await db.collection('users').get();
    const tokens = [];
    for (const u of usersSnap.docs) {
        const d = u.data();
        if (d.fcmToken && uids.includes(u.id))
            tokens.push(d.fcmToken);
    }
    if (!tokens.length)
        return;
    await (0, messaging_1.getMessaging)().sendEachForMulticast({
        tokens,
        notification: { title, body },
        webpush: {
            notification: { icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'yorgios-rappel', renotify: true },
            fcmOptions: { link },
        },
    });
}
/** 8h30 — Rappel températures frigo si non saisies (corner + patron + manager) */
exports.notifTemperatures = (0, scheduler_1.onSchedule)({ schedule: '30 8 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' }, async () => {
    const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
    const fridgeIds = ['FRIGO_3P', 'VITRINE_1', 'VITRINE_2', 'VITRINE_3', 'GRAND_FRIGO'];
    const checks = await Promise.all(fridgeIds.map(fid => db.doc(`temperatures/${today}_${fid}_matin`).get()));
    const anyFilled = checks.some(s => s.exists);
    if (anyFilled) {
        console.log('[8h30] Températures déjà saisies, pas de notif.');
        return;
    }
    await notifyRoles('🌡️ Températures frigo', "N'oublie pas de saisir les températures des frigos !", '/corner/temperatures', ['corner', 'patron', 'administrateur', 'manager']);
    console.log('[8h30] Notif températures envoyée.');
});
/** 9h00 — TooGoodToGo — envoyé aux employés qui ont pointé ce matin */
exports.notifTooGoodToGo = (0, scheduler_1.onSchedule)({ schedule: '0 9 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' }, async () => {
    const uids = await getUidsPointedToday();
    if (!uids.length) {
        console.log('[9h] Personne n\'a pointé.');
        return;
    }
    await notifyUids(uids, '🥗 TooGoodToGo', "Il est l'heure de préparer les paniers TooGoodToGo !", '/corner');
    console.log(`[9h] Notif TooGoodToGo envoyée à ${uids.length} personne(s).`);
});
/** 9h30 — Cartons chambre froide — corner + cuisine */
exports.notifCartonsChambrefroide = (0, scheduler_1.onSchedule)({ schedule: '30 9 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' }, async () => {
    await notifyRoles('📦 Chambre froide', 'A-t-on besoin de vider les cartons en chambre froide ?', '/corner', ['corner', 'patron', 'administrateur', 'manager']);
    console.log('[9h30] Notif cartons chambre froide envoyée.');
});
/** 11h00 — Plats du jour — tous les employés cuisine et corner */
exports.notifPlatsJour = (0, scheduler_1.onSchedule)({ schedule: '0 11 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' }, async () => {
    await notifyRoles('🍽️ Plats du jour', 'Faire les plats du jour.', '/cuisine', ['corner', 'patron', 'administrateur', 'manager']);
    console.log('[11h] Notif plats du jour envoyée.');
});
// ─────────────────────────────────────────────────────────────────
// POINTAGE — Email au patron si retard > 10 min (a.cozzika@gmail.com)
// Prérequis : GMAIL_USER + GMAIL_APP_PASSWORD dans functions/.env
// ─────────────────────────────────────────────────────────────────
exports.onPointageLate = (0, firestore_2.onDocumentCreated)({ document: 'pointages/{id}', region: 'europe-west1', database: 'test' }, async (event) => {
    var _a, _b, _c;
    const data = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    if (!data)
        return;
    if (data.typePointage !== 'arrivée' || data.statut !== 'validé')
        return;
    // Récupérer l'employeeId lié au compte
    const userSnap = await db.collection('users').doc(data.userId).get();
    const employeeId = (_b = userSnap.data()) === null || _b === void 0 ? void 0 : _b.employeeId;
    if (!employeeId) {
        console.log(`[retard] ${data.userName} sans lien planning — ignoré.`);
        return;
    }
    // Calculer le weekId et le dayIndex depuis la date du pointage
    const dateObj = new Date(data.date + 'T12:00:00Z');
    const jsDay = dateObj.getUTCDay(); // 0=Sun
    const dayIndex = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon, 6=Sun
    const monday = new Date(dateObj);
    monday.setUTCDate(monday.getUTCDate() - dayIndex);
    const weekId = monday.toISOString().slice(0, 10);
    // Charger le planning du jour
    const daySnap = await db.doc(`planningWeeks/${weekId}/days/${dayIndex}`).get();
    if (!daySnap.exists)
        return;
    const hoursMap = (_c = daySnap.data()) === null || _c === void 0 ? void 0 : _c.hours;
    if (!hoursMap)
        return;
    // Trouver la première heure prévue pour cet employé
    const workedHours = Object.entries(hoursMap)
        .filter(([, emps]) => emps.includes(employeeId))
        .map(([h]) => parseInt(h))
        .sort((a, b) => a - b);
    if (workedHours.length === 0)
        return;
    const firstHour = workedHours[0];
    // Comparer l'heure réelle (Paris) à l'heure prévue
    const pointageTime = data.timestamp.toDate();
    const parisLocale = pointageTime.toLocaleString('fr-FR', {
        timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const [hStr, mStr] = parisLocale.split(':');
    const actualMinutes = parseInt(hStr) * 60 + parseInt(mStr);
    const lateMinutes = actualMinutes - firstHour * 60;
    if (lateMinutes <= 10) {
        console.log(`[retard] ${data.userName} à l'heure (${lateMinutes} min).`);
        return;
    }
    // Envoyer email au patron
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailUser || !gmailPass) {
        console.error('[retard] GMAIL_USER / GMAIL_APP_PASSWORD manquants dans functions/.env');
        return;
    }
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
    });
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
    });
    console.log(`[retard] Email envoyé pour ${data.userName} (${lateMinutes} min de retard).`);
});
// ─────────────────────────────────────────────────────────────────
// LIVRAISON — Départ cuisine → notif patron + admin + manager
// Se déclenche à la création d'un doc dans livraisons/
// ─────────────────────────────────────────────────────────────────
exports.onLivraisonTemperature = (0, firestore_2.onDocumentCreated)({ document: 'livraisons/{livId}', region: 'europe-west1', database: 'test' }, async (event) => {
    var _a;
    const data = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    if (!data)
        return;
    const produit = data.productName || 'produit inconnu';
    const lot = data.lotCode || event.params.livId;
    const tempC = data.departTempC;
    const tempStr = tempC !== undefined ? `${tempC}°C` : '?°C';
    const result = data.result || 'A_VERIFIER';
    const emoji = result === 'ACCEPTE' ? '✅' : result === 'REFUSE' ? '❌' : '⚠️';
    await notifyRoles(`${emoji} Livraison envoyée — ${produit}`, `Départ : ${tempStr} (${result}) · Lot ${lot}`, '/corner/livraison', ['patron', 'administrateur', 'manager']);
    console.log(`[livraison-depart] Notif envoyée pour lot ${lot} — ${tempStr} ${result}`);
});
// ─────────────────────────────────────────────────────────────────
// LIVRAISON — Réception corner → notif patron + admin + manager
// Se déclenche à la mise à jour d'un doc livraisons/ quand
// receptionTempC passe de null à une valeur saisie
// ─────────────────────────────────────────────────────────────────
exports.onLivraisonReception = (0, firestore_2.onDocumentUpdated)({ document: 'livraisons/{livId}', region: 'europe-west1', database: 'test' }, async (event) => {
    var _a, _b, _c, _d;
    const before = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
    const after = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
    if (!before || !after)
        return;
    // Ne déclencher que quand receptionAt passe de absent à défini (réception enregistrée)
    if (before.receptionAt != null)
        return;
    if (after.receptionAt == null)
        return;
    const produit = after.productName || 'produit inconnu';
    const lot = after.lotCode || event.params.livId;
    const tempC = after.receptionTempC;
    const result = after.result || 'A_VERIFIER';
    const emoji = result === 'ACCEPTE' ? '✅' : result === 'REFUSE' ? '❌' : '⚠️';
    const tempLabel = tempC != null ? `${tempC}°C` : 'sans temp.';
    await notifyRoles(`${emoji} Réception corner — ${produit}`, `Réception : ${tempLabel} (${result}) · Lot ${lot}`, '/corner/livraison', ['patron', 'administrateur', 'manager']);
    console.log(`[livraison-reception] Notif envoyée pour lot ${lot} — ${tempLabel} ${result}`);
    if (result === 'REFUSE') {
        const gmailUser = process.env.GMAIL_USER;
        const gmailPass = process.env.GMAIL_APP_PASSWORD;
        if (gmailUser && gmailPass) {
            const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } });
            await transporter.sendMail({
                from: `"Matias" <${gmailUser}>`,
                to: 'a.cozzika@gmail.com',
                subject: `❌ Non-conformité température — ${produit}`,
                text: [
                    `Non-conformité détectée au corner Yorgios.`,
                    `Produit : ${produit}`,
                    `Lot : ${lot}`,
                    `Température réception : ${tempC}°C`,
                    `Résultat : REFUSÉ (hors tolérance GEP)`,
                ].join('\n'),
            }).catch((e) => console.error('[livraison-reception] Email error:', e));
        }
    }
});
/** 15h00 — Urgences corner — aux employés qui ont pointé */
exports.notifUrgences = (0, scheduler_1.onSchedule)({ schedule: '0 15 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' }, async () => {
    const uids = await getUidsPointedToday();
    if (!uids.length) {
        console.log('[15h] Personne n\'a pointé.');
        return;
    }
    await notifyUids(uids, '⚡ Urgences du soir', "C'est l'heure d'informer la cuisine de vos urgences et ruptures !", '/corner/ruptures');
    console.log(`[15h] Notif urgences envoyée à ${uids.length} personne(s).`);
});
/** 22h00 — Rappel températures soir si non saisies (corner + patron + manager) */
exports.notifTemperaturesEvening = (0, scheduler_1.onSchedule)({ schedule: '0 22 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' }, async () => {
    const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
    const fridgeIds = ['FRIGO_3P', 'VITRINE_1', 'VITRINE_2', 'VITRINE_3', 'GRAND_FRIGO'];
    const checks = await Promise.all(fridgeIds.map(fid => db.doc(`temperatures/${today}_${fid}_soir`).get()));
    const anyFilled = checks.some(s => s.exists);
    if (anyFilled) {
        console.log('[22h] Températures soir déjà saisies, pas de notif.');
        return;
    }
    await notifyRoles('🌡️ Températures soir manquantes', "Les relevés de température du soir n'ont pas encore été saisis !", '/corner/temperatures', ['corner', 'patron', 'administrateur', 'manager']);
    console.log('[22h] Notif températures soir envoyée.');
});
/** Samedi 18h00 — Rappel hygiène hebdo si non faite (corner + patron + manager) */
exports.notifHygieneHebdo = (0, scheduler_1.onSchedule)({ schedule: '0 18 * * 6', timeZone: 'Europe/Paris', region: 'europe-west1' }, async () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    // Calcul ISO week
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const w1 = new Date(date.getFullYear(), 0, 4);
    const isoWeek = 1 + Math.round(((date.getTime() - w1.getTime()) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7);
    const weekId = `${date.getFullYear()}-W${String(isoWeek).padStart(2, '0')}_hebdo`;
    const snap = await db.doc(`hygiene_corner/${weekId}`).get();
    if (snap.exists) {
        console.log('[hebdo] Hygiène hebdo déjà faite, pas de notif.');
        return;
    }
    await notifyRoles('🧼 Hygiène hebdo non faite', "La checklist d'hygiène hebdomadaire n'a pas encore été complétée cette semaine !", '/corner/hygiene', ['corner', 'patron', 'administrateur', 'manager']);
    console.log('[hebdo] Notif hygiène hebdo envoyée.');
});
/** Avant-dernier jour du mois à 18h — Rappel hygiène mensuelle si non faite */
exports.notifHygieneMensuel = (0, scheduler_1.onSchedule)({ schedule: '0 18 28-31 * *', timeZone: 'Europe/Paris', region: 'europe-west1' }, async () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    // Vérifier que demain est bien le dernier jour du mois
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(tomorrow.getDate() + 1);
    if (tomorrow.getMonth() === dayAfter.getMonth()) {
        // Demain n'est pas le dernier jour du mois → sortir
        return;
    }
    const p = (n) => String(n).padStart(2, '0');
    const monthId = `${now.getFullYear()}-${p(now.getMonth() + 1)}_mensuel`;
    const snap = await db.doc(`hygiene_corner/${monthId}`).get();
    if (snap.exists) {
        console.log('[mensuel] Hygiène mensuelle déjà faite, pas de notif.');
        return;
    }
    await notifyRoles('🧼 Hygiène mensuelle non faite', "La checklist d'hygiène mensuelle n'a pas encore été complétée ce mois-ci !", '/corner/hygiene', ['corner', 'patron', 'administrateur', 'manager']);
    console.log('[mensuel] Notif hygiène mensuelle envoyée.');
});
/** Lundi 8h00 — Récap hebdo hygiène + températures manquantes (email patron + manager) */
exports.weeklyHygieneRecap = (0, scheduler_1.onSchedule)({ schedule: '0 8 * * 1', timeZone: 'Europe/Paris', region: 'europe-west1' }, async () => {
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailUser || !gmailPass) {
        console.error('[weeklyRecap] GMAIL_USER / GMAIL_APP_PASSWORD manquants dans functions/.env');
        return;
    }
    // Calculer la semaine précédente (lundi → dimanche)
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1; // 0=lundi
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - dayOfWeek - 7);
    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(lastMonday);
        d.setDate(lastMonday.getDate() + i);
        days.push(d.toLocaleDateString('fr-CA'));
    }
    const weekLabel = `${days[0]} → ${days[6]}`;
    // Vérifier températures manquantes
    const fridgeIds = ['FRIGO_3P', 'VITRINE_1', 'VITRINE_2', 'VITRINE_3', 'GRAND_FRIGO'];
    const sessions = ['matin', 'soir'];
    const missingTemps = [];
    for (const day of days) {
        for (const session of sessions) {
            const missing = [];
            for (const fid of fridgeIds) {
                const snap = await db.doc(`temperatures/${day}_${fid}_${session}`).get();
                if (!snap.exists)
                    missing.push(fid);
            }
            if (missing.length > 0) {
                missingTemps.push(`  ${day} ${session} : ${missing.join(', ')}`);
            }
        }
    }
    // Vérifier hygiène manquante (quotidien uniquement)
    const missingHygiene = [];
    for (const day of days) {
        const snap = await db.doc(`hygiene_corner/${day}_quotidien`).get();
        if (!snap.exists)
            missingHygiene.push(`  ${day}`);
    }
    // Vérifier hygiène hebdo (semaine ISO)
    const isoYear = lastMonday.getFullYear();
    const isoWeek = (() => {
        const tmp = new Date(Date.UTC(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate()));
        const dayNum = tmp.getUTCDay() || 7;
        tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
        return Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    })();
    const weekId = `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;
    const hebdoSnap = await db.doc(`hygiene_corner/${weekId}_hebdo`).get();
    const missingHebdo = !hebdoSnap.exists ? `  ${weekId}_hebdo` : null;
    // Si rien à signaler
    if (missingTemps.length === 0 && missingHygiene.length === 0 && !missingHebdo) {
        console.log('[weeklyRecap] Tout est complet, aucun email envoyé.');
        return;
    }
    // Récupérer emails patron + manager
    const usersSnap = await db.collection('users').get();
    const emails = [];
    for (const u of usersSnap.docs) {
        const d = u.data();
        if (['patron', 'administrateur', 'manager'].includes(d.role) && d.email) {
            emails.push(d.email);
        }
    }
    if (!emails.length) {
        console.log('[weeklyRecap] Aucun email destinataire trouvé.');
        return;
    }
    // Construire le corps de l'email
    const lines = [
        `Bonjour,`,
        ``,
        `Récapitulatif de la semaine ${weekLabel} — éléments manquants :`,
        ``,
    ];
    if (missingTemps.length > 0) {
        lines.push(`🌡️ TEMPÉRATURES MANQUANTES (${missingTemps.length} relevés) :`);
        lines.push(...missingTemps);
        lines.push(``);
    }
    if (missingHygiene.length > 0) {
        lines.push(`🧹 HYGIÈNE QUOTIDIENNE MANQUANTE (${missingHygiene.length} jour(s)) :`);
        lines.push(...missingHygiene);
        lines.push(``);
    }
    if (missingHebdo) {
        lines.push(`📋 HYGIÈNE HEBDO MANQUANTE :`);
        lines.push(missingHebdo);
        lines.push(``);
    }
    lines.push(`Cordialement,`, `Matias`);
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
    });
    await transporter.sendMail({
        from: `"Matias" <${gmailUser}>`,
        to: emails.join(', '),
        subject: `📋 Récap semaine ${weekLabel} — éléments manquants`,
        text: lines.join('\n'),
    });
    console.log(`[weeklyRecap] Email envoyé à ${emails.join(', ')} — ${missingTemps.length} temp, ${missingHygiene.length} hygiene manquants.`);
});
// ─────────────────────────────────────────────────────────────────
// GMAO — Email à Christelle (callable) + rappel hebdo lundi 9h
// ─────────────────────────────────────────────────────────────────
exports.sendGmaoEmail = (0, https_1.onCall)({ region: 'europe-west1' }, async (request) => {
    var _a;
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Auth required');
    const { demandeId, to, customBody } = request.data;
    const demandeSnap = await db.collection('gmao_demandes').doc(demandeId).get();
    if (!demandeSnap.exists)
        throw new https_1.HttpsError('not-found', 'Demande introuvable');
    const d = demandeSnap.data();
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
    });
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
    `;
    await transporter.sendMail({
        from: `"Matias App" <${gmailUser}>`,
        to,
        subject: `[GMAO] ${d.departement} — ${String((_a = d.motif) !== null && _a !== void 0 ? _a : '').substring(0, 60)} — YORGIOS`,
        html: bodyHtml,
    });
    return { success: true };
});
exports.gmaoWeeklyReminder = (0, scheduler_1.onSchedule)({
    schedule: 'every monday 09:00',
    timeZone: 'Europe/Paris',
    region: 'europe-west1',
}, async () => {
    const snap = await db.collection('gmao_demandes').where('statut', '==', 'en cours').get();
    if (snap.empty)
        return;
    const demandes = snap.docs.map(d => d.data());
    const html = `
    <h2>⚠️ Rappel hebdomadaire GMAO — ${demandes.length} demande(s) en cours</h2>
    ${demandes.map((d) => `
      <div style="border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:12px">
        <strong>${d.departement}</strong>${d.numeroIntervention ? ` — #${d.numeroIntervention}` : ''}<br>
        ${d.motif}<br>
        <small style="color:#666">Depuis le ${d.date}</small>
        ${d.photoUrl ? `<br><a href="${d.photoUrl}">📎 Document</a>` : ''}
      </div>
    `).join('')}
  `;
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
    });
    await transporter.sendMail({
        from: `"Matias App" <${gmailUser}>`,
        to: ['a.cozzika@gmail.com', 'sebastien.coenca@gmail.com'],
        subject: `[GMAO] ${demandes.length} demande(s) en cours`,
        html,
    });
});
// ─────────────────────────────────────────────────────────────────
// RUPTURES + COMMANDES — Email Timour 21h30 chaque soir
// ─────────────────────────────────────────────────────────────────
async function buildRupturesCommandesEmail() {
    var _a, _b, _c;
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    // 1. Ruptures actives depuis minuit
    const ruptSnap = await db.collection('ruptures_actives')
        .where('createdAt', '>=', firestore_1.Timestamp.fromDate(midnight))
        .get();
    // 2. FlatMap + déduplication case-insensitive
    const urgentMap = new Map();
    const moinsMap = new Map();
    for (const d of ruptSnap.docs) {
        const data = d.data();
        for (const name of ((_a = data.ruptures) !== null && _a !== void 0 ? _a : [])) {
            const k = String(name).toLowerCase().trim();
            if (!urgentMap.has(k))
                urgentMap.set(k, name);
        }
        for (const name of ((_b = data.presqueRuptures) !== null && _b !== void 0 ? _b : [])) {
            const k = String(name).toLowerCase().trim();
            if (!urgentMap.has(k) && !moinsMap.has(k))
                moinsMap.set(k, name);
        }
    }
    // 3. Priorités depuis catalogue
    const catSnap = await db.collection('catalogue').get();
    const prio = new Map();
    for (const d of catSnap.docs) {
        const data = d.data();
        if (data.name)
            prio.set(String(data.name).toLowerCase().trim(), (_c = data.priority) !== null && _c !== void 0 ? _c : 9999);
    }
    const byPrio = (a, b) => { var _a, _b; return ((_a = prio.get(a.toLowerCase().trim())) !== null && _a !== void 0 ? _a : 9999) - ((_b = prio.get(b.toLowerCase().trim())) !== null && _b !== void 0 ? _b : 9999); };
    const urgentList = [...urgentMap.values()].sort(byPrio);
    const moinsUrgList = [...moinsMap.values()].sort(byPrio);
    // 4. Commandes actives
    const cmdSnap = await db.collection('commandes_externes')
        .where('statut', 'in', ['en cours', 'devis envoyé', 'accepté'])
        .get();
    const commandes = cmdSnap.docs.map(d => d.data());
    const hasContent = urgentList.length > 0 || moinsUrgList.length > 0 || commandes.length > 0;
    const dateStr = now.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' });
    const ruptHtml = (urgentList.length === 0 && moinsUrgList.length === 0)
        ? '<p style="color:#666">Aucune rupture aujourd\'hui ✓</p>'
        : `
      ${urgentList.length > 0 ? `
        <p style="font-weight:700;color:#c0392b;margin:12px 0 6px">🔴 Urgent</p>
        <ul style="margin:0;padding-left:20px;color:#c0392b">
          ${urgentList.map(n => `<li style="margin-bottom:4px;font-weight:600">${n}</li>`).join('')}
        </ul>` : ''}
      ${moinsUrgList.length > 0 ? `
        <p style="font-weight:700;color:#e67500;margin:12px 0 6px">🟠 Moins urgent</p>
        <ul style="margin:0;padding-left:20px;color:#e67500">
          ${moinsUrgList.map(n => `<li style="margin-bottom:4px">${n}</li>`).join('')}
        </ul>` : ''}
    `;
    const cmdHtml = commandes.length === 0
        ? '<p style="color:#666">Aucune commande active</p>'
        : `<ul style="margin:0;padding-left:20px">
        ${commandes.map(c => {
            var _a, _b;
            return `<li style="margin-bottom:6px">
          <strong>${(_a = c.prenom) !== null && _a !== void 0 ? _a : ''} ${(_b = c.nom) !== null && _b !== void 0 ? _b : ''}</strong>
          ${c.dateLivraison ? ` — livraison le <strong>${c.dateLivraison}</strong>` : ''}
          ${c.statut ? ` — <em>${c.statut}</em>` : ''}
        </li>`;
        }).join('')}
      </ul>`;
    const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#004275;border-bottom:2px solid #004275;padding-bottom:8px">
        Récap soir — ${dateStr}
      </h2>

      <h3 style="color:#c0392b;margin-top:24px">Ruptures</h3>
      ${ruptHtml}

      <h3 style="color:#004275;margin-top:24px">Commandes actives (${commandes.length})</h3>
      ${cmdHtml}

      <p style="color:#999;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:12px">
        Envoyé automatiquement par Matias — ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
  `;
    return { subject: `[Yorgios] Récap ruptures + commandes — ${dateStr}`, html, hasContent };
}
/** 21h30 — Email récap ruptures + commandes à Timour */
exports.notifNightlyRuptures = (0, scheduler_1.onSchedule)({
    schedule: '30 21 * * *',
    timeZone: 'Europe/Paris',
    region: 'europe-west1',
}, async () => {
    const { subject, html } = await buildRupturesCommandesEmail();
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } });
    await transporter.sendMail({ from: `"Matias" <${gmailUser}>`, to: 'ytimour86@gmail.com', cc: 'yorgios.system@gmail.com', subject, html });
    console.log('[21h30] Email récap ruptures+commandes envoyé à Timour.');
});
/** Callable — test immédiat (patron/admin uniquement) */
exports.sendNightlyRupturesNow = (0, https_1.onCall)({ region: 'europe-west1' }, async (request) => {
    var _a;
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Auth required');
    const userDoc = await db.collection('users').doc(request.auth.uid).get();
    const role = (_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.role;
    if (!['patron', 'administrateur'].includes(role))
        throw new https_1.HttpsError('permission-denied', 'Patron/admin uniquement');
    const { subject, html } = await buildRupturesCommandesEmail();
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } });
    await transporter.sendMail({ from: `"Matias" <${gmailUser}>`, to: 'ytimour86@gmail.com', cc: 'yorgios.system@gmail.com', subject, html });
    return { success: true };
});
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
exports.syncContactToBrevo = (0, https_1.onCall)({ region: 'europe-west1', secrets: ['BREVO_API_KEY', 'BREVO_LIST_ID'] }, async (req) => {
    if (!req.auth)
        throw new https_1.HttpsError('unauthenticated', 'Authentification requise');
    const { syncContactToBrevoLogic } = await Promise.resolve().then(() => __importStar(require('./crm')));
    return syncContactToBrevoLogic(req.data);
});
// ─────────────────────────────────────────────────────────────────
// CRM — Validation code promo (Matias — appelants authentifiés)
// ─────────────────────────────────────────────────────────────────
exports.validatePromoCode = (0, https_1.onCall)({ region: 'europe-west1' }, async (req) => {
    if (!req.auth)
        throw new https_1.HttpsError('unauthenticated', 'Authentification requise');
    const { validatePromoCodeLogic } = await Promise.resolve().then(() => __importStar(require('./crm')));
    return validatePromoCodeLogic(req.data.clientPhone, req.data.code);
});
// ─────────────────────────────────────────────────────────────────
// CRM — Validation code promo (WordPress, header X-Yorgios-Secret)
// ─────────────────────────────────────────────────────────────────
exports.validatePromoCodePublic = (0, https_1.onRequest)({ region: 'europe-west1', secrets: ['YORGIOS_WP_SECRET'], cors: true }, async (req, res) => {
    const secret = req.headers['x-yorgios-secret'];
    if (!secret || secret !== process.env.YORGIOS_WP_SECRET) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    const { validatePromoCodeLogic } = await Promise.resolve().then(() => __importStar(require('./crm')));
    const result = await validatePromoCodeLogic(req.body.clientPhone, req.body.code);
    res.json(result);
});
// ─────────────────────────────────────────────────────────────────
// POINTAGE — Validation GPS côté serveur (A3)
// Le client envoie lat/lng/accuracy, le serveur détermine le statut
// et écrit en Firestore via admin SDK (impossible à falsifier)
// ─────────────────────────────────────────────────────────────────
const POINTAGE_ZONES_SERVER = [
    { id: 'cuisine', label: 'Cuisine', lat: 48.8739, lng: 2.3498, radiusMeters: 80 },
    { id: 'corner', label: 'Corner', lat: 48.85034, lng: 2.32394, radiusMeters: 100 },
];
const GPS_ACCURACY_LIMIT_SERVER = 200; // mètres (WiFi iPad ~50-200m)
function haversineServer(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (x) => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
exports.createPointage = (0, https_1.onCall)({ region: 'europe-west1' }, async (req) => {
    var _a, _b, _c, _d, _e, _f, _g;
    if (!req.auth)
        throw new https_1.HttpsError('unauthenticated', 'Authentification requise');
    const { latitude, longitude, accuracy, typePointage } = req.data;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        throw new https_1.HttpsError('invalid-argument', 'Coordonnées GPS invalides');
    }
    if (!['arrivée', 'départ'].includes(typePointage)) {
        throw new https_1.HttpsError('invalid-argument', 'Type de pointage invalide');
    }
    const uid = req.auth.uid;
    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.data();
    const userName = (userData === null || userData === void 0 ? void 0 : userData.displayName) || ((_a = userData === null || userData === void 0 ? void 0 : userData.email) === null || _a === void 0 ? void 0 : _a.split('@')[0]) || 'Inconnu';
    // Double-check du rôle côté serveur — managers ne pointent pas
    const role = (userData === null || userData === void 0 ? void 0 : userData.role) || '';
    if (['manager'].includes(role)) {
        throw new https_1.HttpsError('permission-denied', 'Les managers ne pointent pas');
    }
    // Précision GPS insuffisante → refus immédiat
    if (accuracy > GPS_ACCURACY_LIMIT_SERVER) {
        throw new https_1.HttpsError('failed-precondition', `Signal GPS trop imprécis (±${Math.round(accuracy)} m)`);
    }
    // Anti-doublon : pas deux pointages de même type valides le même jour
    const today = new Date().toISOString().slice(0, 10);
    const existingSnap = await db.collection('pointages')
        .where('userId', '==', uid)
        .where('date', '==', today)
        .where('typePointage', '==', typePointage)
        .where('statut', '==', 'validé')
        .limit(1)
        .get();
    if (!existingSnap.empty) {
        const existing = existingSnap.docs[0].data();
        throw new https_1.HttpsError('already-exists', `Pointage ${typePointage} déjà enregistré aujourd'hui à ${(_d = (_c = (_b = existing.timestamp) === null || _b === void 0 ? void 0 : _b.toDate) === null || _c === void 0 ? void 0 : _c.call(_b).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })) !== null && _d !== void 0 ? _d : '—'}`);
    }
    // Calcul zone côté serveur
    let detectedZone = null;
    let minDistance = Infinity;
    for (const zone of POINTAGE_ZONES_SERVER) {
        const dist = Math.round(haversineServer(latitude, longitude, zone.lat, zone.lng));
        if (dist < minDistance)
            minDistance = dist;
        if (dist <= zone.radiusMeters) {
            detectedZone = { id: zone.id, label: zone.label, dist };
            break;
        }
    }
    const statut = detectedZone ? 'validé' : 'refusé';
    await db.collection('pointages').add({
        userId: uid,
        userName,
        date: today,
        typePointage,
        zoneId: (_e = detectedZone === null || detectedZone === void 0 ? void 0 : detectedZone.id) !== null && _e !== void 0 ? _e : 'hors_zone',
        zoneLabel: (_f = detectedZone === null || detectedZone === void 0 ? void 0 : detectedZone.label) !== null && _f !== void 0 ? _f : 'Hors zone',
        timestamp: firestore_1.Timestamp.now(),
        latitude,
        longitude,
        accuracy: Math.round(accuracy),
        distanceToZone: (_g = detectedZone === null || detectedZone === void 0 ? void 0 : detectedZone.dist) !== null && _g !== void 0 ? _g : minDistance,
        statut,
        _serverValidated: true,
    });
    if (statut === 'refusé') {
        throw new https_1.HttpsError('out-of-range', `Hors zone autorisée. ${POINTAGE_ZONES_SERVER.map(z => `${z.label} (${Math.round(haversineServer(latitude, longitude, z.lat, z.lng))} m)`).join(', ')}`);
    }
    return { statut, zoneId: detectedZone.id, zoneLabel: detectedZone.label };
});
// ─────────────────────────────────────────────────────────────────
// TWILIO — Suivi livraison coursier
// ─────────────────────────────────────────────────────────────────
/**
 * Webhook Twilio — reçoit les SMS du coursier Pick&Drop.
 * Sécurisé par validation de signature Twilio.
 * Écrit dans la collection `deliveries` (Admin SDK) et envoie FCM.
 */
exports.incomingSms = (0, https_1.onRequest)({ region: 'europe-west1', cors: false, secrets: ['TWILIO_AUTH_TOKEN'] }, async (req, res) => {
    var _a, _b;
    // ── 1. Méthode
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }
    // ── 2. Validation signature Twilio
    const authToken = process.env.TWILIO_AUTH_TOKEN || '';
    const signature = req.headers['x-twilio-signature'];
    if (authToken && signature) {
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers['x-forwarded-host'] || req.headers.host || '';
        const url = `${proto}://${host}${req.originalUrl}`;
        const valid = (0, webhooks_1.validateRequest)(authToken, signature, url, req.body);
        if (!valid) {
            console.warn('incomingSms: invalid Twilio signature');
            res.status(403).send('Forbidden');
            return;
        }
    }
    else {
        console.warn('incomingSms: TWILIO_AUTH_TOKEN not configured, skipping signature check');
    }
    // ── 3. Extraire le corps du SMS
    const body = req.body;
    const rawMessage = body.Body || '';
    const phoneNumber = body.From || '';
    if (!rawMessage) {
        res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
        return;
    }
    console.log(`incomingSms from ${phoneNumber}: ${rawMessage}`);
    // ── 4. Parser l'URL de tracking (Pick&Drop en priorité, fallback générique)
    const pickDropMatch = rawMessage.match(/https:\/\/pick-and-drop\.everst\.io\/follow\/\w+/);
    const genericMatch = rawMessage.match(/https?:\/\/\S+/);
    const trackingUrl = (_b = (_a = pickDropMatch === null || pickDropMatch === void 0 ? void 0 : pickDropMatch[0]) !== null && _a !== void 0 ? _a : genericMatch === null || genericMatch === void 0 ? void 0 : genericMatch[0]) !== null && _b !== void 0 ? _b : null;
    // ── 5. Parser l'ETA (ex: "14:30" ou "14h30")
    const etaMatch = rawMessage.match(/\b(\d{1,2})[h:](\d{2})\b/);
    const eta = etaMatch ? `${etaMatch[1]}:${etaMatch[2]}` : null;
    // ── 6. Déduplication : si un doc `in_progress` avec ce trackingUrl existe déjà → update
    if (trackingUrl) {
        const existing = await db.collection('deliveries')
            .where('trackingUrl', '==', trackingUrl)
            .where('status', '==', 'in_progress')
            .limit(1)
            .get();
        if (!existing.empty) {
            await existing.docs[0].ref.update({
                rawMessage,
                updatedAt: firestore_1.Timestamp.now(),
                ...(eta ? { eta } : {}),
            });
            console.log(`incomingSms: updated existing delivery ${existing.docs[0].id}`);
            res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
            return;
        }
    }
    // ── 7. Créer un nouveau doc `deliveries`
    const now = firestore_1.Timestamp.now();
    await db.collection('deliveries').add({
        trackingUrl,
        rawMessage,
        phoneNumber,
        eta,
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
    });
    // ── 8. FCM aux employés pointés aujourd'hui
    try {
        const uids = await getUidsPointedToday();
        const etaLabel = eta ? ` — ETA ${eta}` : '';
        await notifyUids(uids, '🚚 Livraison en cours', `Coursier en route${etaLabel}`, '/corner/livraison');
    }
    catch (e) {
        console.error('incomingSms: FCM error', e);
    }
    // ── 9. Réponse TwiML vide (pas de SMS de retour)
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});
/** 13h00 — Efface les demandes de ruptures non vues (nouveau cycle après-midi) */
exports.clearRupturesAt13h = (0, scheduler_1.onSchedule)({ schedule: '0 13 * * *', timeZone: 'Europe/Paris', region: 'europe-west1' }, async () => {
    const snap = await db.collection('ruptures_actives').where('viewed', '==', false).get();
    if (snap.empty) {
        console.log('[13h] Aucune rupture active non vue.');
        return;
    }
    const batch = db.batch();
    snap.docs.forEach(d => batch.update(d.ref, { viewed: true }));
    await batch.commit();
    console.log(`[13h] ${snap.size} rupture(s) active(s) marquée(s) vues.`);
});
//# sourceMappingURL=index.js.map