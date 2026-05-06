import { db } from './_firebase_admin.mjs'
import { Timestamp } from 'firebase-admin/firestore'

const DEFAULT_CHARTE = `Charte interne & règles de fonctionnement Yorgios
Version 1.0 — Avril 2026
Responsable : Alexandre Cozzika — 31 rue d'Hauteville, 75010 Paris
Responsable RGPD et Application : Arthur Kyriazis — 17 rue de Paradis, 75010 Paris

---

1. PRÉSENTATION

Yorgios est une entreprise fondée par Alexandre Cozzika en 2019, présente à La Grande Épicerie de Paris depuis avril 2025. Notre identité repose sur l'authenticité, l'exigence, le partage, la transmission et l'esprit de famille.

Ce règlement s'applique à l'ensemble des membres de l'équipe Yorgios. Il précise les obligations communes et vient compléter le livret d'accueil.

---

2. PONCTUALITÉ ET RETARDS

Prise de poste : arriver en tenue, prêt à travailler à l'heure prévue. L'heure de prise de poste ne signifie pas "arriver" mais "être opérationnel".

En cas de retard : prévenir Alexandre ou le manager par message ou appel AVANT l'heure de début du shift. Un retard non signalé est une faute.

Tolérance : 5 minutes maximum. Au-delà de 10 minutes, le manager est automatiquement notifié via l'application Matias.

Récidive : La répétition de retards non justifiés pourra entraîner une sanction disciplinaire.

---

3. CONGÉS ET ABSENCES

Délai obligatoire : En principe, les demandes doivent être faites 4 semaines à l'avance (1 mois) via l'application Matias (Profil → Demandes de congés). Toute demande tardive pourra être refusée en fonction des contraintes d'organisation.

Procédure : soumission dans l'app → email aux responsables → validation ou refus par le manager → email de réponse à l'employé.

Absence imprévue : prévenir Alexandre ET le manager avant le début du shift, sans attendre.

Absence non justifiée : constitue un manquement pouvant entraîner une sanction disciplinaire pouvant aller jusqu'au licenciement selon la gravité.

Congés non soumis via l'application : tout congé non validé par un responsable est considéré comme une absence injustifiée.

---

4. POINTAGE OBLIGATOIRE (APPLICATION MATIAS)

Tout membre de l'équipe doit pointer son arrivée et son départ via l'application Matias à chaque shift. Le pointage utilise la géolocalisation et doit être effectué sur place. La géolocalisation est utilisée uniquement lors du pointage afin de vérifier la présence sur le lieu de travail. Elle n'est pas utilisée en continu.

- Arrivée : pointer dès la prise de poste.
- Départ : pointer impérativement avant de quitter le poste.
- Problème technique : en informer immédiatement le manager ou Alexandre.

Un auto-checkout est enregistré à l'heure de fin prévue si le départ n'est pas pointé. Cela ne remplace pas l'obligation de pointer manuellement.

---

5. TENUE DE TRAVAIL

La tenue est fournie par Yorgios à l'embauche et doit être portée intégralement pendant toute la durée du service.

- Tenue : chemise en jean Yorgios ou t-shirt Yorgios + casquette Yorgios. Ne rien porter au-dessus de la chemise, sauf tablier.
- Cheveux : propres, courts ou attachés. Pas de mèches dépassant. Casquette obligatoire sur le stand.
- Mains et ongles : propres. Vernis et faux ongles STRICTEMENT INTERDITS (obligation légale alimentaire).
- Bijoux : interdits, sauf alliance simple (pour des raisons d'hygiène et de sécurité alimentaire).
- Téléphone : en poche, mode silencieux. Pas de téléphone visible en stand pendant le service, sauf urgence ou nécessité professionnelle.

---

6. COMPORTEMENT ET SERVICE CLIENT

Esprit d'équipe : initiative, rigueur, bienveillance, respect des collègues et amélioration continue sont les valeurs attendues.

Relation client :
- Arrêter toute tâche dès qu'un client se présente (nettoyage, vaisselle, réassort…).
- "Bonjour Madame/Monsieur" à l'arrivée ; "Merci, bonne journée, à bientôt" au départ.
- Sourire et attitude avenante en toutes circonstances.
- Service client assuré jusqu'à la fermeture, même si les produits sont déjà filmés.
- Pas de consommation de nourriture ni téléphone visible en présence de clients.

Image de marque : toujours représenter Yorgios comme une marque premium. Tenue irréprochable, vocabulaire professionnel, posture soignée. Les clients voient tout.

---

7. OBLIGATIONS HACCP ET HYGIÈNE ALIMENTAIRE

Le respect des règles HACCP est une obligation légale. Tout manquement expose l'entreprise à des sanctions graves.

7.1 Températures des frigos (via l'application Matias)

Les températures des frigos et vitrines doivent être relevées et saisies dans l'onglet Températures de l'application Matias DEUX FOIS PAR JOUR :
- Matin : à l'ouverture, avant le début du service.
- Soir : avant fermeture du stand.

Toute température anormale doit être signalée immédiatement au manager ou à Alexandre. Le non-renseignement des températures est une faute.

7.2 Checklists d'hygiène (via l'application Matias)

Les checklists de l'onglet Hygiène doivent être validées régulièrement. Elles constituent la traçabilité officielle en cas de contrôle sanitaire.

- Quotidienne (13 items) : vitrines, ustensiles, comptoir, meubles, frigos, éviers, étiquettes, plan de travail, extérieur placards/frigos, poubelle, vitres. À valider chaque jour de travail.
- Hebdomadaire (5 items) : intérieur frigos, étagères/matériels, support papier, placard hygiène, machine à glaçons. À valider chaque semaine.
- Mensuelle (1 item) : placard de rangement. À valider chaque mois.

7.3 Règles générales d'hygiène alimentaire

- Lavage des mains : à la prise de poste, après toute activité contaminante, régulièrement.
- Tous les aliments sont lavés au vinaigre blanc avant utilisation.
- Produits entamés : filmés, datés, identifiés (nom + date de fabrication).
- Produit nu tombé par terre = jeté immédiatement.
- Aucun stockage au sol.
- Chaque produit doit avoir son étiquette prix à jour et lisible.
- Saladiers et ustensiles désinfectés au vinaigre avant toute utilisation.

---

8. PAUSES

- Pause de 20 minutes obligatoire si le shift dépasse 6 heures d'affilée.
- Les pauses ne doivent pas être prises simultanément : s'organiser avec ses collègues.
- Si la pause est prise, le shift est prolongé d'autant.
- INTERDIT de prendre une pause pendant les moments de rush (déjeuner et fermeture).
- Shift du matin : pause après rangement de la livraison.
- Shift après-midi/soir : pause à 18h lors de l'arrivée de l'équipier du soir.

---

9. APPLICATION MATIAS — USAGE OBLIGATOIRE

L'application Matias est l'outil de travail officiel de l'équipe. Son utilisation est obligatoire pour : pointer arrivée et départ, saisir les températures des frigos, valider les checklists d'hygiène, gérer la vitrine et les stocks, signaler les ruptures produits, soumettre les demandes de congés, consulter le planning.

Toute action non réalisée dans l'application est considérée comme non faite.

---

10. SÉCURITÉ

- Accident / malaise : appeler les pompiers internes — poste interne : 18 ou 26066 ; téléphone extérieur : 01 45 48 47 94. Ne pas se rendre à l'infirmerie sans accompagnement.
- Sûreté : contacts équipes sûreté : 01 71 37 85 28 ou 01 71 37 86 16.
- Signaler immédiatement au manager ou à Alexandre tout incident, panne ou problème technique.

---

11. CONFIDENTIALITÉ

Les informations relatives aux recettes, fournisseurs, prix, procédures internes et données clients de Yorgios sont strictement confidentielles et ne doivent pas être divulguées à des tiers.

---

12. SANCTIONS

"Le non-respect des règles entraîne un blâme. Les répétitions entraînent des sanctions disciplinaires." (Livret d'accueil Yorgios)

1. Avertissement oral — premier manquement non grave.
2. Blâme écrit — récidive ou manquement significatif.
3. Sanction disciplinaire — répétition ou manquement grave (non-respect HACCP, absence injustifiée répétée, comportement inapproprié).

Aucune sanction ne peut être prise sans que le salarié ait été informé des faits qui lui sont reprochés et ait pu s'expliquer.

---

13. HARCÈLEMENT

Aucun salarié ne doit subir des agissements de harcèlement moral ou sexuel ni de discrimination.

---

En signant ce document, vous certifiez l'avoir lu et compris dans son intégralité et vous engagez à le respecter.`

const ref = db.collection('settings').doc('reglement_interieur')
const snap = await ref.get()

if (snap.exists) {
  console.log('ℹ️  settings/reglement_interieur existe déjà — aucune modification.')
  console.log('   Contenu actuel :', JSON.stringify({ version: snap.data().version, active: snap.data().active, contentLength: snap.data().content?.length }))
} else {
  await ref.set({
    content: DEFAULT_CHARTE,
    version: '1.0',
    active: true,
    updatedAt: Timestamp.now(),
  })
  console.log('✅ settings/reglement_interieur créé (version 1.0, active: true)')
  console.log('   Les employés verront maintenant la bannière "Charte à signer".')
}
