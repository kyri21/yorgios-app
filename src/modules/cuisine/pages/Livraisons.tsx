import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { db, storage, ensureAnonAuth } from "../firebase/firebase";

type Rule = { min: number; max: number; maxTol: number };

const RULES: Record<string, Rule> = {
  PLAT_CUISINE: { min: 0, max: 3, maxTol: 5 },
  LAIT: { min: 0, max: 4, maxTol: 6 },
  PATISSERIE: { min: 0, max: 3, maxTol: 5 },
  LEGUME: { min: 0, max: 8, maxTol: 10 },
  VIANDE: { min: 0, max: 3, maxTol: 5 },
  VIANDE_HACHEE: { min: 0, max: 2, maxTol: 3 },
  POISSON: { min: 0, max: 2, maxTol: 3 },
  AUTRE: { min: 0, max: 8, maxTol: 10 },
};

function canon(s: string) {
  return (s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const CATEGORY_ALIASES: Record<string, string> = {
  plats_cuisines: "PLAT_CUISINE",
  plat_cuisine: "PLAT_CUISINE",
  plat_cuisines: "PLAT_CUISINE",

  lait: "LAIT",
  laitier: "LAIT",
  laitiers: "LAIT",

  patisserie: "PATISSERIE",
  patisseries: "PATISSERIE",

  legume: "LEGUME",
  legumes: "LEGUME",

  viande: "VIANDE",
  viandes: "VIANDE",

  viande_hachee: "VIANDE_HACHEE",
  viandes_hachees: "VIANDE_HACHEE",

  poisson: "POISSON",
  poissons: "POISSON",
};

function normalizeCategoryKey(cat: string) {
  const k = canon(cat);
  return CATEGORY_ALIASES[k] ?? (cat || "").trim().toUpperCase();
}

function evaluateTemp(category: string, tempC: number) {
  const key = normalizeCategoryKey(category || "AUTRE");
  const rule = RULES[key];
  if (!rule || !Number.isFinite(tempC)) {
    return { result: "A_VERIFIER" as const, maxTol: null as number | null, rule: null as Rule | null };
  }
  return { result: tempC <= rule.maxTol ? ("ACCEPTE" as const) : ("REFUSE" as const), maxTol: rule.maxTol, rule };
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function ddmmyyyy(d: Date) {
  return `${pad2(d.getDate())}${pad2(d.getMonth() + 1)}${d.getFullYear()}`;
}
function hhmm(d: Date) {
  return `${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout (${label}) après ${ms}ms`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

async function uploadPhoto(file: File, path: string) {
  const r = ref(storage, path);
  await uploadBytes(r, file);
  const url = await getDownloadURL(r);
  return { url, path };
}

async function deletePhotoIfAny(path: string | null | undefined) {
  if (!path) return;
  try {
    await deleteObject(ref(storage, path));
  } catch {
    // si déjà supprimé ou pas accessible, on ne bloque pas la suppression Firestore
  }
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function parseMonthParam(month: string | null): { start: Date; end: Date; label: string } | null {
  if (!month) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mm) || mm < 1 || mm > 12) return null;

  const start = new Date(y, mm - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, mm, 1, 0, 0, 0, 0);
  const label = `${m[2]}/${m[1]}`;
  return { start, end, label };
}

type LotCuisine = {
  id: string;
  lotCode: string;
  productId: string;
  productName: string;
  category?: string;
  sent?: boolean;
};

type ManualLine = { id: number; productId: string; category: string; temp: string };

type Produit = {
  id: string;
  name: string;
  abrv?: string;
  defaultCategory?: string;
  gepCategory?: string;
  active?: boolean;
};

type LivrDoc = {
  id: string;

  lotId?: string | null;
  lotCode: string;

  productId: string | null;
  productName: string;
  category: string;

  departTempC: number;
  departAt: any;
  departBy: string;
  departPhotoUrl?: string | null;
  departPhotoPath?: string | null;

  receptionTempC?: number | null;
  receptionAt?: any;
  receptionBy?: string | null;
  receptionPhotoUrl?: string | null;
  receptionPhotoPath?: string | null;

  result: "ACCEPTE" | "REFUSE" | "A_VERIFIER";
  ruleMaxTol: number | null;

  isManual?: boolean;

  createdAt: any;
};

export default function Livraisons() {
  const [searchParams, setSearchParams] = useSearchParams();
  const monthParam = searchParams.get("month");
  const monthInfo = parseMonthParam(monthParam);
  const isControlView = !!monthInfo;

  const [mode, setMode] = useState<"CUISINE" | "CORNER">("CUISINE");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [lots, setLots] = useState<LotCuisine[]>([]);
  const [lotSelections, setLotSelections] = useState<Record<string, { selected: boolean; temp: string }>>({});

  const [produits, setProduits] = useState<Produit[]>([]);
  const [mercurialeGep, setMercurialeGep] = useState<Record<string, string>>({}); // name → gepCategory
  const [manualLines, setManualLines] = useState<ManualLine[]>([]);

  const [todayLivraisons, setTodayLivraisons] = useState<LivrDoc[]>([]);
  const [todayDepartOnly, setTodayDepartOnly] = useState<LivrDoc[]>([]);

  const [editId, setEditId] = useState<string | null>(null);
  const [editTemp, setEditTemp] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editPhoto, setEditPhoto] = useState<File | null>(null);

  const stats = useMemo(() => {
    const total = todayLivraisons.length;
    const pendingReception = todayLivraisons.filter((l) => l.receptionTempC == null).length;
    const refuse = todayLivraisons.filter((l) => l.result === "REFUSE").length;
    const accepte = todayLivraisons.filter((l) => l.result === "ACCEPTE").length;
    const aVerifier = todayLivraisons.filter((l) => l.result === "A_VERIFIER").length;
    return { total, pendingReception, refuse, accepte, aVerifier };
  }, [todayLivraisons]);

  async function loadLots() {
    // Charger uniquement les lots non archivés — les lots archived=true sont terminés (côté fabrication)
    const qLots = query(
      collection(db, "lots_cuisine"),
      where("archived", "==", false),
      orderBy("createdAt", "desc"),
      limit(120),
    );
    const snap = await withTimeout(getDocs(qLots), 20000, "load lots_cuisine");
    const list: LotCuisine[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    setLots(list);
  }

  async function loadProduits() {
    const snap = await withTimeout(getDocs(collection(db, "catalogue")), 20000, "load catalogue");
    const list: Produit[] = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((p) => p.active !== false)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'));
    setProduits(list);

    // Construire la map gepCategory depuis le catalogue (plus besoin de mercuriale séparée)
    const map: Record<string, string> = {}
    list.forEach(p => { if (p.name && p.gepCategory) map[p.name] = p.gepCategory })
    setMercurialeGep(map)
  }

  async function loadLivraisonsForView() {
    if (monthInfo) {
      const startTs = Timestamp.fromDate(monthInfo.start);
      const endTs = Timestamp.fromDate(monthInfo.end);

      const qLiv = query(
        collection(db, "livraisons"),
        where("departAt", ">=", startTs),
        where("departAt", "<", endTs),
        orderBy("departAt", "desc"),
        limit(2000)
      );

      const snap = await withTimeout(getDocs(qLiv), 25000, "load livraisons month");
      const list: LivrDoc[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

      setTodayLivraisons(list);
      setTodayDepartOnly(list);
      return;
    }

    const qLiv = query(collection(db, "livraisons"), orderBy("departAt", "desc"), limit(200));
    const snap = await withTimeout(getDocs(qLiv), 20000, "load livraisons today");
    const all: LivrDoc[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

    const t0 = startOfToday();
    const today = all.filter((x) => {
      const dt = x.departAt?.toDate ? x.departAt.toDate() : null;
      return dt && dt.getTime() >= t0;
    });

    setTodayLivraisons(today);
    setTodayDepartOnly(today);
  }

  useEffect(() => {
    (async () => {
      try {
        setError(null);
        setStatus("Connexion…");
        await withTimeout(ensureAnonAuth(), 30000, "auth");

        setStatus("Chargement…");
        if (!isControlView) {
          await Promise.all([loadLots(), loadProduits(), loadLivraisonsForView()]);
        } else {
          await loadLivraisonsForView();
        }
      } catch (e: any) {
        console.error(e);
        setError(e?.message || "Erreur");
      } finally {
        setStatus("");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthParam]);

  useEffect(() => {
    setLotSelections(prev => {
      const next: Record<string, { selected: boolean; temp: string }> = {}
      lots.filter(l => !l.sent).forEach(l => {
        next[l.id] = prev[l.id] || { selected: false, temp: '' }
      })
      return next
    })
  }, [lots])

  let _manualLineId = 0

  function addManualLine() {
    setManualLines(prev => [...prev, { id: ++_manualLineId, productId: '', category: 'PLAT_CUISINE', temp: '' }])
  }
  function removeManualLine(id: number) {
    setManualLines(prev => prev.filter(m => m.id !== id))
  }
  function updateManualLine(id: number, field: keyof ManualLine, value: string) {
    setManualLines(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m))
  }

  async function submitAll(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const availableLots = lots.filter(l => !l.sent)
    const selectedLots = availableLots.filter(l => lotSelections[l.id]?.selected)
    const validManualLines = manualLines.filter(m => m.productId.trim() !== '')

    if (selectedLots.length === 0 && validManualLines.length === 0) {
      return setError("Sélectionne au moins un lot ou ajoute une saisie manuelle.")
    }

    const totalItems = selectedLots.length + validManualLines.length
    const tempsCount = [
      ...selectedLots.filter(l => {
        const t = (lotSelections[l.id]?.temp || '').trim()
        return t !== '' && Number.isFinite(Number(t.replace(',', '.')))
      }),
      ...validManualLines.filter(m => {
        const t = m.temp.trim()
        return t !== '' && Number.isFinite(Number(t.replace(',', '.')))
      }),
    ].length
    const minTemps = Math.min(2, totalItems)
    if (tempsCount < minTemps) return setError(`Saisis au minimum ${minTemps} température(s) (${tempsCount}/${minTemps} actuellement).`)

    setLoading(true)
    try {
      setStatus("Connexion…")
      const user = await withTimeout(ensureAnonAuth(), 30000, "auth")

      for (const lot of selectedLots) {
        const tempStr = (lotSelections[lot.id]?.temp || '').trim()
        const t = tempStr !== '' ? Number(tempStr.replace(',', '.')) : null
        const category = normalizeCategoryKey(lot.category || "AUTRE")
        const evalRes = t !== null && Number.isFinite(t)
          ? evaluateTemp(category, t)
          : { result: "A_VERIFIER" as const, maxTol: null as number | null, rule: null }

        const livraisonRef = doc(db, "livraisons", lot.id)
        const existsSnap = await withTimeout(getDoc(livraisonRef), 20000, "check livraison exists")
        if (existsSnap.exists()) continue

        setStatus(`Envoi ${lot.productName}…`)
        await withTimeout(
          setDoc(livraisonRef, {
            lotId: lot.id,
            lotCode: lot.lotCode,
            productId: lot.productId,
            productName: lot.productName,
            category,
            departTempC: t,
            departAt: Timestamp.now(),
            departBy: user.uid,
            departPhotoUrl: null,
            departPhotoPath: null,
            receptionTempC: null,
            receptionAt: null,
            receptionBy: null,
            receptionPhotoUrl: null,
            receptionPhotoPath: null,
            result: evalRes.result,
            ruleMaxTol: evalRes.maxTol,
            isManual: false,
            createdAt: Timestamp.now(),
          }),
          60000,
          "setDoc livraisons"
        )
        await withTimeout(
          updateDoc(doc(db, "lots_cuisine", lot.id), { sent: true, sentToCornerAt: Timestamp.now() }),
          60000,
          "update lot sent"
        )
      }

      for (const line of validManualLines) {
        const produit = produits.find(p => p.id === line.productId)
        if (!produit) continue
        const t = line.temp.trim() !== '' ? Number(line.temp.trim().replace(',', '.')) : null
        const category = normalizeCategoryKey(line.category || produit.defaultCategory || "AUTRE")
        const evalRes = t !== null && Number.isFinite(t)
          ? evaluateTemp(category, t)
          : { result: "A_VERIFIER" as const, maxTol: null as number | null, rule: null }

        const now = new Date()
        const abrv = (produit.abrv || canon(produit.name).slice(0, 6)).toUpperCase()
        const lotCode = `${ddmmyyyy(now)}-${hhmm(now)}-MAN-${abrv}`

        setStatus(`Envoi ${produit.name}…`)
        await withTimeout(
          addDoc(collection(db, "livraisons"), {
            lotId: null, lotCode,
            productId: produit.id, productName: produit.name,
            category, departTempC: t, departAt: Timestamp.now(), departBy: user.uid,
            departPhotoUrl: null, departPhotoPath: null,
            receptionTempC: null, receptionAt: null, receptionBy: null,
            receptionPhotoUrl: null, receptionPhotoPath: null,
            result: evalRes.result, ruleMaxTol: evalRes.maxTol,
            isManual: true, createdAt: Timestamp.now(),
          }),
          60000, "addDoc livraisons (manual)"
        )
      }

      setLotSelections({})
      setManualLines([])
      await Promise.all([loadLots(), loadLivraisonsForView()])
      alert(`${totalItems} envoi(s) effectué(s) ✅`)
    } catch (e: any) {
      console.error(e)
      setError(e?.message || "Erreur lors de l'envoi")
    } finally {
      setLoading(false)
      setStatus("")
    }
  }

  async function submitCornerReception(livraisonId: string, receptionTempStr: string, photo: File | null) {
    setError(null);
    const t = Number(String(receptionTempStr).replace(",", "."));
    if (!Number.isFinite(t)) return setError("Température réception invalide.");

    setLoading(true);
    try {
      setStatus("Connexion…");
      const user = await withTimeout(ensureAnonAuth(), 30000, "auth");

      const livRef = doc(db, "livraisons", livraisonId);
      const livSnap = await withTimeout(getDoc(livRef), 20000, "get livraison");
      if (!livSnap.exists()) throw new Error("Livraison introuvable.");

      const liv = livSnap.data() as any;
      const category = normalizeCategoryKey(liv.category || "AUTRE");
      const evalRes = evaluateTemp(category, t);

      setStatus("Upload photo (optionnel)…");
      let receptionPhotoUrl: string | null = null;
      let receptionPhotoPath: string | null = null;
      if (photo) {
        const ts = Date.now();
        const lotCode = String(liv.lotCode || livraisonId);
        const path = `livraisons/${lotCode}/reception-${ts}-${photo.name}`;
        const up = await withTimeout(uploadPhoto(photo, path), 60000, "upload reception photo");
        receptionPhotoUrl = up.url;
        receptionPhotoPath = up.path;
      }

      setStatus("Mise à jour Firestore…");
      await withTimeout(
        updateDoc(livRef, {
          receptionTempC: t,
          receptionAt: Timestamp.now(),
          receptionBy: user.uid,
          receptionPhotoUrl,
          receptionPhotoPath,
          result: evalRes.result,
          ruleMaxTol: evalRes.maxTol,
        }),
        60000,
        "updateDoc livraison"
      );

      await loadLivraisonsForView();
      alert(`Réception enregistrée ✅ (${evalRes.result})`);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Erreur réception livraison");
    } finally {
      setLoading(false);
      setStatus("");
    }
  }

  function startEdit(l: LivrDoc) {
    setEditId(l.id);
    setEditTemp(String(l.departTempC));
    setEditCategory(l.category || "AUTRE");
    setEditPhoto(null);
  }

  async function saveEdit(l: LivrDoc) {
    setError(null);
    if (!editId) return;

    const t = Number(String(editTemp).replace(",", "."));
    if (!Number.isFinite(t)) return setError("Température départ invalide.");

    setLoading(true);
    try {
      setStatus("Connexion…");
      await withTimeout(ensureAnonAuth(), 30000, "auth");

      const category = normalizeCategoryKey(editCategory || l.category || "AUTRE");
      const evalRes = evaluateTemp(category, t);

      let departPhotoUrl: string | null = l.departPhotoUrl ?? null;
      let departPhotoPath: string | null = l.departPhotoPath ?? null;

      if (editPhoto) {
        await deletePhotoIfAny(departPhotoPath);
        const ts = Date.now();
        const base = l.lotCode || l.id;
        const path = `livraisons/${base}/depart-edit-${ts}-${editPhoto.name}`;
        const up = await withTimeout(uploadPhoto(editPhoto, path), 60000, "upload edit depart photo");
        departPhotoUrl = up.url;
        departPhotoPath = up.path;
      }

      const livRef = doc(db, "livraisons", l.id);
      await withTimeout(
        updateDoc(livRef, {
          departTempC: t,
          category,
          departPhotoUrl,
          departPhotoPath,
          result: evalRes.result,
          ruleMaxTol: evalRes.maxTol,
        }),
        60000,
        "updateDoc depart edit"
      );

      setEditId(null);
      setEditPhoto(null);

      await loadLivraisonsForView();
      alert("Départ modifié ✅");
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Erreur modification départ");
    } finally {
      setLoading(false);
      setStatus("");
    }
  }

  async function removeDepart(l: LivrDoc) {
    if (l.receptionTempC != null) {
      alert("Suppression refusée : la réception est déjà enregistrée.");
      return;
    }

    const ok = confirm(`Supprimer ce départ ?\n${l.productName} — ${l.lotCode}`);
    if (!ok) return;

    setLoading(true);
    try {
      setStatus("Connexion…");
      await withTimeout(ensureAnonAuth(), 30000, "auth");

      await deletePhotoIfAny(l.departPhotoPath);
      await deletePhotoIfAny(l.receptionPhotoPath);

      await withTimeout(deleteDoc(doc(db, "livraisons", l.id)), 60000, "deleteDoc livraisons");

      if (l.lotId) {
        const lotRef = doc(db, "lots_cuisine", l.lotId);
        await withTimeout(
          updateDoc(lotRef, {
            sent: false,
            sentToCornerAt: deleteField(),
          }),
          60000,
          "unlock lot"
        );
      }

      setEditId(null);
      await Promise.all([loadLots(), loadLivraisonsForView()]);
      alert("Départ supprimé ✅");
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Erreur suppression départ");
    } finally {
      setLoading(false);
      setStatus("");
    }
  }

  // ── MODE CONTROLE ──────────────────────────────────────────────────────
  if (isControlView && monthInfo) {
    return (
      <div style={{ padding: '16px', maxWidth: 520, margin: '0 auto' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--on-surface)', letterSpacing: '-0.02em', marginBottom: 16 }}>
          Contrôle — Températures Livraisons
        </h1>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => {
              setSearchParams((prev) => {
                const sp = new URLSearchParams(prev);
                sp.delete("month");
                return sp;
              });
            }}
          >
            Retour "Aujourd'hui"
          </button>
          <button className="btn-secondary" type="button" onClick={() => loadLivraisonsForView()} disabled={loading}>
            Rafraîchir
          </button>
        </div>

        {status && <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4, marginBottom: 8 }}>Étape : {status}</div>}
        {error && (
          <div style={{ padding: '10px 14px', background: 'rgba(136,0,20,0.12)', border: '1px solid rgba(136,0,20,0.25)', borderRadius: 10, fontSize: 13, color: 'var(--danger)', marginTop: 10 }}>
            {error}
          </div>
        )}

        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface)', marginTop: 20, marginBottom: 10 }}>
          Mois : {monthInfo.label}
        </h2>

        <div style={{ fontSize: 13, color: 'var(--on-surface-3)', marginBottom: 12 }}>
          Total <b style={{ color: 'var(--on-surface)' }}>{stats.total}</b> · Attente réception <b style={{ color: 'var(--on-surface)' }}>{stats.pendingReception}</b> · Acceptés <b style={{ color: 'var(--success)' }}>{stats.accepte}</b> · Refusés{" "}
          <b style={{ color: 'var(--danger)' }}>{stats.refuse}</b> · À vérifier <b style={{ color: 'var(--warning)' }}>{stats.aVerifier}</b>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {todayLivraisons.map((l) => {
            const depAt = l.departAt?.toDate ? l.departAt.toDate().toLocaleString() : "";
            const recAt = l.receptionAt?.toDate ? l.receptionAt.toDate().toLocaleString() : "";
            const needsReception = l.receptionTempC == null;

            return (
              <div key={l.id} style={{ background: 'var(--surface)', borderRadius: 12, padding: 12, border: '1px solid var(--border)', marginBottom: 8 }}>
                <div style={{ fontWeight: 700, color: 'var(--on-surface)', fontSize: 14 }}>
                  {l.productName}{l.isManual ? " (manuel)" : ""} — {l.lotCode}
                </div>

                <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4 }}>
                  Catégorie : {l.category} · Résultat : <b style={{ color: l.result === 'ACCEPTE' ? 'var(--success)' : l.result === 'REFUSE' ? 'var(--danger)' : 'var(--warning)' }}>{l.result}</b>
                  {l.ruleMaxTol != null ? ` (tol. max ${l.ruleMaxTol}°C)` : ""}
                </div>

                <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4 }}>
                  Départ : <b style={{ color: 'var(--on-surface)' }}>{l.departTempC}°C</b>{depAt ? ` — ${depAt}` : ""}
                  {" · "}
                  Réception : <b style={{ color: needsReception ? 'var(--danger)' : 'var(--on-surface)' }}>{needsReception ? "NON SAISIE" : `${l.receptionTempC}°C`}</b>{recAt ? ` — ${recAt}` : ""}
                </div>

                <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4 }}>
                  Photo départ :{" "}
                  {l.departPhotoUrl ? <a href={l.departPhotoUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>ouvrir</a> : "—"}
                  {" · "}
                  Photo réception :{" "}
                  {l.receptionPhotoUrl ? <a href={l.receptionPhotoUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>ouvrir</a> : "—"}
                </div>
              </div>
            );
          })}

          {!todayLivraisons.length && (
            <div style={{ fontSize: 13, color: 'var(--on-surface-3)', marginBottom: 8 }}>Aucune livraison sur ce mois.</div>
          )}
        </div>
      </div>
    );
  }

  // ── MODE NORMAL ────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '16px', maxWidth: 520, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--on-surface)', letterSpacing: '-0.02em', marginBottom: 16 }}>
        Livraisons cuisine → corner
      </h1>

      {/* Mode tabs: CUISINE / CORNER */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', borderRadius: 12, padding: 4, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setMode("CUISINE")}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 9, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: mode === 'CUISINE' ? 'var(--surface-mid)' : 'transparent', color: mode === 'CUISINE' ? 'var(--on-surface)' : 'var(--on-surface-3)' }}
        >
          Cuisine – départ
        </button>
        <button
          type="button"
          onClick={() => setMode("CORNER")}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 9, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: mode === 'CORNER' ? 'var(--surface-mid)' : 'transparent', color: mode === 'CORNER' ? 'var(--on-surface)' : 'var(--on-surface-3)' }}
        >
          Corner – réception
        </button>
      </div>

      {status && <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4, marginBottom: 8 }}>Étape : {status}</div>}
      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(136,0,20,0.12)', border: '1px solid rgba(136,0,20,0.25)', borderRadius: 10, fontSize: 13, color: 'var(--danger)', marginTop: 10 }}>
          {error}
        </div>
      )}

      {mode === "CUISINE" && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface)', marginTop: 20, marginBottom: 10 }}>
            Départ (cuisine)
          </h2>

          {(() => {
            const availableLots = lots.filter(l => !l.sent)
            const selectedLots = availableLots.filter(l => lotSelections[l.id]?.selected)
            const validManualLines = manualLines.filter(m => m.productId.trim() !== '')
            const totalItems = selectedLots.length + validManualLines.length
            const tempsCount = [
              ...selectedLots.filter(l => {
                const t = (lotSelections[l.id]?.temp || '').trim()
                return t !== '' && Number.isFinite(Number(t.replace(',', '.')))
              }),
              ...validManualLines.filter(m => m.temp.trim() !== '' && Number.isFinite(Number(m.temp.trim().replace(',', '.')))),
            ].length
            const minTemps = Math.min(2, totalItems)
            return (
              <form onSubmit={submitAll} style={{ marginBottom: 12 }}>
                {/* Lots disponibles */}
                {availableLots.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, fontFamily: 'Manrope, sans-serif' }}>
                      LOTS CUISINE
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                      {availableLots.map(lot => {
                        const sel = lotSelections[lot.id] || { selected: false, temp: '' }
                        return (
                          <div
                            key={lot.id}
                            onClick={() => setLotSelections(prev => ({
                              ...prev,
                              [lot.id]: { ...(prev[lot.id] || { selected: false, temp: '' }), selected: !sel.selected },
                            }))}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 10,
                              background: sel.selected ? 'rgba(0,66,117,0.06)' : 'var(--surface-low)',
                              borderRadius: 10, padding: '10px 12px',
                              border: `1px solid ${sel.selected ? 'rgba(0,66,117,0.2)' : 'transparent'}`,
                              cursor: 'pointer', transition: 'all 0.1s',
                            }}
                          >
                            <div style={{
                              width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                              border: `2px solid ${sel.selected ? 'var(--primary)' : 'var(--border)'}`,
                              background: sel.selected ? 'var(--primary)' : 'transparent',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              {sel.selected && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)', fontFamily: 'Manrope, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {lot.productName}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--on-surface-3)', fontFamily: 'Manrope, sans-serif' }}>
                                {lot.lotCode}
                              </div>
                            </div>
                            {sel.selected && (
                              <input
                                className="input"
                                style={{ width: 76, fontSize: 13, textAlign: 'center', padding: '4px 8px', flexShrink: 0 }}
                                placeholder="°C"
                                value={sel.temp}
                                onClick={e => e.stopPropagation()}
                                onChange={e => {
                                  e.stopPropagation()
                                  setLotSelections(prev => ({
                                    ...prev,
                                    [lot.id]: { ...prev[lot.id], temp: e.target.value },
                                  }))
                                }}
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
                {availableLots.length === 0 && manualLines.length === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--on-surface-3)', padding: '8px 0 12px' }}>Aucun lot disponible.</div>
                )}

                {/* Saisies manuelles */}
                {manualLines.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, fontFamily: 'Manrope, sans-serif' }}>
                      SAISIES MANUELLES
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                      {manualLines.map(line => (
                          <div key={line.id} style={{ background: 'var(--surface-low)', borderRadius: 10, padding: '10px 12px' }}>
                            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                              <ProduitSearch
                                productId={line.productId}
                                produits={produits}
                                mercurialeGep={mercurialeGep}
                                onSelect={(id, category) => {
                                  updateManualLine(line.id, 'productId', id)
                                  updateManualLine(line.id, 'category', category)
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => removeManualLine(line.id)}
                                style={{ width: 36, height: 36, borderRadius: 8, border: 'none', background: 'rgba(136,0,20,0.08)', color: 'var(--danger)', fontSize: 14, cursor: 'pointer', flexShrink: 0 }}
                              >✕</button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8 }}>
                              <select
                                className="input"
                                style={{ fontSize: 12 }}
                                value={line.category}
                                onChange={e => updateManualLine(line.id, 'category', e.target.value)}
                              >
                                <option value="PLAT_CUISINE">Plat cuisiné</option>
                                <option value="LEGUME">Légumes</option>
                                <option value="VIANDE">Viande</option>
                                <option value="VIANDE_HACHEE">Viande hachée</option>
                                <option value="POISSON">Poisson</option>
                                <option value="LAIT">Lait / Laitier</option>
                                <option value="PATISSERIE">Pâtisserie</option>
                                <option value="AUTRE">Autre</option>
                              </select>
                              <input
                                className="input"
                                style={{ fontSize: 13, textAlign: 'center' }}
                                value={line.temp}
                                onChange={e => updateManualLine(line.id, 'temp', e.target.value)}
                                placeholder="°C"
                              />
                            </div>
                          </div>
                        ))}
                    </div>
                  </>
                )}

                {/* Ajouter saisie manuelle */}
                <button
                  type="button"
                  onClick={addManualLine}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700,
                    color: 'var(--on-surface-2)', background: 'var(--surface-low)',
                    border: '1.5px dashed var(--border)',
                    borderRadius: 10, padding: '9px 14px', cursor: 'pointer', width: '100%', justifyContent: 'center',
                    fontFamily: 'Manrope, sans-serif', marginBottom: 12,
                  }}
                >
                  + Saisie manuelle (sans lot)
                </button>

                {/* Résumé températures */}
                {totalItems > 0 && (
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, fontFamily: 'Manrope, sans-serif', color: tempsCount >= minTemps ? 'var(--success)' : 'var(--warning)' }}>
                    {tempsCount >= minTemps ? '✓' : '⚠'} {tempsCount} température(s) saisie(s) sur {totalItems} entrée(s){tempsCount < minTemps ? ` — min. ${minTemps} requise(s)` : ''}
                  </div>
                )}

                <button className="btn-primary" type="submit" disabled={loading || totalItems === 0}>
                  {totalItems > 0 ? `Envoyer ${totalItems} entrée(s)` : 'Sélectionne des lots ou ajoute une saisie'}
                </button>
              </form>
            )
          })()}

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '20px 0' }} />

          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface)', marginTop: 20, marginBottom: 10 }}>
            Départs du jour
          </h2>
          <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4, marginBottom: 10 }}>
            Modifier/supprimer tant que la réception n'a pas été saisie.
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {todayDepartOnly.map((l) => {
              const needsReception = l.receptionTempC == null;
              const depAt = l.departAt?.toDate ? l.departAt.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
              const isEditing = editId === l.id;

              return (
                <div key={l.id} style={{ background: 'var(--surface)', borderRadius: 12, padding: 12, border: '1px solid var(--border)', marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, color: 'var(--on-surface)', fontSize: 14 }}>
                    {l.productName}{l.isManual ? " (manuel)" : ""} — {l.lotCode}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4 }}>
                    Départ {l.departTempC != null ? `${l.departTempC}°C` : '—'} à {depAt} · Cat. {l.category} · Statut: <b style={{ color: needsReception ? 'var(--warning)' : 'var(--success)' }}>{needsReception ? "à compléter" : `réception OK (${l.result})`}</b>
                  </div>

                  {l.departPhotoUrl && (
                    <a href={l.departPhotoUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, position: 'relative', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
                      <img src={l.departPhotoUrl} alt="photo départ" style={{ display: 'block', height: 72, width: 'auto', maxWidth: 120, objectFit: 'cover', borderRadius: 8 }} />
                      {l.departTempC != null && (
                        <span style={{
                          position: 'absolute', bottom: 4, right: 4,
                          background: 'rgba(0,0,0,0.62)', color: '#fff',
                          fontSize: 11, fontWeight: 800, padding: '2px 6px', borderRadius: 5,
                          fontFamily: 'Epilogue, sans-serif', letterSpacing: '-0.01em',
                        }}>{l.departTempC}°C</span>
                      )}
                    </a>
                  )}

                  {isEditing ? (
                    <div style={{ marginTop: 10 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Température départ
                      </label>
                      <input className="input" value={editTemp} onChange={(e) => setEditTemp(e.target.value)} />

                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Catégorie
                      </label>
                      <input className="input" value={editCategory} onChange={(e) => setEditCategory(e.target.value)} />

                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Remplacer photo (optionnel)
                      </label>
                      <input className="input" type="file" accept="image/*" onChange={(e) => setEditPhoto(e.target.files?.[0] || null)} />

                      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button className="btn-primary" type="button" disabled={loading} onClick={() => saveEdit(l)}>
                          Enregistrer
                        </button>
                        <button className="btn-secondary" type="button" disabled={loading} onClick={() => setEditId(null)}>
                          Annuler
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button className="btn-secondary" type="button" disabled={loading || !needsReception} onClick={() => startEdit(l)}>
                        Modifier
                      </button>
                      <button className="btn-secondary" type="button" disabled={loading} onClick={() => removeDepart(l)}>
                        Supprimer
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {!todayDepartOnly.length && (
              <div style={{ fontSize: 13, color: 'var(--on-surface-3)', marginBottom: 8 }}>Aucun départ aujourd'hui.</div>
            )}
          </div>
        </>
      )}

      {mode === "CORNER" && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface)', marginTop: 20, marginBottom: 10 }}>
            Réception (corner)
          </h2>
          <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4, marginBottom: 10 }}>
            Livraisons d'aujourd'hui. Celles sans température de réception sont à compléter.
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {todayLivraisons.map((l) => {
              const depAt = l.departAt?.toDate ? l.departAt.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
              const needsReception = l.receptionTempC == null;

              return (
                <div key={l.id} style={{ background: 'var(--surface)', borderRadius: 12, padding: 12, border: '1px solid var(--border)', marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, color: 'var(--on-surface)', fontSize: 14 }}>
                    {l.productName}{l.isManual ? " (manuel)" : ""}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4 }}>
                    Lot <b style={{ color: 'var(--on-surface)' }}>{l.lotCode}</b> · Départ {l.departTempC != null ? `${l.departTempC}°C` : '—'} à {depAt} · Cat. {l.category}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4 }}>
                    Statut : <b style={{ color: needsReception ? 'var(--warning)' : 'var(--success)' }}>{needsReception ? "À compléter (réception)" : `Réception OK (${l.result})`}</b>
                  </div>

                  {(l.departPhotoUrl || l.receptionPhotoUrl) && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      {l.departPhotoUrl && (
                        <a href={l.departPhotoUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', position: 'relative', borderRadius: 8, overflow: 'hidden' }}>
                          <img src={l.departPhotoUrl} alt="photo départ" style={{ display: 'block', height: 72, width: 'auto', maxWidth: 120, objectFit: 'cover', borderRadius: 8 }} />
                          <span style={{ position: 'absolute', bottom: 4, left: 4, background: 'rgba(0,0,0,0.62)', color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4, fontFamily: 'Manrope, sans-serif' }}>Départ</span>
                          {l.departTempC != null && (
                            <span style={{ position: 'absolute', bottom: 4, right: 4, background: 'rgba(0,0,0,0.62)', color: '#fff', fontSize: 11, fontWeight: 800, padding: '2px 6px', borderRadius: 5, fontFamily: 'Epilogue, sans-serif' }}>{l.departTempC}°C</span>
                          )}
                        </a>
                      )}
                      {l.receptionPhotoUrl && (
                        <a href={l.receptionPhotoUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', position: 'relative', borderRadius: 8, overflow: 'hidden' }}>
                          <img src={l.receptionPhotoUrl} alt="photo réception" style={{ display: 'block', height: 72, width: 'auto', maxWidth: 120, objectFit: 'cover', borderRadius: 8 }} />
                          <span style={{ position: 'absolute', bottom: 4, left: 4, background: 'rgba(0,0,0,0.62)', color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4, fontFamily: 'Manrope, sans-serif' }}>Réception</span>
                          {l.receptionTempC != null && (
                            <span style={{ position: 'absolute', bottom: 4, right: 4, background: 'rgba(0,0,0,0.62)', color: '#fff', fontSize: 11, fontWeight: 800, padding: '2px 6px', borderRadius: 5, fontFamily: 'Epilogue, sans-serif' }}>{l.receptionTempC}°C</span>
                          )}
                        </a>
                      )}
                    </div>
                  )}

                  {needsReception && (
                    <CornerReceptionForm
                      disabled={loading}
                      onSave={(temp, photo) => submitCornerReception(l.id, temp, photo)}
                      category={l.category}
                    />
                  )}
                </div>
              );
            })}

            {!todayLivraisons.length && (
              <div style={{ fontSize: 13, color: 'var(--on-surface-3)', marginBottom: 8 }}>Aucune livraison aujourd'hui.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CornerReceptionForm({
  onSave,
  disabled,
  category,
}: {
  onSave: (temp: string, photo: File | null) => void;
  disabled: boolean;
  category: string;
}) {
  const [temp, setTemp] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);

  const info = useMemo(() => {
    const key = normalizeCategoryKey(category || "AUTRE");
    const rule = RULES[key];
    if (!rule) return `Catégorie ${key} — pas de seuil connu → A_VERIFIER`;
    return `Seuil ${key} : cible ${rule.min}–${rule.max}°C, tolérance max ${rule.maxTol}°C`;
  }, [category]);

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4, marginBottom: 8 }}>{info}</div>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Température réception (°C) *
      </label>
      <input className="input" value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="ex : 3,8" />

      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Photo (optionnelle)
      </label>
      <input className="input" type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn-primary" type="button" disabled={disabled} onClick={() => onSave(temp, photo)}>
          Enregistrer réception
        </button>
      </div>
    </div>
  );
}

// ─── ProduitSearch — autocomplete for manual lines ────────────────
function ProduitSearch({ productId, produits, mercurialeGep, onSelect }: {
  productId: string
  produits: Produit[]
  mercurialeGep: Record<string, string>
  onSelect: (id: string, category: string) => void
}) {
  const [inputVal, setInputVal] = useState(() => produits.find(x => x.id === productId)?.name ?? '')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const p = produits.find(x => x.id === productId)
    setInputVal(p ? p.name : '')
  }, [productId, produits])

  const filtered = inputVal.trim().length > 0
    ? produits.filter(p => p.name.toLowerCase().includes(inputVal.toLowerCase())).slice(0, 8)
    : produits.slice(0, 8)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1 }}>
      <input
        className="input"
        style={{ fontSize: 13, width: '100%' }}
        value={inputVal}
        placeholder="Rechercher un produit…"
        autoComplete="off"
        onChange={e => { setInputVal(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: 'var(--surface)', borderRadius: 10, marginTop: 4,
          boxShadow: '0 8px 24px rgba(28,28,24,0.14)', overflow: 'hidden',
          maxHeight: 220, overflowY: 'auto',
        }}>
          {filtered.map(p => (
            <button
              key={p.id}
              type="button"
              onMouseDown={e => { e.preventDefault(); setInputVal(p.name); setOpen(false); onSelect(p.id, mercurialeGep[p.name] || p.defaultCategory || 'PLAT_CUISINE') }}
              onTouchEnd={e => { e.preventDefault(); setInputVal(p.name); setOpen(false); onSelect(p.id, mercurialeGep[p.name] || p.defaultCategory || 'PLAT_CUISINE') }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '10px 14px', fontSize: 13, color: 'var(--on-surface)',
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: '1px solid var(--border-soft)', fontFamily: 'Manrope, sans-serif',
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
