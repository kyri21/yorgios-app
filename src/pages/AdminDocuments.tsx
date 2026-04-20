import { useEffect, useRef, useState } from 'react'
import { Timestamp, addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, updateDoc } from 'firebase/firestore'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { db, storage, auth, functions } from '../firebase/config'
import { useToast } from '../hooks/useToast'
import { httpsCallable } from 'firebase/functions'

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

export default function AdminDocuments() {
  const { show } = useToast()
  const [tab, setTab] = useState<'gmao' | 'creta'>('gmao')

  // ── GMAO state ──
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

  // ── CRETA GEL state ──
  const [cretaDocs, setCretaDocs] = useState<CretaGelDoc[]>([])
  const [loadingCreta, setLoadingCreta] = useState(false)
  const [cretaLabel, setCretaLabel] = useState('')
  const [cretaDate, setCretaDate] = useState(todayISO())
  const [cretaFile, setCretaFile] = useState<File | null>(null)
  const [savingCreta, setSavingCreta] = useState(false)
  const cretaFileRef = useRef<HTMLInputElement>(null)

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
      )}
    </div>
  )
}
