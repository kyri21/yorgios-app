import { useState, useEffect, useRef } from 'react'
import { doc, getDoc, updateDoc, setDoc, Timestamp, getDocs, collection, addDoc, deleteDoc, orderBy, query, where } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { httpsCallable } from 'firebase/functions'
import { db, storage, auth, functions } from '../firebase/config'
import { useAuth } from '../auth/useAuth'
import { useToast } from '../hooks/useToast'

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

// ── GMAO types & constants ──
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
  'en cours':   'rgba(180,83,9,0.15)',
  'en attente': 'rgba(0,66,117,0.10)',
  'terminé':    'rgba(45,122,79,0.12)',
}
const STATUT_TEXT: Record<string, string> = {
  'en cours':   '#b45309',
  'en attente': 'var(--primary)',
  'terminé':    'var(--success)',
}

function todayISO() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

type Tab = 'charte' | 'livret' | 'admin_charte' | 'admin_livret' | 'signatures' | 'gmao' | 'creta' | 'mes_docs' | 'admin_docs'

type DocASigner = {
  id: string; title: string; type: 'text' | 'pdf'
  content?: string; fileUrl?: string; version: string
  targetUids: string[]; active: boolean; createdAt: Timestamp
  signatures: Record<string, { signedAt: Timestamp; version: string }>
}
type UserRow = { uid: string; displayName: string; email: string; role: string }

const ROLE_LABELS: Record<string, string> = { corner: 'Corner', cuisine: 'Cuisine', manager: 'Manager' }
const ROLE_ORDER = ['corner', 'cuisine', 'manager']

/* ── Parser charte texte → React nodes ── */
function parseParagraphInline(line: string): React.ReactNode {
  const m = line.match(/^([^:]{2,45})\s*:\s*(.+)$/)
  if (m) return <><strong style={{ fontWeight: 700, color: 'var(--on-surface)' }}>{m[1]}</strong>{' : '}{m[2]}</>
  return line
}

function renderCharteContent(text: string): React.ReactNode[] {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let k = 0
  let bullets: string[] = []
  let metaLines: string[] = []
  let pastFirstSep = false

  function flushBullets() {
    if (!bullets.length) return
    nodes.push(
      <ul key={k++} style={{ margin: '4px 0 14px 0', padding: 0, listStyle: 'none' }}>
        {bullets.map((b, j) => (
          <li key={j} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '3px 0', fontFamily: 'Manrope, sans-serif', fontSize: 13, color: 'var(--on-surface)', lineHeight: 1.65 }}>
            <span style={{ color: '#004275', fontWeight: 900, fontSize: 18, lineHeight: 1.1, flexShrink: 0, marginTop: 1 }}>·</span>
            <span>{parseParagraphInline(b)}</span>
          </li>
        ))}
      </ul>
    )
    bullets = []
  }

  function flushMeta() {
    if (!metaLines.length) return
    nodes.push(
      <div key={k++} style={{ background: 'var(--surface-low)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {metaLines.map((ml, j) => (
          <div key={j} style={{ fontFamily: 'Manrope, sans-serif', fontSize: 12, color: 'var(--on-surface-2)', lineHeight: 1.5 }}>
            {parseParagraphInline(ml)}
          </div>
        ))}
      </div>
    )
    metaLines = []
  }

  for (const raw of lines) {
    const line = raw.trim()

    if (line.startsWith('Charte interne')) continue

    if (line === '---') {
      flushBullets()
      flushMeta()
      pastFirstSep = true
      nodes.push(<div key={k++} style={{ borderTop: '1.5px solid var(--border-soft)', margin: '18px 0' }} />)
      continue
    }

    if (!pastFirstSep && (line.startsWith('Version') || line.startsWith('Responsable'))) {
      flushBullets()
      metaLines.push(line)
      continue
    }

    if (!line) {
      flushBullets()
      nodes.push(<div key={k++} style={{ height: 6 }} />)
      continue
    }

    if (/^\d+\.\d+\s/.test(line)) {
      flushBullets()
      nodes.push(
        <div key={k++} style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 13.5, color: 'var(--primary)', marginTop: 16, marginBottom: 6, paddingLeft: 14, borderLeft: '3px solid rgba(0,66,117,0.25)' }}>
          {line}
        </div>
      )
      continue
    }

    const secMatch = line.match(/^(\d+)\.\s(.+)$/)
    if (secMatch && secMatch[2] === secMatch[2].toUpperCase()) {
      flushBullets()
      nodes.push(
        <div key={k++} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 22, marginBottom: 10 }}>
          <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#004275', color: '#fff', fontFamily: 'Epilogue, sans-serif', fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {secMatch[1]}
          </span>
          <span style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 800, fontSize: 15, color: 'var(--on-surface)', letterSpacing: '-0.01em' }}>
            {secMatch[2]}
          </span>
        </div>
      )
      continue
    }

    if (line.startsWith('- ')) {
      bullets.push(line.slice(2))
      continue
    }

    if (/^\d+\.\s/.test(line)) {
      flushBullets()
      nodes.push(
        <p key={k++} style={{ margin: '3px 0', fontFamily: 'Manrope, sans-serif', fontSize: 13, color: 'var(--on-surface)', lineHeight: 1.7, paddingLeft: 2 }}>
          {parseParagraphInline(line)}
        </p>
      )
      continue
    }

    flushBullets()
    nodes.push(
      <p key={k++} style={{ margin: '0 0 9px 0', fontFamily: 'Manrope, sans-serif', fontSize: 13, color: 'var(--on-surface)', lineHeight: 1.75 }}>
        {parseParagraphInline(line)}
      </p>
    )
  }

  flushBullets()
  flushMeta()
  return nodes
}

export default function Documents() {
  const { user } = useAuth()
  const { show } = useToast()
  const isAdmin     = user && ['patron', 'administrateur'].includes(user.role)
  const isSuperUser = user && ['patron', 'administrateur', 'manager'].includes(user.role)
  const isIpadCorner = user?.email === 'ipad@yorgios.fr'
  const canGmao     = isSuperUser || isIpadCorner

  // ── Tabs ──
  const [tab, setTab] = useState<Tab>('charte')

  // ── Charte state ──
  const [charteContent, setCharteContent] = useState('')
  const [charteVersion, setCharteVersion] = useState('1.0')
  const [charteActive, setCharteActive] = useState(true)
  const [togglingCharte, setTogglingCharte] = useState(false)
  const [signedVersion, setSignedVersion] = useState<string | null>(null)
  const [signedAt, setSignedAt] = useState<Date | null>(null)
  const [scrolledToBottom, setScrolledToBottom] = useState(false)
  const [signName, setSignName] = useState('')
  const [signing, setSigning] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  // ── Livret state ──
  const [livretUrl, setLivretUrl] = useState<string | null>(null)

  // ── Admin charte/livret state ──
  const [adminCharteText, setAdminCharteText] = useState('')
  const [adminCharteVersion, setAdminCharteVersion] = useState('1.0')
  const [savingCharte, setSavingCharte] = useState(false)
  const [livretFile, setLivretFile] = useState<File | null>(null)
  const [uploadingLivret, setUploadingLivret] = useState(false)
  const livretFileRef = useRef<HTMLInputElement>(null)

  // ── Signatures state ──
  const [signatures, setSignatures] = useState<{ name: string; email: string; version: string; signedAt: Date }[]>([])
  const [loadingSigs, setLoadingSigs] = useState(false)

  // ── Documents à signer (module générique) ──
  const [myDocs, setMyDocs]                       = useState<DocASigner[]>([])
  const [allDocs, setAllDocs]                     = useState<DocASigner[]>([])
  const [viewingDoc, setViewingDoc]               = useState<DocASigner | null>(null)
  const [docAccepted, setDocAccepted]             = useState(false)
  const [signingDoc, setSigningDoc]               = useState(false)
  // Admin — create form
  const [allUsers, setAllUsers]                   = useState<UserRow[]>([])
  const [newDocTitle, setNewDocTitle]             = useState('')
  const [newDocType, setNewDocType]               = useState<'text' | 'pdf'>('pdf')
  const [newDocContent, setNewDocContent]         = useState('')
  const [newDocVersion, setNewDocVersion]         = useState('1.0')
  const [newDocTargetUids, setNewDocTargetUids]   = useState<string[]>([])
  const [newDocFile, setNewDocFile]               = useState<File | null>(null)
  const [savingNewDoc, setSavingNewDoc]           = useState(false)
  const [showNewDocForm, setShowNewDocForm]       = useState(false)
  const newDocFileRef = useRef<HTMLInputElement>(null)

  // ── GMAO state ──
  const [demandes, setDemandes] = useState<GmaoDemande[]>([])
  const [loadingDemandes, setLoadingDemandes] = useState(false)
  const [gmaoLoaded, setGmaoLoaded] = useState(false)
  const [gmaoFilterStatut, setGmaoFilterStatut] = useState<string>('tous')
  const [gmaoFilterFrom, setGmaoFilterFrom] = useState('')
  const [gmaoFilterTo, setGmaoFilterTo] = useState('')
  const [showGmaoForm, setShowGmaoForm] = useState(false)
  const [gmaoMotif, setGmaoMotif] = useState('')
  const [gmaoDept, setGmaoDept] = useState(DEPARTEMENTS[0])
  const [gmaoDate, setGmaoDate] = useState(todayISO())
  const [gmaoNumero, setGmaoNumero] = useState('')
  const [gmaoPhoto, setGmaoPhoto] = useState<File | null>(null)
  const [gmaoPhotoPreview, setGmaoPhotoPreview] = useState<string | null>(null)
  const [savingGmao, setSavingGmao] = useState(false)
  const [sendingChristelle, setSendingChristelle] = useState<string | null>(null)
  const [previewDemande, setPreviewDemande] = useState<GmaoDemande | null>(null)
  const [emailBody, setEmailBody] = useState('')
  const gmaoPhotoRef = useRef<HTMLInputElement>(null)

  // ── CRETA GEL state ──
  const [cretaDocs, setCretaDocs] = useState<CretaGelDoc[]>([])
  const [loadingCreta, setLoadingCreta] = useState(false)
  const [cretaLoaded, setCretaLoaded] = useState(false)
  const [cretaFilterFrom, setCretaFilterFrom] = useState('')
  const [cretaFilterTo, setCretaFilterTo] = useState('')
  const [cretaLabel, setCretaLabel] = useState('')
  const [cretaDate, setCretaDate] = useState(todayISO())
  const [cretaFile, setCretaFile] = useState<File | null>(null)
  const [savingCreta, setSavingCreta] = useState(false)
  const cretaFileRef = useRef<HTMLInputElement>(null)

  // ── Load charte + livret + user signature on mount ──
  useEffect(() => {
    async function load() {
      try {
        const charteSnap = await getDoc(doc(db, 'settings', 'reglement_interieur'))
        if (charteSnap.exists()) {
          const d = charteSnap.data()
          setCharteContent(d.content || DEFAULT_CHARTE)
          setCharteVersion(d.version || '1.0')
          setCharteActive(d.active !== false)
          setAdminCharteText(d.content || DEFAULT_CHARTE)
          setAdminCharteVersion(d.version || '1.0')
        } else {
          setCharteContent(DEFAULT_CHARTE)
          setAdminCharteText(DEFAULT_CHARTE)
        }
        const rhSnap = await getDoc(doc(db, 'settings', 'documents_rh'))
        if (rhSnap.exists()) setLivretUrl(rhSnap.data().livretUrl || null)

        if (user?.uid) {
          const userSnap = await getDoc(doc(db, 'users', user.uid))
          if (userSnap.exists()) {
            const d = userSnap.data()
            if (d.reglementSigned) {
              setSignedVersion(d.reglementSigned.version)
              setSignedAt(d.reglementSigned.signedAt?.toDate?.() || null)
            }
          }
        }
      } catch { /* silent */ }
    }
    load()
  }, [user?.uid])

  // Charger les docs au mount pour le badge dans le tab
  useEffect(() => {
    if (!user?.uid) return
    loadMyDocs()
  }, [user?.uid])

  async function loadMyDocs() {
    if (!user?.uid) return
    try {
      const snap = await getDocs(query(collection(db, 'documents_a_signer'), orderBy('createdAt', 'desc')))
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as DocASigner))
      setMyDocs(all.filter(d => d.active && d.targetUids?.includes(user!.uid)))
      if (isSuperUser) setAllDocs(all)
    } catch {}
  }

  async function loadUsersForTargeting() {
    try {
      const snap = await getDocs(collection(db, 'users'))
      const rows: UserRow[] = snap.docs
        .map(d => {
          const data = d.data() as any
          return { uid: d.id, displayName: data.displayName || data.email || d.id, email: data.email || '', role: data.role || '' }
        })
        .filter(u => u.role && u.email !== 'planning@yorgios.fr' && !['ipad@yorgios.fr', 'ipad.cuisine@yorgios.fr'].includes(u.email))
      setAllUsers(rows)
    } catch {}
  }

  async function handleSignDoc() {
    if (!user?.uid || !viewingDoc) return
    setSigningDoc(true)
    try {
      await updateDoc(doc(db, 'documents_a_signer', viewingDoc.id), {
        [`signatures.${user.uid}`]: { signedAt: Timestamp.now(), version: viewingDoc.version },
      })
      setMyDocs(prev => prev.map(d => d.id === viewingDoc.id
        ? { ...d, signatures: { ...d.signatures, [user!.uid]: { signedAt: Timestamp.now() as Timestamp, version: d.version } } }
        : d
      ))
      setViewingDoc(prev => prev ? { ...prev, signatures: { ...prev.signatures, [user!.uid]: { signedAt: Timestamp.now() as Timestamp, version: prev.version } } } : null)
      setDocAccepted(false)
      show('Document signé — merci !', 'success')
    } catch { show('Erreur lors de la signature', 'error') }
    finally { setSigningDoc(false) }
  }

  async function createNewDoc() {
    if (!newDocTitle.trim() || newDocTargetUids.length === 0) return
    if (newDocType === 'pdf' && !newDocFile) return
    setSavingNewDoc(true)
    try {
      let fileUrl: string | undefined
      if (newDocType === 'pdf' && newDocFile) {
        const path = `documents_a_signer/${Date.now()}_${newDocFile.name}`
        const sRef = storageRef(storage, path)
        await uploadBytes(sRef, newDocFile)
        fileUrl = await getDownloadURL(sRef)
      }
      await addDoc(collection(db, 'documents_a_signer'), {
        title: newDocTitle.trim(), type: newDocType, version: newDocVersion,
        ...(newDocType === 'pdf' ? { fileUrl } : { content: newDocContent }),
        targetUids: newDocTargetUids, active: true, createdAt: Timestamp.now(), signatures: {},
      })
      setNewDocTitle(''); setNewDocType('pdf'); setNewDocContent('')
      setNewDocVersion('1.0'); setNewDocTargetUids([]); setNewDocFile(null); setShowNewDocForm(false)
      show('Document créé — les destinataires verront la notification', 'success')
      loadMyDocs()
    } catch { show('Erreur lors de la création', 'error') }
    finally { setSavingNewDoc(false) }
  }

  async function toggleDocActive(d: DocASigner) {
    try {
      await updateDoc(doc(db, 'documents_a_signer', d.id), { active: !d.active })
      setAllDocs(prev => prev.map(x => x.id === d.id ? { ...x, active: !x.active } : x))
      setMyDocs(prev => !d.active ? prev : prev.filter(x => x.id !== d.id))
    } catch { show('Erreur', 'error') }
  }

  async function deleteDocASigner(d: DocASigner) {
    if (!confirm(`Supprimer "${d.title}" ?`)) return
    try {
      await deleteDoc(doc(db, 'documents_a_signer', d.id))
      setAllDocs(prev => prev.filter(x => x.id !== d.id))
      setMyDocs(prev => prev.filter(x => x.id !== d.id))
      show('Document supprimé', 'success')
    } catch { show('Erreur lors de la suppression', 'error') }
  }

  function handleScroll() {
    const el = contentRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) setScrolledToBottom(true)
  }

  async function handleSign() {
    if (!user?.uid || !signName.trim()) return
    setSigning(true)
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        reglementSigned: {
          version: charteVersion,
          signedAt: Timestamp.now(),
          signedName: signName.trim(),
        },
      })
      setSignedVersion(charteVersion)
      setSignedAt(new Date())
      show('Charte signée — merci !', 'success')
    } catch { show('Erreur lors de la signature', 'error') }
    finally { setSigning(false) }
  }

  async function saveCharte() {
    setSavingCharte(true)
    try {
      await setDoc(doc(db, 'settings', 'reglement_interieur'), {
        content: adminCharteText,
        version: adminCharteVersion,
        updatedAt: Timestamp.now(),
      }, { merge: true })
      setCharteContent(adminCharteText)
      setCharteVersion(adminCharteVersion)
      show('Charte mise à jour — les employés devront re-signer', 'success')
    } catch { show('Erreur lors de la sauvegarde', 'error') }
    finally { setSavingCharte(false) }
  }

  async function toggleCharteActive(value: boolean) {
    setTogglingCharte(true)
    try {
      await setDoc(doc(db, 'settings', 'reglement_interieur'), {
        active: value,
      }, { merge: true })
      setCharteActive(value)
      show(value ? 'Charte activée — les employés doivent signer' : 'Charte désactivée — aucune signature demandée', 'success')
    } catch { show('Erreur lors de la mise à jour', 'error') }
    finally { setTogglingCharte(false) }
  }

  async function uploadLivret() {
    if (!livretFile) return
    setUploadingLivret(true)
    try {
      const path = `documents_rh/livret_yorgios_${Date.now()}.pdf`
      const sRef = storageRef(storage, path)
      await uploadBytes(sRef, livretFile)
      const url = await getDownloadURL(sRef)
      await setDoc(doc(db, 'settings', 'documents_rh'), {
        livretUrl: url,
        livretUpdatedAt: Timestamp.now(),
      }, { merge: true })
      setLivretUrl(url)
      setLivretFile(null)
      show('Livret mis à jour avec succès', 'success')
    } catch { show('Erreur lors de l\'import', 'error') }
    finally { setUploadingLivret(false) }
  }

  async function loadSignatures() {
    setLoadingSigs(true)
    try {
      const snap = await getDocs(collection(db, 'users'))
      const sigs = snap.docs
        .map(d => ({ uid: d.id, ...d.data() } as any))
        .filter(u => u.reglementSigned)
        .map(u => ({
          name: u.displayName || u.email || u.uid,
          email: u.email || '',
          version: u.reglementSigned.version,
          signedAt: u.reglementSigned.signedAt?.toDate?.() || new Date(0),
        }))
        .sort((a, b) => b.signedAt.getTime() - a.signedAt.getTime())
      setSignatures(sigs)
    } catch { /* silent */ }
    finally { setLoadingSigs(false) }
  }

  // ── GMAO functions ──
  async function loadDemandes() {
    setLoadingDemandes(true)
    try {
      const snap = await getDocs(query(collection(db, 'gmao_demandes'), orderBy('createdAt', 'desc')))
      setDemandes(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as GmaoDemande[])
      setGmaoLoaded(true)
    } catch { /* silent */ }
    finally { setLoadingDemandes(false) }
  }

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

  function buildEmailTemplate(demande: GmaoDemande): string {
    const dateStr = demande.date
      ? new Date(demande.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
      : demande.date
    return `Bonjour Christelle,\n\nNotre demande GMAO : ${demande.motif}\nn'a pas évolué depuis le ${dateStr}.\nAs-tu des nouvelles ?\n\nMerci`
  }

  function openPreview(demande: GmaoDemande) {
    setEmailBody(buildEmailTemplate(demande))
    setPreviewDemande(demande)
  }

  async function confirmSendToChristelle(demande: GmaoDemande) {
    setSendingChristelle(demande.id)
    setPreviewDemande(null)
    try {
      const fn = httpsCallable(functions, 'sendGmaoEmail')
      await fn({ demandeId: demande.id, to: 'cvandaele@la-grande-epicerie.fr', customBody: emailBody })
      show('Email envoyé à Christelle ✓')
    } catch (e: any) { show(e?.message || 'Erreur envoi email', 'error') }
    finally { setSendingChristelle(null) }
  }

  // ── CRETA GEL functions ──
  async function loadCretaDocs() {
    setLoadingCreta(true)
    try {
      const snap = await getDocs(query(collection(db, 'creta_gel_docs'), orderBy('createdAt', 'desc')))
      setCretaDocs(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as CretaGelDoc[])
      setCretaLoaded(true)
    } catch { /* silent */ }
    finally { setLoadingCreta(false) }
  }

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

  function handleTabChange(key: Tab) {
    setTab(key)
    if (key === 'signatures') loadSignatures()
    if (key === 'gmao' && !gmaoLoaded) loadDemandes()
    if (key === 'creta' && !cretaLoaded) loadCretaDocs()
    if (key === 'mes_docs') { loadMyDocs(); setViewingDoc(null) }
    if (key === 'admin_docs') { loadMyDocs(); if (allUsers.length === 0) loadUsersForTargeting() }
  }

  const demandesFiltrees = demandes.filter(d => {
    if (gmaoFilterStatut !== 'tous' && d.statut !== gmaoFilterStatut) return false
    if (gmaoFilterFrom && d.date < gmaoFilterFrom) return false
    if (gmaoFilterTo && d.date > gmaoFilterTo) return false
    return true
  })

  const cretaDocsFiltres = cretaDocs.filter(d => {
    if (cretaFilterFrom && d.date < cretaFilterFrom) return false
    if (cretaFilterTo && d.date > cretaFilterTo) return false
    return true
  })

  const alreadySigned = signedVersion === charteVersion
  const fmtDate = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

  const pendingMyDocs = myDocs.filter(d => !d.signatures?.[user?.uid || ''] || d.signatures[user!.uid]?.version !== d.version)
  const signedMyDocs  = myDocs.filter(d =>  d.signatures?.[user?.uid || '']?.version === d.version)

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'charte', label: '📋 Charte' },
    { key: 'livret', label: '📖 Livret' },
    ...(myDocs.length > 0 ? [{ key: 'mes_docs' as Tab, label: '📝 À signer', badge: pendingMyDocs.length || undefined }] : []),
    ...(isSuperUser ? [
      { key: 'admin_charte' as Tab, label: '✏️ Modifier charte' },
      { key: 'admin_livret' as Tab, label: '⬆️ Livret PDF' },
      { key: 'admin_docs' as Tab, label: '📄 Gérer docs' },
      { key: 'signatures' as Tab, label: '✅ Signatures' },
    ] : []),
    ...(canGmao ? [
      { key: 'gmao' as Tab, label: '🔧 GMAO' },
      { key: 'creta' as Tab, label: '🧊 CRETA GEL' },
    ] : []),
  ]

  return (
    <div className="page">
      <div style={{ marginBottom: 4 }}>
        <p className="section-label" style={{ marginBottom: 2 }}>Documents</p>
        <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 26, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>
          Documents Yorgios
        </h1>
      </div>

      {/* Onglets */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--surface-mid)', borderRadius: 14, flexWrap: 'wrap' }}>
        {tabs.map(({ key, label, badge }) => (
          <button
            key={key}
            onClick={() => handleTabChange(key)}
            style={{
              flex: 1, minWidth: 100, padding: '9px 4px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: tab === key ? 'var(--surface)' : 'transparent',
              color: tab === key ? 'var(--primary)' : 'var(--on-surface-3)',
              fontWeight: 700, fontFamily: 'Manrope, sans-serif', fontSize: 13,
              boxShadow: tab === key ? '0 1px 6px rgba(28,28,24,0.08)' : 'none',
              position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            }}
          >
            {label}
            {badge != null && badge > 0 && (
              <span style={{ background: '#b45309', color: '#fff', borderRadius: 99, fontSize: 10, fontWeight: 700, padding: '1px 5px', fontFamily: 'Manrope, sans-serif' }}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Charte ── */}
      {tab === 'charte' && (
        <div>
          {!charteActive ? (
            <div>
              <div style={{ fontFamily: 'Epilogue', fontWeight: 700, fontSize: 17, color: 'var(--on-surface)', marginBottom: 6 }}>
                Charte interne & règles de fonctionnement
              </div>
              <div style={{ background: 'rgba(90,90,85,0.07)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: 'var(--on-surface-2)', fontFamily: 'Manrope' }}>
                La charte est actuellement en cours de révision. Aucune signature n'est requise pour le moment.
              </div>
              <div
                style={{
                  background: 'white', border: '1px solid var(--border)', borderRadius: 12,
                  padding: '22px 24px', maxHeight: 460, overflowY: 'auto',
                }}
              >
                {renderCharteContent(charteContent)}
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <div style={{ fontFamily: 'Epilogue', fontWeight: 700, fontSize: 17, color: 'var(--on-surface)' }}>
                    Charte interne & règles de fonctionnement
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--on-surface-3)', fontFamily: 'Manrope' }}>Version {charteVersion}</div>
                </div>
                {alreadySigned
                  ? <span className="chip-ok" style={{ fontSize: 12 }}>✓ Signée</span>
                  : <span className="chip-warn" style={{ fontSize: 12 }}>À signer</span>
                }
              </div>

              {alreadySigned && signedAt && (
                <div style={{ background: 'rgba(45,122,79,0.08)', border: '1px solid rgba(45,122,79,0.25)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 16 }}>✓</span>
                  <div style={{ fontSize: 13, color: 'var(--success)', fontFamily: 'Manrope', fontWeight: 600 }}>
                    Signé le {fmtDate(signedAt)}
                  </div>
                </div>
              )}

              {!alreadySigned && (
                <div style={{ background: 'rgba(180,83,9,0.08)', border: '1px solid rgba(180,83,9,0.25)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: 'var(--warning)', fontFamily: 'Manrope', fontWeight: 600 }}>
                  Veuillez lire la charte jusqu'en bas, puis signer.
                </div>
              )}

              <div
                ref={contentRef}
                onScroll={handleScroll}
                style={{
                  background: 'white', border: '1px solid var(--border)', borderRadius: 12,
                  padding: '22px 24px', maxHeight: 460, overflowY: 'auto',
                  marginBottom: 16,
                }}
              >
                {renderCharteContent(charteContent)}
              </div>

              {!alreadySigned && scrolledToBottom && (
                <div className="card" style={{ padding: 18 }}>
                  <div style={{ fontWeight: 600, fontFamily: 'Manrope', fontSize: 14, color: 'var(--on-surface)', marginBottom: 12 }}>
                    Signature électronique
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--on-surface-2)', fontFamily: 'Manrope', marginBottom: 14 }}>
                    En signant, vous certifiez avoir lu et compris ce document dans son intégralité et vous engagez à le respecter.
                  </p>
                  <input
                    className="input"
                    style={{ marginBottom: 12 }}
                    placeholder="Votre prénom et nom complet"
                    value={signName}
                    onChange={e => setSignName(e.target.value)}
                  />
                  <button
                    className="btn-primary"
                    style={{ width: '100%' }}
                    disabled={!signName.trim() || signing}
                    onClick={handleSign}
                  >
                    {signing ? 'Signature en cours…' : 'Je certifie avoir lu et j\'accepte cette charte'}
                  </button>
                </div>
              )}

              {!alreadySigned && !scrolledToBottom && (
                <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--on-surface-3)', fontFamily: 'Manrope', padding: '8px 0' }}>
                  Faites défiler le document jusqu'en bas pour pouvoir signer.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Livret ── */}
      {tab === 'livret' && (
        <div>
          <div style={{ fontFamily: 'Epilogue', fontWeight: 700, fontSize: 17, color: 'var(--on-surface)', marginBottom: 14 }}>
            Livret d'accueil Yorgios
          </div>
          {livretUrl ? (
            <>
              <iframe
                src={livretUrl}
                style={{ width: '100%', height: 'calc(100vh - 220px)', minHeight: 400, border: '1px solid var(--border)', borderRadius: 12 }}
                title="Livret d'accueil Yorgios"
              />
              <div style={{ marginTop: 10, textAlign: 'center' }}>
                <a href={livretUrl} target="_blank" rel="noreferrer" className="btn-secondary" style={{ display: 'inline-block', fontSize: 13 }}>
                  Ouvrir dans un nouvel onglet
                </a>
              </div>
            </>
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--on-surface-2)' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
              <div style={{ fontFamily: 'Manrope', fontSize: 15 }}>
                Le livret d'accueil n'est pas encore importé.
                {isSuperUser && <><br /><span style={{ fontSize: 13 }}>Utilisez l'onglet "Livret PDF" pour l'importer.</span></>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Admin — Modifier charte ── */}
      {tab === 'admin_charte' && isSuperUser && (
        <div>
          <div style={{ fontFamily: 'Epilogue', fontWeight: 700, fontSize: 17, color: 'var(--on-surface)', marginBottom: 6 }}>
            Modifier la charte interne
          </div>
          <p style={{ fontSize: 13, color: 'var(--on-surface-2)', fontFamily: 'Manrope', marginBottom: 16 }}>
            Modifiez le texte puis incrémentez la version. Tous les employés devront re-signer la nouvelle version.
          </p>

          {/* ── Toggle activation charte ── */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: charteActive ? 'rgba(0,66,117,0.06)' : 'rgba(90,90,85,0.07)',
            border: `1.5px solid ${charteActive ? 'rgba(0,66,117,0.2)' : 'var(--border)'}`,
            borderRadius: 12, padding: '14px 16px', marginBottom: 20,
          }}>
            <div>
              <div style={{ fontFamily: 'Manrope', fontWeight: 700, fontSize: 14, color: 'var(--on-surface)', marginBottom: 2 }}>
                Soumettre la charte à signature
              </div>
              <div style={{ fontFamily: 'Manrope', fontSize: 12, color: 'var(--on-surface-2)' }}>
                {charteActive
                  ? 'Activée — les employés voient le formulaire de signature et reçoivent les notifications.'
                  : 'Désactivée — aucune notification, aucune demande de signature.'}
              </div>
            </div>
            <button
              disabled={togglingCharte}
              onClick={() => toggleCharteActive(!charteActive)}
              style={{
                flexShrink: 0, marginLeft: 16,
                width: 52, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer',
                background: charteActive ? 'var(--primary)' : '#ccc',
                position: 'relative', transition: 'background 0.2s',
                opacity: togglingCharte ? 0.6 : 1,
              }}
              aria-label={charteActive ? 'Désactiver la charte' : 'Activer la charte'}
            >
              <span style={{
                position: 'absolute', top: 3, left: charteActive ? 26 : 3,
                width: 22, height: 22, borderRadius: '50%', background: 'white',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s',
              }} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontFamily: 'Manrope', color: 'var(--on-surface-2)', flexShrink: 0 }}>Version :</label>
            <input
              className="input"
              style={{ maxWidth: 120 }}
              value={adminCharteVersion}
              onChange={e => setAdminCharteVersion(e.target.value)}
              placeholder="ex: 1.1"
            />
          </div>
          <textarea
            style={{
              width: '100%', minHeight: 480, padding: '14px 16px', borderRadius: 12,
              border: '1px solid var(--border)', fontFamily: 'Manrope, sans-serif', fontSize: 13,
              lineHeight: 1.7, resize: 'vertical', color: 'var(--on-surface)',
              background: 'white', boxSizing: 'border-box',
            }}
            value={adminCharteText}
            onChange={e => setAdminCharteText(e.target.value)}
          />
          <button
            className="btn-primary"
            style={{ marginTop: 12, width: '100%' }}
            disabled={savingCharte || !adminCharteText.trim()}
            onClick={saveCharte}
          >
            {savingCharte ? 'Sauvegarde…' : 'Sauvegarder et publier'}
          </button>
        </div>
      )}

      {/* ── Admin — Mettre à jour livret ── */}
      {tab === 'admin_livret' && isSuperUser && (
        <div>
          <div style={{ fontFamily: 'Epilogue', fontWeight: 700, fontSize: 17, color: 'var(--on-surface)', marginBottom: 6 }}>
            Mettre à jour le livret d'accueil
          </div>
          <p style={{ fontSize: 13, color: 'var(--on-surface-2)', fontFamily: 'Manrope', marginBottom: 16 }}>
            Importez un nouveau fichier PDF. L'ancien livret sera remplacé automatiquement — aucun code à modifier.
          </p>
          {livretUrl && (
            <div style={{ background: 'rgba(45,122,79,0.08)', border: '1px solid rgba(45,122,79,0.25)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: 'var(--success)', fontFamily: 'Manrope', fontWeight: 600 }}>
              ✓ Un livret est déjà en ligne.
            </div>
          )}
          <input
            type="file"
            accept=".pdf"
            ref={livretFileRef}
            style={{ display: 'none' }}
            onChange={e => setLivretFile(e.target.files?.[0] || null)}
          />
          <div
            onClick={() => livretFileRef.current?.click()}
            style={{
              border: '2px dashed var(--border)', borderRadius: 12, padding: '32px 16px',
              textAlign: 'center', cursor: 'pointer', marginBottom: 16,
              background: livretFile ? 'rgba(0,66,117,0.04)' : 'white',
            }}
          >
            {livretFile ? (
              <div style={{ fontFamily: 'Manrope', fontSize: 14, color: 'var(--primary)', fontWeight: 600 }}>
                📄 {livretFile.name}
              </div>
            ) : (
              <div style={{ fontFamily: 'Manrope', fontSize: 14, color: 'var(--on-surface-3)' }}>
                Cliquez pour sélectionner un PDF
              </div>
            )}
          </div>
          <button
            className="btn-primary"
            style={{ width: '100%' }}
            disabled={!livretFile || uploadingLivret}
            onClick={uploadLivret}
          >
            {uploadingLivret ? 'Import en cours…' : 'Importer le livret'}
          </button>
        </div>
      )}

      {/* ── Admin — Signatures ── */}
      {tab === 'signatures' && isSuperUser && (
        <div>
          <div style={{ fontFamily: 'Epilogue', fontWeight: 700, fontSize: 17, color: 'var(--on-surface)', marginBottom: 6 }}>
            Signatures de la charte (version {charteVersion})
          </div>
          {loadingSigs ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>
          ) : signatures.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--on-surface-3)', fontFamily: 'Manrope', fontSize: 14 }}>
              Aucune signature enregistrée pour la version {charteVersion}.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {signatures.map((s, i) => (
                <div key={i} className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontFamily: 'Manrope', fontSize: 14, color: 'var(--on-surface)' }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--on-surface-3)', fontFamily: 'Manrope' }}>{s.email}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: 'var(--success)', fontFamily: 'Manrope', fontWeight: 600 }}>v{s.version}</div>
                    <div style={{ fontSize: 11, color: 'var(--on-surface-3)', fontFamily: 'Manrope' }}>{fmtDate(s.signedAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── GMAO ── */}
      {tab === 'gmao' && canGmao && (
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
              <div style={{ marginBottom: 12 }}>
                <p className="section-label" style={{ marginBottom: 5 }}>Département</p>
                <select className="input-filled" value={gmaoDept} onChange={e => setGmaoDept(e.target.value)}>
                  {DEPARTEMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <select
              value={gmaoFilterStatut}
              onChange={e => setGmaoFilterStatut(e.target.value)}
              className="input-filled"
              style={{ fontSize: 13 }}
            >
              <option value="tous">Tous les statuts</option>
              <option value="en cours">En cours</option>
              <option value="en attente">En attente</option>
              <option value="terminé">Terminé</option>
            </select>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <p className="section-label" style={{ marginBottom: 4 }}>Du</p>
                <input type="date" className="input-filled" value={gmaoFilterFrom}
                  onChange={e => setGmaoFilterFrom(e.target.value)} style={{ fontSize: 13 }} />
              </div>
              <div>
                <p className="section-label" style={{ marginBottom: 4 }}>Au</p>
                <input type="date" className="input-filled" value={gmaoFilterTo}
                  onChange={e => setGmaoFilterTo(e.target.value)} style={{ fontSize: 13 }} />
              </div>
            </div>
            {(gmaoFilterStatut !== 'tous' || gmaoFilterFrom || gmaoFilterTo) && (
              <button
                onClick={() => { setGmaoFilterStatut('tous'); setGmaoFilterFrom(''); setGmaoFilterTo('') }}
                style={{ fontSize: 12, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
              >
                ✕ Effacer les filtres ({demandesFiltrees.length}/{demandes.length})
              </button>
            )}
          </div>

          {loadingDemandes ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          ) : demandesFiltrees.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '44px 20px' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🔧</div>
              <p style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 16, color: 'var(--on-surface)', margin: '0 0 6px' }}>
                {demandes.length === 0 ? 'Aucune demande GMAO' : 'Aucun résultat pour ces filtres'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {demandesFiltrees.map(d => (
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
                    <span style={{
                      flexShrink: 0, fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99,
                      background: STATUT_COLORS[d.statut] ?? 'var(--surface-mid)',
                      color: STATUT_TEXT[d.statut] ?? 'var(--on-surface-3)',
                      whiteSpace: 'nowrap',
                    }}>
                      {d.statut}
                    </span>
                  </div>
                  {d.photoUrl && (
                    <a href={d.photoUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block', marginBottom: 10 }}>
                      <img src={d.photoUrl} alt="doc" style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 8, objectFit: 'cover' }} />
                    </a>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                    {d.statut !== 'terminé' && (
                      <button
                        onClick={() => openPreview(d)}
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
                    <button
                      onClick={() => deleteDemande(d.id)}
                      style={{
                        fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8,
                        border: '1px solid rgba(192,57,43,0.2)', background: 'rgba(192,57,43,0.06)',
                        color: 'var(--danger)', cursor: 'pointer', fontFamily: 'Manrope, sans-serif',
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
      {tab === 'creta' && canGmao && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <p className="section-label" style={{ marginBottom: 4 }}>Du</p>
              <input type="date" className="input-filled" value={cretaFilterFrom}
                onChange={e => setCretaFilterFrom(e.target.value)} style={{ fontSize: 13 }} />
            </div>
            <div>
              <p className="section-label" style={{ marginBottom: 4 }}>Au</p>
              <input type="date" className="input-filled" value={cretaFilterTo}
                onChange={e => setCretaFilterTo(e.target.value)} style={{ fontSize: 13 }} />
            </div>
          </div>
          {(cretaFilterFrom || cretaFilterTo) && (
            <button
              onClick={() => { setCretaFilterFrom(''); setCretaFilterTo('') }}
              style={{ fontSize: 12, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
            >
              ✕ Effacer ({cretaDocsFiltres.length}/{cretaDocs.length})
            </button>
          )}

          {loadingCreta ? (
            <div style={{ textAlign: 'center', padding: '30px 0' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          ) : cretaDocsFiltres.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🧊</div>
              <p style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: 15, color: 'var(--on-surface)', margin: 0 }}>
                {cretaDocs.length === 0 ? 'Aucun document CRETA GEL' : 'Aucun résultat pour ces filtres'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {cretaDocsFiltres.map(d => (
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
      )}

      {/* ── Modal preview email Christelle ── */}
      {previewDemande && (
        <>
          <div
            onClick={() => setPreviewDemande(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(28,28,24,0.5)', zIndex: 300, backdropFilter: 'blur(4px)' }}
          />
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 301,
            background: '#fff', borderRadius: '20px 20px 0 0',
            padding: '24px 20px 32px',
            boxShadow: '0 -8px 32px rgba(28,28,24,0.15)',
            maxHeight: '80vh', overflowY: 'auto',
          }}>
            <p style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 800, fontSize: 16, color: 'var(--on-surface)', margin: '0 0 4px' }}>
              Email à Christelle
            </p>
            <p style={{ fontSize: 12, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif', margin: '0 0 4px' }}>
              À : <b>cvandaele@la-grande-epicerie.fr</b>
            </p>
            <p style={{ fontSize: 12, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif', margin: '0 0 14px' }}>
              Objet : <b>[GMAO] {previewDemande.departement} — YORGIOS</b>
            </p>
            <textarea
              value={emailBody}
              onChange={e => setEmailBody(e.target.value)}
              rows={8}
              className="input-filled"
              style={{ resize: 'vertical', fontFamily: 'Manrope, sans-serif', fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setPreviewDemande(null)} className="btn-secondary" style={{ flex: 1 }}>
                Annuler
              </button>
              <button
                onClick={() => confirmSendToChristelle(previewDemande)}
                disabled={!!sendingChristelle}
                className="btn-primary"
                style={{ flex: 1 }}
              >
                {sendingChristelle ? '⏳ Envoi…' : '📧 Envoyer'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Mes documents à signer ── */}
      {tab === 'mes_docs' && (
        <div>
          {viewingDoc ? (
            <div>
              <button onClick={() => { setViewingDoc(null); setDocAccepted(false) }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontFamily: 'Manrope', fontSize: 13, fontWeight: 700, padding: '0 0 14px' }}>
                ← Retour
              </button>
              <div style={{ fontFamily: 'Epilogue', fontWeight: 700, fontSize: 17, color: 'var(--on-surface)', marginBottom: 4 }}>{viewingDoc.title}</div>
              <div style={{ fontSize: 12, color: 'var(--on-surface-3)', fontFamily: 'Manrope', marginBottom: 14 }}>Version {viewingDoc.version}</div>
              {viewingDoc.type === 'pdf' && viewingDoc.fileUrl ? (
                <>
                  <iframe src={viewingDoc.fileUrl} style={{ width: '100%', height: 'calc(100vh - 320px)', minHeight: 340, border: '1px solid var(--border)', borderRadius: 12, marginBottom: 10 }} title={viewingDoc.title} />
                  <a href={viewingDoc.fileUrl} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', fontSize: 12, color: 'var(--primary)', marginBottom: 16, fontFamily: 'Manrope' }}>Ouvrir dans un nouvel onglet ↗</a>
                </>
              ) : (
                <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: '22px 24px', maxHeight: 420, overflowY: 'auto', marginBottom: 16 }}>
                  {renderCharteContent(viewingDoc.content || '')}
                </div>
              )}
              {viewingDoc.signatures?.[user?.uid || '']?.version === viewingDoc.version ? (
                <div style={{ background: 'rgba(45,122,79,0.08)', border: '1px solid rgba(45,122,79,0.25)', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span>✓</span>
                  <span style={{ fontSize: 13, color: 'var(--success)', fontFamily: 'Manrope', fontWeight: 600 }}>Signé le {fmtDate(viewingDoc.signatures[user!.uid].signedAt.toDate())}</span>
                </div>
              ) : (
                <div className="card" style={{ padding: 18 }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', marginBottom: 14 }}>
                    <input type="checkbox" checked={docAccepted} onChange={e => setDocAccepted(e.target.checked)} style={{ marginTop: 2, width: 18, height: 18, flexShrink: 0, accentColor: 'var(--primary)' }} />
                    <span style={{ fontSize: 13, fontFamily: 'Manrope', color: 'var(--on-surface)', lineHeight: 1.5 }}>J'ai lu et j'accepte ce document dans son intégralité.</span>
                  </label>
                  <button className="btn-primary" style={{ width: '100%', opacity: (!docAccepted || signingDoc) ? 0.5 : 1 }} disabled={!docAccepted || signingDoc} onClick={handleSignDoc}>
                    {signingDoc ? 'Signature en cours…' : 'Signer ce document'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div>
              {pendingMyDocs.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <p className="section-label" style={{ marginBottom: 10, color: 'var(--warning)' }}>EN ATTENTE ({pendingMyDocs.length})</p>
                  {pendingMyDocs.map(d => (
                    <button key={d.id} onClick={() => { setViewingDoc(d); setDocAccepted(false) }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(180,83,9,0.06)', border: '1.5px solid rgba(180,83,9,0.2)', borderRadius: 12, padding: '14px 16px', cursor: 'pointer', textAlign: 'left', width: '100%', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontFamily: 'Manrope', fontSize: 14, color: 'var(--on-surface)', marginBottom: 2 }}>{d.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--on-surface-3)', fontFamily: 'Manrope' }}>{d.type === 'pdf' ? '📄 PDF' : '📝 Texte'} · v{d.version}</div>
                      </div>
                      <span style={{ fontFamily: 'Manrope', fontSize: 12, fontWeight: 700, color: '#b45309', background: 'rgba(180,83,9,0.1)', borderRadius: 8, padding: '5px 10px', flexShrink: 0, marginLeft: 12 }}>À signer →</span>
                    </button>
                  ))}
                </div>
              )}
              {signedMyDocs.length > 0 && (
                <div>
                  <p className="section-label" style={{ marginBottom: 10, color: 'var(--success)' }}>SIGNÉS ({signedMyDocs.length})</p>
                  {signedMyDocs.map(d => (
                    <button key={d.id} onClick={() => { setViewingDoc(d); setDocAccepted(false) }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(45,122,79,0.05)', border: '1.5px solid rgba(45,122,79,0.15)', borderRadius: 12, padding: '14px 16px', cursor: 'pointer', textAlign: 'left', width: '100%', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontFamily: 'Manrope', fontSize: 14, color: 'var(--on-surface)', marginBottom: 2 }}>{d.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--on-surface-3)', fontFamily: 'Manrope' }}>{d.type === 'pdf' ? '📄 PDF' : '📝 Texte'} · v{d.version}</div>
                      </div>
                      <span className="chip-ok" style={{ fontSize: 11, flexShrink: 0, marginLeft: 12 }}>✓ Signé</span>
                    </button>
                  ))}
                </div>
              )}
              {myDocs.length === 0 && (
                <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--on-surface-2)', fontFamily: 'Manrope', fontSize: 14 }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>Aucun document à signer pour le moment.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Admin — Gérer docs à signer ── */}
      {tab === 'admin_docs' && isSuperUser && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontFamily: 'Epilogue', fontWeight: 700, fontSize: 17, color: 'var(--on-surface)' }}>Documents à signer</div>
            <button onClick={() => setShowNewDocForm(v => !v)} className={showNewDocForm ? 'btn-secondary' : 'btn-primary'} style={{ width: 'auto', padding: '9px 16px', fontSize: 13 }}>
              {showNewDocForm ? 'Annuler' : '+ Nouveau'}
            </button>
          </div>

          {showNewDocForm && (
            <div className="card" style={{ marginBottom: 20 }}>
              <p className="section-label" style={{ marginBottom: 14 }}>NOUVEAU DOCUMENT</p>
              <label className="section-label" style={{ marginBottom: 4 }}>TITRE</label>
              <input className="input" style={{ marginBottom: 14 }} placeholder="Ex : Barème primes 2026" value={newDocTitle} onChange={e => setNewDocTitle(e.target.value)} />
              <label className="section-label" style={{ marginBottom: 8 }}>TYPE</label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {(['pdf', 'text'] as const).map(t => (
                  <button key={t} onClick={() => setNewDocType(t)} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: `1.5px solid ${newDocType === t ? 'var(--primary)' : 'var(--border)'}`, background: newDocType === t ? 'rgba(0,66,117,0.08)' : 'var(--surface-low)', color: newDocType === t ? 'var(--primary)' : 'var(--on-surface-2)', fontWeight: 700, fontFamily: 'Manrope', fontSize: 13, cursor: 'pointer' }}>
                    {t === 'pdf' ? '📄 PDF' : '📝 Texte'}
                  </button>
                ))}
              </div>
              {newDocType === 'pdf' ? (
                <>
                  <input type="file" accept=".pdf" ref={newDocFileRef} style={{ display: 'none' }} onChange={e => setNewDocFile(e.target.files?.[0] || null)} />
                  <div onClick={() => newDocFileRef.current?.click()} style={{ border: '2px dashed var(--border)', borderRadius: 12, padding: '28px 16px', textAlign: 'center', cursor: 'pointer', marginBottom: 14, background: newDocFile ? 'rgba(0,66,117,0.04)' : 'white' }}>
                    {newDocFile ? <><span style={{ fontSize: 20 }}>📄</span><div style={{ fontSize: 13, fontFamily: 'Manrope', color: 'var(--primary)', fontWeight: 600, marginTop: 6 }}>{newDocFile.name}</div></> : <><span style={{ fontSize: 28 }}>📎</span><div style={{ fontSize: 13, fontFamily: 'Manrope', color: 'var(--on-surface-3)', marginTop: 6 }}>Cliquer pour choisir un PDF</div></>}
                  </div>
                </>
              ) : (
                <textarea style={{ width: '100%', minHeight: 180, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', fontFamily: 'Manrope', fontSize: 13, lineHeight: 1.7, resize: 'vertical', color: 'var(--on-surface)', background: 'white', boxSizing: 'border-box', marginBottom: 14 }} placeholder="Contenu du document…" value={newDocContent} onChange={e => setNewDocContent(e.target.value)} />
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
                <label style={{ fontSize: 13, fontFamily: 'Manrope', color: 'var(--on-surface-2)', flexShrink: 0 }}>Version :</label>
                <input className="input" style={{ maxWidth: 100 }} value={newDocVersion} onChange={e => setNewDocVersion(e.target.value)} placeholder="1.0" />
              </div>
              <label className="section-label" style={{ marginBottom: 10 }}>DESTINATAIRES</label>
              {ROLE_ORDER.map(role => {
                const roleUsers = allUsers.filter(u => u.role === role)
                if (roleUsers.length === 0) return null
                const allChecked = roleUsers.every(u => newDocTargetUids.includes(u.uid))
                return (
                  <div key={role} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--primary)', fontFamily: 'Manrope', textTransform: 'uppercase' }}>{ROLE_LABELS[role]}</span>
                      <button onClick={() => setNewDocTargetUids(prev => allChecked ? prev.filter(id => !roleUsers.map(u => u.uid).includes(id)) : [...new Set([...prev, ...roleUsers.map(u => u.uid)])])} style={{ fontSize: 11, fontFamily: 'Manrope', fontWeight: 600, color: 'var(--primary)', background: 'rgba(0,66,117,0.07)', border: 'none', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>
                        {allChecked ? 'Tout décocher' : 'Tout cocher'}
                      </button>
                    </div>
                    {roleUsers.map(u => (
                      <label key={u.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: newDocTargetUids.includes(u.uid) ? 'rgba(0,66,117,0.06)' : 'var(--surface-low)', borderRadius: 8, cursor: 'pointer', border: `1px solid ${newDocTargetUids.includes(u.uid) ? 'rgba(0,66,117,0.2)' : 'var(--border-soft)'}`, marginBottom: 6 }}>
                        <input type="checkbox" checked={newDocTargetUids.includes(u.uid)} onChange={e => setNewDocTargetUids(prev => e.target.checked ? [...prev, u.uid] : prev.filter(id => id !== u.uid))} style={{ width: 16, height: 16, accentColor: 'var(--primary)', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'Manrope', color: 'var(--on-surface)' }}>{u.displayName}</div>
                          <div style={{ fontSize: 11, color: 'var(--on-surface-3)', fontFamily: 'Manrope', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                )
              })}
              {newDocTargetUids.length > 0 && <div style={{ fontSize: 12, color: 'var(--primary)', fontFamily: 'Manrope', fontWeight: 600, marginBottom: 12 }}>{newDocTargetUids.length} destinataire{newDocTargetUids.length > 1 ? 's' : ''} sélectionné{newDocTargetUids.length > 1 ? 's' : ''}</div>}
              <button className="btn-primary" style={{ width: '100%', opacity: (!newDocTitle.trim() || newDocTargetUids.length === 0 || (newDocType === 'pdf' && !newDocFile)) ? 0.5 : 1 }} disabled={savingNewDoc || !newDocTitle.trim() || newDocTargetUids.length === 0 || (newDocType === 'pdf' && !newDocFile)} onClick={createNewDoc}>
                {savingNewDoc ? 'Création…' : `Créer et envoyer à ${newDocTargetUids.length} personne${newDocTargetUids.length > 1 ? 's' : ''}`}
              </button>
            </div>
          )}

          {allDocs.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--on-surface-2)', fontFamily: 'Manrope' }}>Aucun document créé.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {allDocs.map(d => {
                const nbSigned = Object.values(d.signatures || {}).filter(s => s.version === d.version).length
                return (
                  <div key={d.id} style={{ background: 'var(--surface-low)', border: '1px solid var(--border-soft)', borderRadius: 12, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontFamily: 'Manrope', fontSize: 14, color: 'var(--on-surface)', marginBottom: 3 }}>{d.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--on-surface-3)', fontFamily: 'Manrope' }}>{d.type === 'pdf' ? '📄 PDF' : '📝 Texte'} · v{d.version} · {nbSigned}/{d.targetUids?.length || 0} signatures</div>
                      </div>
                      <button onClick={() => toggleDocActive(d)} style={{ flexShrink: 0, width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', background: d.active ? 'var(--primary)' : '#ccc', position: 'relative', transition: 'background 0.2s' }}>
                        <span style={{ position: 'absolute', top: 2, left: d.active ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s' }} />
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <span style={{ fontSize: 11, fontFamily: 'Manrope', padding: '3px 8px', borderRadius: 6, background: d.active ? 'rgba(45,122,79,0.1)' : 'rgba(90,90,85,0.1)', color: d.active ? 'var(--success)' : 'var(--on-surface-3)', fontWeight: 600 }}>{d.active ? 'Actif' : 'Inactif'}</span>
                      <button onClick={() => deleteDocASigner(d)} style={{ fontSize: 11, fontFamily: 'Manrope', padding: '3px 8px', borderRadius: 6, background: 'rgba(192,57,43,0.08)', color: 'var(--danger)', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Supprimer</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

    </div>
  )
}
