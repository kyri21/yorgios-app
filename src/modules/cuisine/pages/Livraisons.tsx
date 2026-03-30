import { useEffect, useMemo, useState } from "react";
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

type Produit = {
  id: string;
  name: string;
  abrv?: string;
  defaultCategory?: string;
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

  const [sendMode, setSendMode] = useState<"LOT" | "MANUEL">("LOT");

  const [lots, setLots] = useState<LotCuisine[]>([]);
  const [lotId, setLotId] = useState("");
  const [departTemp, setDepartTemp] = useState("");
  const [departPhoto, setDepartPhoto] = useState<File | null>(null);

  const [produits, setProduits] = useState<Produit[]>([]);
  const [manualProductId, setManualProductId] = useState("");
  const [manualCategory, setManualCategory] = useState("PLAT_CUISINE");
  const [manualTemp, setManualTemp] = useState("");
  const [manualPhoto, setManualPhoto] = useState<File | null>(null);

  const [todayLivraisons, setTodayLivraisons] = useState<LivrDoc[]>([]);
  const [todayDepartOnly, setTodayDepartOnly] = useState<LivrDoc[]>([]);

  const [editId, setEditId] = useState<string | null>(null);
  const [editTemp, setEditTemp] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editPhoto, setEditPhoto] = useState<File | null>(null);

  const selectedLot = useMemo(() => lots.find((l) => l.id === lotId) || null, [lots, lotId]);
  const selectedManualProduit = useMemo(() => produits.find((p) => p.id === manualProductId) || null, [produits, manualProductId]);

  const stats = useMemo(() => {
    const total = todayLivraisons.length;
    const pendingReception = todayLivraisons.filter((l) => l.receptionTempC == null).length;
    const refuse = todayLivraisons.filter((l) => l.result === "REFUSE").length;
    const accepte = todayLivraisons.filter((l) => l.result === "ACCEPTE").length;
    const aVerifier = todayLivraisons.filter((l) => l.result === "A_VERIFIER").length;
    return { total, pendingReception, refuse, accepte, aVerifier };
  }, [todayLivraisons]);

  async function loadLots() {
    const qLots = query(collection(db, "lots_cuisine"), orderBy("createdAt", "desc"), limit(120));
    const snap = await withTimeout(getDocs(qLots), 20000, "load lots_cuisine");
    const list: LotCuisine[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    setLots(list);
  }

  async function loadProduits() {
    const qP = query(collection(db, "produits"), orderBy("name", "asc"), limit(300));
    const snap = await withTimeout(getDocs(qP), 20000, "load produits");
    const list: Produit[] = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((p) => p.active !== false);
    setProduits(list);
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

  async function submitCuisineDepartLot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!selectedLot) return setError("Choisis un lot à livrer.");
    if (selectedLot.sent) return setError("Ce lot est déjà envoyé (bloqué).");

    const t = Number(String(departTemp).replace(",", "."));
    if (!Number.isFinite(t)) return setError("Température départ invalide.");

    setLoading(true);
    try {
      setStatus("Connexion…");
      const user = await withTimeout(ensureAnonAuth(), 30000, "auth");

      const livraisonRef = doc(db, "livraisons", selectedLot.id);
      const existsSnap = await withTimeout(getDoc(livraisonRef), 20000, "check livraison exists");
      if (existsSnap.exists()) {
        throw new Error("Impossible : ce lot a déjà une livraison (déjà envoyé).");
      }

      const category = normalizeCategoryKey(selectedLot.category || "AUTRE");
      const evalRes = evaluateTemp(category, t);

      setStatus("Upload photo (optionnel)…");
      let departPhotoUrl: string | null = null;
      let departPhotoPath: string | null = null;
      if (departPhoto) {
        const ts = Date.now();
        const path = `livraisons/${selectedLot.lotCode}/depart-${ts}-${departPhoto.name}`;
        const up = await withTimeout(uploadPhoto(departPhoto, path), 60000, "upload depart photo");
        departPhotoUrl = up.url;
        departPhotoPath = up.path;
      }

      setStatus("Écriture Firestore…");
      await withTimeout(
        setDoc(livraisonRef, {
          lotId: selectedLot.id,
          lotCode: selectedLot.lotCode,
          productId: selectedLot.productId,
          productName: selectedLot.productName,
          category,

          departTempC: t,
          departAt: Timestamp.now(),
          departBy: user.uid,
          departPhotoUrl,
          departPhotoPath,

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
        "setDoc livraisons (lotId)"
      );

      const lotRef = doc(db, "lots_cuisine", selectedLot.id);
      await withTimeout(updateDoc(lotRef, { sent: true, sentToCornerAt: Timestamp.now() }), 60000, "update lot sent");

      setLotId("");
      setDepartTemp("");
      setDepartPhoto(null);

      await Promise.all([loadLots(), loadLivraisonsForView()]);
      alert("Livraison créée ✅");
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Erreur création livraison");
    } finally {
      setLoading(false);
      setStatus("");
    }
  }

  async function submitCuisineDepartManual(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!selectedManualProduit) return setError("Choisis un produit.");
    const t = Number(String(manualTemp).replace(",", "."));
    if (!Number.isFinite(t)) return setError("Température départ invalide.");

    setLoading(true);
    try {
      setStatus("Connexion…");
      const user = await withTimeout(ensureAnonAuth(), 30000, "auth");

      const now = new Date();
      const abrv = (selectedManualProduit.abrv || canon(selectedManualProduit.name).slice(0, 6)).toUpperCase();
      const lotCode = `${ddmmyyyy(now)}-${hhmm(now)}-MAN-${abrv}`;

      const category = normalizeCategoryKey(manualCategory || selectedManualProduit.defaultCategory || "AUTRE");
      const evalRes = evaluateTemp(category, t);

      setStatus("Upload photo (optionnel)…");
      let departPhotoUrl: string | null = null;
      let departPhotoPath: string | null = null;
      if (manualPhoto) {
        const ts = Date.now();
        const path = `livraisons/${lotCode}/depart-${ts}-${manualPhoto.name}`;
        const up = await withTimeout(uploadPhoto(manualPhoto, path), 60000, "upload manual depart photo");
        departPhotoUrl = up.url;
        departPhotoPath = up.path;
      }

      setStatus("Écriture Firestore…");
      await withTimeout(
        addDoc(collection(db, "livraisons"), {
          lotId: null,
          lotCode,
          productId: selectedManualProduit.id,
          productName: selectedManualProduit.name,
          category,

          departTempC: t,
          departAt: Timestamp.now(),
          departBy: user.uid,
          departPhotoUrl,
          departPhotoPath,

          receptionTempC: null,
          receptionAt: null,
          receptionBy: null,
          receptionPhotoUrl: null,
          receptionPhotoPath: null,

          result: evalRes.result,
          ruleMaxTol: evalRes.maxTol,

          isManual: true,

          createdAt: Timestamp.now(),
        }),
        60000,
        "addDoc livraisons (manual)"
      );

      setManualProductId("");
      setManualTemp("");
      setManualPhoto(null);

      await loadLivraisonsForView();
      alert("Livraison manuelle créée ✅");
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Erreur création livraison manuelle");
    } finally {
      setLoading(false);
      setStatus("");
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

          {/* Send mode tabs: LOT / MANUEL */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', borderRadius: 12, padding: 4, marginBottom: 16 }}>
            <button
              type="button"
              onClick={() => setSendMode("LOT")}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 9, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: sendMode === 'LOT' ? 'var(--surface-mid)' : 'transparent', color: sendMode === 'LOT' ? 'var(--on-surface)' : 'var(--on-surface-3)' }}
            >
              Envoyer un LOT
            </button>
            <button
              type="button"
              onClick={() => setSendMode("MANUEL")}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 9, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: sendMode === 'MANUEL' ? 'var(--surface-mid)' : 'transparent', color: sendMode === 'MANUEL' ? 'var(--on-surface)' : 'var(--on-surface-3)' }}
            >
              Manuel (sans lot)
            </button>
          </div>

          {sendMode === "LOT" && (
            <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 16, border: '1px solid var(--border)', marginBottom: 12 }}>
              <form onSubmit={submitCuisineDepartLot}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Lot à livrer *
                </label>
                <select className="input" value={lotId} onChange={(e) => setLotId(e.target.value)}>
                  <option value="">— Sélectionner un lot —</option>
                  {lots.map((l) => (
                    <option key={l.id} value={l.id} disabled={!!l.sent}>
                      {l.lotCode} — {l.productName}{l.sent ? " (déjà envoyé)" : ""}
                    </option>
                  ))}
                </select>

                {selectedLot && (
                  <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4 }}>
                    Produit : <b style={{ color: 'var(--on-surface)' }}>{selectedLot.productName}</b> · Catégorie : <b style={{ color: 'var(--on-surface)' }}>{normalizeCategoryKey(selectedLot.category || "AUTRE")}</b>
                  </div>
                )}

                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Température départ (°C) *
                </label>
                <input className="input" value={departTemp} onChange={(e) => setDepartTemp(e.target.value)} placeholder="ex : 3,8" />

                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Photo (optionnelle)
                </label>
                <input className="input" type="file" accept="image/*" onChange={(e) => setDepartPhoto(e.target.files?.[0] || null)} />

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn-primary" type="submit" disabled={loading}>
                    Créer la livraison
                  </button>
                </div>
              </form>
            </div>
          )}

          {sendMode === "MANUEL" && (
            <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 16, border: '1px solid var(--border)', marginBottom: 12 }}>
              <form onSubmit={submitCuisineDepartManual}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Produit *
                </label>
                <select
                  className="input"
                  value={manualProductId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setManualProductId(id);
                    const p = produits.find((x) => x.id === id);
                    if (p?.defaultCategory) setManualCategory(String(p.defaultCategory));
                  }}
                >
                  <option value="">— Sélectionner un produit —</option>
                  {produits.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>

                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Catégorie (modifiable)
                </label>
                <input
                  className="input"
                  value={manualCategory}
                  onChange={(e) => setManualCategory(e.target.value)}
                  placeholder="ex : LEGUMES / VIANDES / plats cuisinés"
                />

                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Température départ (°C) *
                </label>
                <input className="input" value={manualTemp} onChange={(e) => setManualTemp(e.target.value)} placeholder="ex : 3,8" />

                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Photo (optionnelle)
                </label>
                <input className="input" type="file" accept="image/*" onChange={(e) => setManualPhoto(e.target.files?.[0] || null)} />

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn-primary" type="submit" disabled={loading}>
                    Créer la livraison manuelle
                  </button>
                </div>
              </form>
            </div>
          )}

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
                    Départ {l.departTempC}°C à {depAt} · Cat. {l.category} · Statut: <b style={{ color: needsReception ? 'var(--warning)' : 'var(--success)' }}>{needsReception ? "à compléter" : `réception OK (${l.result})`}</b>
                  </div>

                  {l.departPhotoUrl && (
                    <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4 }}>
                      Photo départ : <a href={l.departPhotoUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>ouvrir</a>
                    </div>
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
                    Lot <b style={{ color: 'var(--on-surface)' }}>{l.lotCode}</b> · Départ {l.departTempC}°C à {depAt} · Cat. {l.category}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4 }}>
                    Statut : <b style={{ color: needsReception ? 'var(--warning)' : 'var(--success)' }}>{needsReception ? "À compléter (réception)" : `Réception OK (${l.result})`}</b>
                  </div>

                  {l.departPhotoUrl && (
                    <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4 }}>
                      Photo départ : <a href={l.departPhotoUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>ouvrir</a>
                    </div>
                  )}
                  {l.receptionPhotoUrl && (
                    <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4 }}>
                      Photo réception : <a href={l.receptionPhotoUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>ouvrir</a>
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
