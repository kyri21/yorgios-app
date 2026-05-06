import { lazy, Suspense, useMemo, useState, useEffect } from "react";
import ActionCorrectiveModal, { type AcPayload } from '../../../components/ActionCorrectiveModal'
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

import { db, storage, PHOTO_MODE } from "../firebase/firebase";
import { auth } from "../../../firebase/config";
import {
  computeDecisionV1,
  photoIsRequired,
  TEMP_RULES_V1,
  type HaccpCategory,
} from "../lib/haccpRules";

const BarcodeScanner = lazy(() => import('../../../components/BarcodeScanner'))

type Produit = {
  id: string;
  name: string;
  defaultCategory?: HaccpCategory;
  active?: boolean;
  allergenes?: string[];
};

const CATEGORIES: { value: HaccpCategory; label: string }[] = [
  { value: "VIANDE", label: "Viande" },
  { value: "VIANDE_HACHEE", label: "Viande hachée" },
  { value: "POISSON", label: "Poisson" },
  { value: "LAITIER", label: "Lait / laitier" },
  { value: "PLAT_CUISINE", label: "Plat cuisiné" },
  { value: "LEGUMES", label: "Légumes" },
  { value: "AUTRE", label: "Autre" },
];

function nowLocalDatetimeValue() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function todayLabel() {
  const d = new Date();
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`Timeout (${label}) après ${ms}ms`)),
      ms
    );
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

async function compressImageToJpegBytes(
  file: File,
  maxWidth = 1280,
  quality = 0.6
): Promise<Uint8Array> {
  if (!file.type.startsWith("image/")) throw new Error("Le fichier n'est pas une image.");

  const imgUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = imgUrl;

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Impossible de charger l'image (format non supporté ?)"));
    });

    const ratio = img.width > maxWidth ? maxWidth / img.width : 1;
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas non supporté");

    ctx.drawImage(img, 0, 0, w, h);

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Compression échouée (toBlob null)"))),
        "image/jpeg",
        quality
      );
    });

    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}

type ReceptionHisto = {
  id: string
  fournisseur: string
  receivedAt: Timestamp
  productName: string
  temperatureC: number
  decision: 'ACCEPTE' | 'REFUSE' | 'A_VERIFIER'
  photoUrl: string | null
  supplierLot: string | null
  category: string
}

function pad(n: number) { return String(n).padStart(2, '0') }
function formatDate(ts: Timestamp): string {
  const d = ts.toDate()
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function Reception() {
  const [tab, setTab] = useState<'saisie' | 'historique'>('saisie')
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false)

  // Historique
  const [histoList, setHistoList] = useState<ReceptionHisto[]>([])
  const [histoLoading, setHistoLoading] = useState(false)
  const [modalPhoto, setModalPhoto] = useState<string | null>(null)

  const [produits, setProduits] = useState<Produit[]>([]);
  const [produitsLoaded, setProduitsLoaded] = useState(false);
  const [fournisseurs, setFournisseurs] = useState<string[]>(['Foodflow']);

  useEffect(() => {
    getDocs(query(collection(db, 'produits'), where('inReception', '==', true)))
      .then(snap => {
        let list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Produit[]
        list = list.filter(p => p.active !== false)
        if (list.length === 0) {
          return getDocs(collection(db, 'produits')).then(all => {
            const full = all.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Produit[]
            return full.filter(p => p.active !== false)
          })
        }
        return list
      })
      .then(list => {
        list.sort((a, b) => a.name.localeCompare(b.name))
        setProduits(list)
      })
      .catch(() => {})
      .finally(() => setProduitsLoaded(true))

    getDoc(doc(db, 'settings', 'reception'))
      .then(snap => {
        if (snap.exists()) {
          const list = (snap.data() as any).fournisseurs as string[]
          if (Array.isArray(list) && list.length > 0) {
            setFournisseurs(list)
            setFournisseur(list[0])
          }
        }
      })
      .catch(() => {})
  }, []);

  function loadHistorique() {
    setHistoLoading(true)
    getDocs(query(collection(db, 'receptions'), orderBy('receivedAt', 'desc')))
      .then(snap => setHistoList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ReceptionHisto[]))
      .catch(() => {})
      .finally(() => setHistoLoading(false))
  }

  useEffect(() => {
    if (tab === 'historique' && histoList.length === 0) loadHistorique()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const [fournisseur, setFournisseur] = useState("Foodflow");
  const [fournisseurAutre, setFournisseurAutre] = useState("");
  const [receivedAt, setReceivedAt] = useState(nowLocalDatetimeValue());

  const [productId, setProductId] = useState<string>("");
  const [productNameFree, setProductNameFree] = useState<string>("");

  const [category, setCategory] = useState<HaccpCategory>("AUTRE");
  const [supplierLot, setSupplierLot] = useState("");
  const [useByDate, setUseByDate] = useState<string>("");
  const [temperatureC, setTemperatureC] = useState<string>("");

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const [commentaire, setCommentaire] = useState("");
  const [lastPhotoUrl, setLastPhotoUrl] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false)
  const [pendingAcPayload, setPendingAcPayload] = useState<AcPayload | null>(null)
  const [acModalOpen, setAcModalOpen] = useState(false)

  useEffect(() => {
    if (!photoFile) {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoFile]);

  const selectedProduit = useMemo(() => {
    return produits.find((p) => p.id === productId) || null;
  }, [produits, productId]);

  useEffect(() => {
    if (selectedProduit?.defaultCategory) setCategory(selectedProduit.defaultCategory);
  }, [selectedProduit]);

  const computed = useMemo(() => {
    const t = Number(temperatureC);
    const maxC = TEMP_RULES_V1[category]?.maxC ?? null;
    if (!Number.isFinite(t)) return { decision: "A_VERIFIER" as const, maxC };
    return { decision: computeDecisionV1(category, t), maxC };
  }, [category, temperatureC]);

  const photoRequired = photoIsRequired(category);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLastPhotoUrl(null);
    setSavedOk(false);
    setPendingAcPayload(null);

    const productName = selectedProduit?.name || productNameFree.trim();
    const t = Number(temperatureC);

    if (fournisseur === 'Autre' && !fournisseurAutre.trim()) return setError("Précisez le fournisseur.");
    if (!fournisseur.trim()) return setError("Fournisseur obligatoire.");
    if (!receivedAt) return setError("Date/heure de réception obligatoire.");
    if (!productName) return setError("Produit obligatoire (liste ou texte libre).");
    if (!Number.isFinite(t)) return setError("Température invalide.");
    if (photoRequired && !photoFile) return setError("Photo obligatoire pour Viande / Viande hachée.");

    setLoading(true);

    try {
      const user = auth.currentUser
      if (!user) throw new Error('Non authentifié')

      const docRef = doc(collection(db, "receptions"));

      let photoUrl: string | null = null;
      let photoPath: string | null = null;

      if (photoFile) {
        if (PHOTO_MODE !== "STORAGE") {
          throw new Error(`Mode photo actuel = ${PHOTO_MODE}. Mets VITE_PHOTO_MODE=STORAGE puis redémarre.`);
        }

        if (photoFile.size > 10 * 1024 * 1024) {
          throw new Error("Photo trop lourde (>10MB). Reprends une photo plus légère.");
        }

        setStatus("Compression photo…");
        const bytes = await withTimeout(
          compressImageToJpegBytes(photoFile, 1280, 0.6),
          30000,
          "compression"
        );

        setStatus("Upload photo (Storage)…");
        photoPath = `receptions/${user.uid}/${docRef.id}.jpg`;
        const sref = storageRef(storage, photoPath);

        await withTimeout(
          uploadBytes(sref, bytes, { contentType: "image/jpeg" }),
          60000,
          "uploadBytes"
        );

        photoUrl = await withTimeout(getDownloadURL(sref), 30000, "getDownloadURL");
        setLastPhotoUrl(photoUrl);
      }

      setStatus("Écriture Firestore…");
      const payload = {
        fournisseur: fournisseur === 'Autre' ? fournisseurAutre.trim() : fournisseur.trim(),
        receivedAt: Timestamp.fromDate(new Date(receivedAt)),
        productId: selectedProduit?.id ?? null,
        productName,
        category,
        supplierLot: supplierLot.trim() || null,
        useByDate: useByDate ? Timestamp.fromDate(new Date(`${useByDate}T00:00:00`)) : null,
        temperatureC: t,
        photoUrl,
        photoPath,
        decision: computeDecisionV1(category, t),
        ruleCode: "TEMP_V1",
        commentaire: commentaire.trim() || null,
        createdAt: Timestamp.now(),
        createdBy: user.uid,
      };

      await withTimeout(setDoc(docRef, payload), 60000, "setDoc receptions");

      setStatus("");
      setFournisseur(fournisseurs[0] || "Foodflow");
      setFournisseurAutre("");
      setReceivedAt(nowLocalDatetimeValue());
      setProductId("");
      setProductNameFree("");
      setCategory("AUTRE");
      setSupplierLot("");
      setUseByDate("");
      setTemperatureC("");
      setPhotoFile(null);
      setCommentaire("");

      setSavedOk(true);
      const resolvedFournisseur = fournisseur === 'Autre' ? fournisseurAutre.trim() : fournisseur.trim();
      const savedDecision = computeDecisionV1(category, t);
      if (savedDecision !== 'ACCEPTE') {
        setPendingAcPayload({
          type: 'temperature_reception',
          date: receivedAt.split('T')[0],
          refId: docRef.id,
          productName,
          fournisseur: resolvedFournisseur,
          category,
          tempC: t,
          decision: savedDecision,
          problem: `Température hors norme à la réception — ${productName} (${resolvedFournisseur}) : ${t}°C — Décision : ${savedDecision}`,
        });
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Erreur lors de l'enregistrement.");
    } finally {
      setLoading(false);
      setStatus("");
    }
  }

  /* ── Styles helpers ── */
  const sectionLabel: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--on-surface-3)',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    display: 'block',
    marginBottom: 10,
  };

  const fieldGroup: React.CSSProperties = {
    marginBottom: 20,
  };

  const underlineInput: React.CSSProperties = {
    width: '100%',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid var(--border)',
    borderRadius: 0,
    padding: '10px 2px',
    fontSize: 15,
    color: 'var(--on-surface)',
    fontFamily: 'Manrope, sans-serif',
    outline: 'none',
    transition: 'border-color 0.2s ease',
  };

  const underlineSelect: React.CSSProperties = {
    ...underlineInput,
    cursor: 'pointer',
    appearance: 'none',
    WebkitAppearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239a9a94' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 4px center',
    paddingRight: 28,
  };

  const fournisseurPill = (f: string): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '44px',
    padding: '0 16px',
    borderRadius: 99,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: 'Manrope, sans-serif',
    cursor: 'pointer',
    border: 'none',
    transition: 'background 0.15s ease, color 0.15s ease',
    background: fournisseur === f ? 'var(--primary)' : 'var(--surface-mid)',
    color: fournisseur === f ? '#fff' : 'var(--on-surface-2)',
  });

  const productRow = (id: string): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 14px',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    transition: 'background 0.12s ease',
    background: productId === id ? 'rgba(0,66,117,0.07)' : 'transparent',
    borderLeft: productId === id ? '3px solid var(--primary)' : '3px solid transparent',
  });

  /* ── HACCP result banner ── */
  function haccpBanner() {
    if (computed.decision === 'ACCEPTE') {
      return {
        bg: 'rgba(84,101,30,0.07)',
        borderColor: 'rgba(84,101,30,0.18)',
        dotColor: 'var(--success)',
        label: 'CONFORME',
        chipClass: 'chip-ok',
      };
    }
    if (computed.decision === 'REFUSE') {
      return {
        bg: 'rgba(136,0,20,0.06)',
        borderColor: 'rgba(136,0,20,0.18)',
        dotColor: 'var(--danger)',
        label: 'NON CONFORME',
        chipClass: 'chip-danger',
      };
    }
    return {
      bg: 'rgba(180,83,9,0.05)',
      borderColor: 'rgba(180,83,9,0.16)',
      dotColor: 'var(--warning)',
      label: 'À VÉRIFIER',
      chipClass: 'chip-warn',
    };
  }

  const banner = haccpBanner();

  return (
    <div className="page">

      {/* Scanner modal */}
      {showScanner && (
        <Suspense fallback={null}>
          <BarcodeScanner
            onScan={(val) => { setSupplierLot(val); setShowScanner(false) }}
            onClose={() => setShowScanner(false)}
          />
        </Suspense>
      )}

      {/* Modal photo plein écran */}
      {modalPhoto && (
        <div
          onClick={() => setModalPhoto(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 500,
            background: 'rgba(28,28,24,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '20px',
          }}
        >
          <img src={modalPhoto} alt="Photo réception"
            style={{ maxWidth: '100%', maxHeight: '90dvh', borderRadius: 12, objectFit: 'contain' }} />
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ marginBottom: 16 }}>
        <p className="section-label" style={{ marginBottom: 4 }}>Cuisine · HACCP</p>
        <h1 style={{
          fontFamily: 'Epilogue, sans-serif',
          fontSize: 26,
          fontWeight: 800,
          color: 'var(--on-surface)',
          letterSpacing: '-0.03em',
          margin: '0 0 4px',
        }}>
          Réception marchandises
        </h1>
        <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: 0, textTransform: 'capitalize' }}>
          {todayLabel()}
        </p>
      </div>

      {/* ── Onglets ── */}
      <div className="nav-tabs" style={{ marginBottom: 16 }}>
        {(['saisie', 'historique'] as const).map(t => (
          <button
            key={t}
            className={`nav-tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'saisie' ? 'Nouvelle réception' : 'Historique'}
          </button>
        ))}
      </div>

      {/* ── Onglet Historique ── */}
      {tab === 'historique' && (
        <div>
          {histoLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 90, borderRadius: 14 }} />)}
            </div>
          ) : histoList.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--on-surface-3)' }}>
              <p style={{ fontSize: 32, margin: '0 0 8px' }}>📦</p>
              <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Aucune réception enregistrée</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                type="button"
                onClick={loadHistorique}
                style={{
                  alignSelf: 'flex-end', background: 'var(--surface-mid)',
                  border: 'none', borderRadius: 8, padding: '6px 12px',
                  fontSize: 12, fontWeight: 600, color: 'var(--on-surface-2)', cursor: 'pointer',
                }}
              >
                ↺ Actualiser
              </button>
              {histoList.map(r => {
                const badge = r.decision === 'ACCEPTE'
                  ? { cls: 'chip-ok', label: 'Accepté' }
                  : r.decision === 'REFUSE'
                    ? { cls: 'chip-danger', label: 'Refusé' }
                    : { cls: 'chip-warn', label: 'À vérifier' }
                return (
                  <div key={r.id} className="card" style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      {/* Photo thumbnail */}
                      {r.photoUrl ? (
                        <img
                          src={r.photoUrl}
                          alt=""
                          onClick={() => setModalPhoto(r.photoUrl)}
                          style={{
                            width: 56, height: 56, borderRadius: 10,
                            objectFit: 'cover', flexShrink: 0, cursor: 'pointer',
                          }}
                        />
                      ) : (
                        <div style={{
                          width: 56, height: 56, borderRadius: 10, flexShrink: 0,
                          background: 'var(--surface-mid)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 22,
                        }}>📦</div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--on-surface)' }}>
                            {r.productName}
                          </span>
                          <span className={badge.cls} style={{ fontSize: 11 }}>{badge.label}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 3 }}>
                          {r.fournisseur} · {formatDate(r.receivedAt)}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--on-surface-2)', marginTop: 2, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          <span>🌡 {r.temperatureC}°C</span>
                          {r.supplierLot && <span>📦 {r.supplierLot}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Onglet Saisie ── */}
      {tab === 'saisie' && (<>

      {/* ── Résultat HACCP — mesure critique ── */}
      <div style={{
        background: banner.bg,
        borderRadius: 'var(--radius-lg)',
        padding: '16px 18px',
        outline: `1.5px solid ${banner.borderColor}`,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}>
        {/* Big temperature display */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}>
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--on-surface-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
          }}>
            Mesure critique
          </span>
          <span style={{
            fontFamily: 'Epilogue, sans-serif',
            fontSize: 48,
            fontWeight: 800,
            lineHeight: 1,
            color: computed.decision === 'ACCEPTE'
              ? 'var(--success)'
              : computed.decision === 'REFUSE'
                ? 'var(--danger)'
                : 'var(--warning)',
          }}>
            {temperatureC !== '' ? `${temperatureC}` : '—'}
            <span style={{ fontSize: 20, fontWeight: 600, marginLeft: 2 }}>°C</span>
          </span>
          {computed.maxC != null && (
            <span style={{ fontSize: 12, color: 'var(--on-surface-2)', fontWeight: 500 }}>
              Seuil V1 ≤ {computed.maxC}°C
            </span>
          )}
        </div>
        <div>
          <span className={banner.chipClass} style={{ fontSize: 13, padding: '6px 14px' }}>
            {banner.label}
          </span>
        </div>
      </div>

      {/* ── Formulaire ── */}
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* Section : Fournisseur */}
        <div className="card" style={{ padding: '18px 16px', marginBottom: 12 }}>
          <span style={sectionLabel}>Fournisseur *</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {fournisseurs.map(f => (
              <button
                key={f}
                type="button"
                style={fournisseurPill(f)}
                onClick={() => setFournisseur(f)}
              >
                {f}
              </button>
            ))}
            <button
              type="button"
              style={fournisseurPill('Autre')}
              onClick={() => setFournisseur('Autre')}
            >
              Autre…
            </button>
          </div>
          {fournisseur === 'Autre' && (
            <div style={{ marginTop: 12 }}>
              <input
                style={underlineInput}
                placeholder="Nom du fournisseur"
                value={fournisseurAutre}
                onChange={e => setFournisseurAutre(e.target.value)}
                onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--primary)')}
                onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--border)')}
              />
            </div>
          )}
        </div>

        {/* Section : Date & Heure */}
        <div className="card" style={{ padding: '18px 16px', marginBottom: 12 }}>
          <span style={sectionLabel}>Date &amp; heure de réception *</span>
          <input
            style={underlineInput}
            type="datetime-local"
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
            onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--primary)')}
            onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--border)')}
          />
        </div>

        {/* Section : Produit */}
        <div className="card" style={{ padding: '18px 16px', marginBottom: 12 }}>
          <span style={sectionLabel}>Produit *</span>

          {/* Liste produits scrollable */}
          {!produitsLoaded ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2, 3].map(i => (
                <div key={i} className="skeleton" style={{ height: 44, borderRadius: 'var(--radius-md)' }} />
              ))}
            </div>
          ) : produits.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: '8px 0' }}>
              Aucun produit configuré. Saisie manuelle ci-dessous.
            </p>
          ) : (
            <div style={{
              maxHeight: 240,
              overflowY: 'auto',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface-mid)',
              marginBottom: 12,
            }}>
              {produits.map((p) => (
                <div
                  key={p.id}
                  style={productRow(p.id)}
                  onClick={() => setProductId(productId === p.id ? '' : p.id)}
                >
                  <div style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: productId === p.id ? 'var(--primary)' : 'var(--border)',
                    transition: 'background 0.12s ease',
                  }} />
                  <span style={{
                    fontSize: 14,
                    fontWeight: productId === p.id ? 700 : 500,
                    color: productId === p.id ? 'var(--primary)' : 'var(--on-surface)',
                  }}>
                    {p.name}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={fieldGroup}>
            <span style={{ ...sectionLabel, fontSize: 10, marginBottom: 4 }}>Ou saisie manuelle</span>
            <input
              style={{
                ...underlineInput,
                opacity: productId ? 0.4 : 1,
              }}
              value={productNameFree}
              onChange={(e) => setProductNameFree(e.target.value)}
              disabled={!!productId}
              placeholder="Ex: Blanc de poulet, filets de bar…"
              onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--primary)')}
              onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--border)')}
            />
          </div>

          {/* Bloc allergènes */}
          {selectedProduit?.allergenes && selectedProduit.allergenes.length > 0 && (
            <div style={{
              background: 'rgba(180,83,9,0.06)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
              marginTop: 4,
            }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--warning)', margin: '0 0 8px' }}>
                ⚠️ Allergènes détectés
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {selectedProduit.allergenes.map(a => (
                  <span key={a} className="chip-warn" style={{ fontSize: 11 }}>{a}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Section : Catégorie + Température */}
        <div className="card" style={{ padding: '18px 16px', marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={fieldGroup}>
              <span style={sectionLabel}>Catégorie HACCP *</span>
              <select
                style={underlineSelect}
                value={category}
                onChange={(e) => setCategory(e.target.value as HaccpCategory)}
                onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--primary)')}
                onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--border)')}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <p style={{ fontSize: 11, color: 'var(--on-surface-3)', margin: '6px 0 0' }}>
                {photoRequired ? "📷 Photo requise" : "Photo optionnelle"}
              </p>
            </div>

            <div style={fieldGroup}>
              <span style={sectionLabel}>Température °C *</span>
              <input
                style={{
                  ...underlineInput,
                  fontSize: 24,
                  fontFamily: 'Epilogue, sans-serif',
                  fontWeight: 700,
                  color: computed.decision === 'ACCEPTE'
                    ? 'var(--success)'
                    : computed.decision === 'REFUSE'
                      ? 'var(--danger)'
                      : 'var(--on-surface)',
                }}
                type="number"
                step="0.1"
                value={temperatureC}
                onChange={(e) => setTemperatureC(e.target.value)}
                placeholder="0.0"
                onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--primary)')}
                onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--border)')}
              />
            </div>
          </div>
        </div>

        {/* Section : N° lot + DLC */}
        <div className="card" style={{ padding: '18px 16px', marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={fieldGroup}>
              <span style={sectionLabel}>N° lot fournisseur</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  style={{ ...underlineInput, flex: 1 }}
                  value={supplierLot}
                  onChange={(e) => setSupplierLot(e.target.value)}
                  placeholder="Ex: L2309-AP04"
                  onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--primary)')}
                  onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--border)')}
                />
                <button
                  type="button"
                  onClick={() => setShowScanner(true)}
                  title="Scanner le code-barres"
                  style={{
                    flexShrink: 0, width: 40, height: 40,
                    background: 'var(--surface-mid)', border: 'none',
                    borderRadius: 10, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20,
                  }}
                >
                  📷
                </button>
              </div>
            </div>

            <div style={fieldGroup}>
              <span style={sectionLabel}>DLC / DDM</span>
              <input
                style={underlineInput}
                type="date"
                value={useByDate}
                onChange={(e) => setUseByDate(e.target.value)}
                onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--primary)')}
                onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--border)')}
              />
            </div>
          </div>
        </div>

        {/* Section : Photo */}
        <div className="card" style={{ padding: '18px 16px', marginBottom: 12 }}>
          <span style={sectionLabel}>Photo {photoRequired ? "*" : "(optionnel)"}</span>

          {/* Upload zone */}
          <label style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 8,
            padding: '20px 16px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-mid)',
            cursor: 'pointer',
            minHeight: '80px',
          }}>
            <span style={{ fontSize: 28 }}>📷</span>
            <span style={{ fontSize: 13, color: 'var(--on-surface-2)', fontWeight: 600 }}>
              {photoFile ? photoFile.name : "Appuyer pour ajouter une photo"}
            </span>
            {photoFile && (
              <span style={{ fontSize: 11, color: 'var(--on-surface-3)' }}>
                {(photoFile.size / 1024).toFixed(0)} Ko
              </span>
            )}
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
            />
          </label>

          {photoPreview && (
            <div style={{ marginTop: 12 }}>
              <img
                src={photoPreview}
                alt="Aperçu"
                style={{ width: "100%", maxHeight: 240, objectFit: "cover", borderRadius: 'var(--radius-md)' }}
              />
            </div>
          )}

          {lastPhotoUrl && (
            <p style={{ fontSize: 12, color: 'var(--on-surface-3)', margin: '8px 0 0' }}>
              Photo uploadée :{" "}
              <a href={lastPhotoUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 600 }}>
                ouvrir
              </a>
            </p>
          )}
        </div>

        {/* Section : Commentaire */}
        <div className="card" style={{ padding: '18px 16px', marginBottom: 16 }}>
          <span style={sectionLabel}>Commentaire</span>
          <textarea
            style={{
              ...underlineInput,
              resize: 'vertical',
              minHeight: 64,
            }}
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
            placeholder="Observations, non-conformités éventuelles…"
            onFocus={e => (e.currentTarget.style.borderBottomColor = 'var(--primary)')}
            onBlur={e => (e.currentTarget.style.borderBottomColor = 'var(--border)')}
          />
        </div>

        {/* Status upload */}
        {status && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(0,66,117,0.05)',
            fontSize: 13,
            color: 'var(--primary)',
            fontWeight: 500,
            marginBottom: 12,
          }}>
            <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
            {status}
          </div>
        )}

        {/* Erreur */}
        {error && (
          <div style={{
            padding: '12px 14px',
            background: 'rgba(136,0,20,0.06)',
            borderRadius: 'var(--radius-md)',
            outline: '1.5px solid rgba(136,0,20,0.15)',
            fontSize: 13,
            color: 'var(--danger)',
            fontWeight: 500,
            marginBottom: 12,
          }}>
            {error}
          </div>
        )}

        {/* Bouton valider */}
        <button
          className="btn-primary"
          type="submit"
          disabled={loading}
          style={{ minHeight: '4rem', fontSize: 16, letterSpacing: '0.01em' }}
        >
          {loading ? (
            <>
              <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2, borderTopColor: 'rgba(255,255,255,0.6)' }} />
              Enregistrement…
            </>
          ) : (
            "Valider la réception"
          )}
        </button>

      </form>

      {savedOk && !pendingAcPayload && (
        <p style={{ textAlign: 'center', color: 'var(--success)', fontSize: 13, fontWeight: 700, margin: '8px 0 0' }}>
          ✅ Réception enregistrée avec succès
        </p>
      )}

      {pendingAcPayload && (
        <div style={{
          padding: '14px 16px', borderRadius: 12, marginTop: 8,
          background: 'rgba(180,83,9,0.07)', border: '1px solid rgba(180,83,9,0.2)',
        }}>
          <p style={{ fontWeight: 700, color: 'var(--warning)', fontSize: 13, margin: '0 0 6px', fontFamily: 'Epilogue, sans-serif' }}>
            📝 Réception enregistrée — action corrective requise
          </p>
          <p style={{ fontSize: 12, color: 'var(--on-surface-2)', margin: '0 0 10px', lineHeight: 1.4 }}>
            {pendingAcPayload.problem}
          </p>
          <button
            type="button"
            onClick={() => setAcModalOpen(true)}
            style={{
              padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700,
              border: '1px solid rgba(180,83,9,0.3)', background: 'rgba(180,83,9,0.1)',
              color: 'var(--warning)', cursor: 'pointer', fontFamily: 'Manrope, sans-serif',
            }}
          >
            Documenter l'action corrective
          </button>
        </div>
      )}
      </>)}

      {acModalOpen && pendingAcPayload && (
        <ActionCorrectiveModal
          payload={pendingAcPayload}
          createdByName={auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || ''}
          onClose={() => setAcModalOpen(false)}
          onSaved={() => { setAcModalOpen(false); setPendingAcPayload(null); }}
        />
      )}
    </div>
  );
}
