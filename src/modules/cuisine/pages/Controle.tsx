import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { getDownloadURL, ref as storageRef } from "firebase/storage";
import { httpsCallable, getFunctions } from "firebase/functions";

import { app, db, storage, ensureAnonAuth } from "../firebase/firebase";

type ArchiveBlock = {
  csvPath?: string;
  pdfPath?: string;
  rows?: number;
  alerts?: number;
  refus?: number;
};

type ArchiveDoc = {
  id: string;
  month?: string;

  temperatures?: ArchiveBlock;
  temperaturesFrigo?: ArchiveBlock;
  frigoTemperatures?: ArchiveBlock;

  livraisons?: ArchiveBlock;
  temperaturesLivraison?: ArchiveBlock;
  livraisonTemperatures?: ArchiveBlock;
};

type Mode = "MOIS" | "INTERVALLE";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function monthStr(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function currentMonth() {
  return monthStr(new Date());
}

function previousMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return monthStr(d);
}

function parseMonth(m: string) {
  const [y, mm] = m.split("-").map(Number);
  return { y, m: mm };
}

function compareMonth(a: string, b: string) {
  const A = parseMonth(a);
  const B = parseMonth(b);
  if (A.y !== B.y) return A.y - B.y;
  return A.m - B.m;
}

function monthsBetweenInclusive(from: string, to: string) {
  const start = parseMonth(from);
  const end = parseMonth(to);
  const out: string[] = [];

  let y = start.y;
  let m = start.m;

  while (y < end.y || (y === end.y && m <= end.m)) {
    out.push(`${y}-${pad2(m)}`);
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function monthStatus(m: string) {
  const cur = currentMonth();
  const cmp = compareMonth(m, cur);
  if (cmp > 0) return "FUTUR" as const;
  if (cmp === 0) return "EN_COURS" as const;
  return "TERMINE" as const;
}

async function openStoragePath(path?: string) {
  if (!path) return;
  const url = await getDownloadURL(storageRef(storage, path));
  window.open(url, "_blank", "noopener,noreferrer");
}

function resolveMonthKey(a: ArchiveDoc) {
  return a.month || a.id;
}

function resolveFrigo(a: ArchiveDoc | null): ArchiveBlock | null {
  if (!a) return null;
  return a.temperatures || a.temperaturesFrigo || a.frigoTemperatures || null;
}

function resolveLivraison(a: ArchiveDoc | null): ArchiveBlock | null {
  if (!a) return null;
  return a.livraisons || a.temperaturesLivraison || a.livraisonTemperatures || null;
}

export default function Controle() {
  const [archives, setArchives] = useState<ArchiveDoc[]>([]);
  const [mode, setMode] = useState<Mode>("MOIS");

  const [month, setMonth] = useState(previousMonth());

  const [fromMonth, setFromMonth] = useState(previousMonth());
  const [toMonth, setToMonth] = useState(currentMonth());

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadArchives() {
    setError(null);
    setStatus("Chargement des archives…");
    await ensureAnonAuth();

    const qy = query(collection(db, "archives"), orderBy("month", "desc"), limit(120));
    const snap = await getDocs(qy);

    const list: ArchiveDoc[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    setArchives(list);
    setStatus("");
  }

  useEffect(() => {
    loadArchives().catch((e: any) => {
      console.error(e);
      setError(e?.message || "Erreur chargement archives");
      setStatus("");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const archivesMap = useMemo(() => {
    const m = new Map<string, ArchiveDoc>();
    for (const a of archives) {
      const key = resolveMonthKey(a);
      if (key) m.set(key, a);
    }
    return m;
  }, [archives]);

  const monthsList = useMemo(() => {
    const s = new Set<string>();
    s.add(previousMonth());
    s.add(currentMonth());
    for (const a of archives) s.add(resolveMonthKey(a) || "");
    return Array.from(s).filter(Boolean).sort().reverse();
  }, [archives]);

  const selected = useMemo(() => archivesMap.get(month) || null, [archivesMap, month]);

  const rangeMonths = useMemo(() => {
    const a = fromMonth;
    const b = toMonth;
    const start = compareMonth(a, b) <= 0 ? a : b;
    const end = compareMonth(a, b) <= 0 ? b : a;
    return monthsBetweenInclusive(start, end);
  }, [fromMonth, toMonth]);

  async function generateMonth(targetMonth: string) {
    setError(null);
    setLoading(true);
    try {
      setStatus(`Génération des archives ${targetMonth}…`);
      await ensureAnonAuth();

      const fn = httpsCallable(getFunctions(app, "europe-west1"), "generateMonthlyArchives");
      await fn({ month: targetMonth });

      await loadArchives();
      alert(`Archives générées ✅ (${targetMonth})`);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || `Erreur génération archives (${targetMonth})`);
    } finally {
      setLoading(false);
      setStatus("");
    }
  }

  const frigo = resolveFrigo(selected);
  const livraison = resolveLivraison(selected);

  return (
    <div style={{ padding: '16px', maxWidth: 520, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--on-surface)', letterSpacing: '-0.02em', marginBottom: 16 }}>
        Contrôle &amp; Archives
      </h1>

      <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4, marginBottom: 16 }}>
        Accès rapide aux <b style={{ color: 'var(--on-surface)' }}>archives mensuelles</b> et aux <b style={{ color: 'var(--on-surface)' }}>données en cours</b>.
        Températures frigos = relevés HACCP. Températures livraison = départ cuisine + réception corner.
      </div>

      {status && <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4, marginBottom: 8 }}>Étape : {status}</div>}
      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(136,0,20,0.12)', border: '1px solid rgba(136,0,20,0.25)', borderRadius: 10, fontSize: 13, color: 'var(--danger)', marginTop: 10 }}>
          {error}
        </div>
      )}

      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', borderRadius: 12, padding: 4, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setMode("MOIS")}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 9, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: mode === 'MOIS' ? 'var(--surface-mid)' : 'transparent', color: mode === 'MOIS' ? 'var(--on-surface)' : 'var(--on-surface-3)' }}
        >
          1 mois
        </button>
        <button
          type="button"
          onClick={() => setMode("INTERVALLE")}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 9, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: mode === 'INTERVALLE' ? 'var(--surface-mid)' : 'transparent', color: mode === 'INTERVALLE' ? 'var(--on-surface)' : 'var(--on-surface-3)' }}
        >
          Intervalle
        </button>
      </div>

      {mode === "MOIS" && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface)', marginTop: 20, marginBottom: 10 }}>
            Vue 1 mois
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Mois
              </label>
              <select className="input" value={month} onChange={(e) => setMonth(e.target.value)}>
                {monthsList.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4 }}>
                Archives PDF/CSV générées le 1er du mois suivant.
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="btn-primary" type="button" disabled={loading} onClick={() => generateMonth(month)}>
                Générer / Regénérer
              </button>
            </div>
          </div>

          <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 12, border: '1px solid var(--border)', marginBottom: 8 }}>
            <div style={{ fontWeight: 700, color: 'var(--on-surface)', fontSize: 14, marginBottom: 8 }}>Détail du mois (live)</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <a className="btn-secondary" href={`/cuisine/temperatures?month=${month}`}>
                Températures frigos
              </a>
              <a className="btn-secondary" href={`/cuisine/livraisons?month=${month}`}>
                Températures livraison
              </a>
            </div>
            <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 6 }}>
              Même si le mois n'est pas fini, tu vois tous les jours déjà saisis.
            </div>
          </div>

          <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 12, border: '1px solid var(--border)', marginBottom: 8 }}>
            <div style={{ fontWeight: 700, color: 'var(--on-surface)', fontSize: 14, marginBottom: 8 }}>Archives {month}</div>

            <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 12, border: '1px solid var(--border)', marginBottom: 8 }}>
              <div style={{ fontWeight: 600, color: 'var(--on-surface)', fontSize: 13 }}>Températures frigos</div>
              <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4 }}>
                Jours: {frigo?.rows ?? "—"} · Alertes: {frigo?.alerts ?? "—"}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn-secondary" type="button" onClick={() => openStoragePath(frigo?.csvPath)}>
                  CSV
                </button>
                <button className="btn-secondary" type="button" onClick={() => openStoragePath(frigo?.pdfPath)}>
                  PDF
                </button>
              </div>
            </div>

            <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 12, border: '1px solid var(--border)', marginBottom: 8 }}>
              <div style={{ fontWeight: 600, color: 'var(--on-surface)', fontSize: 13 }}>Températures livraison</div>
              <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4 }}>
                Docs: {livraison?.rows ?? "—"} · Refus: {livraison?.refus ?? "—"}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn-secondary" type="button" onClick={() => openStoragePath(livraison?.csvPath)}>
                  CSV
                </button>
                <button className="btn-secondary" type="button" onClick={() => openStoragePath(livraison?.pdfPath)}>
                  PDF
                </button>
              </div>
            </div>

            {monthStatus(month) === "EN_COURS" && (
              <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 10 }}>
                Ce mois est <b style={{ color: 'var(--on-surface)' }}>en cours</b> : archive finale pas encore définitive. Utilise le détail live ci-dessus.
              </div>
            )}
          </div>
        </>
      )}

      {mode === "INTERVALLE" && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface)', marginTop: 20, marginBottom: 10 }}>
            Vue intervalle
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Début
              </label>
              <input className="input" type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
              <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4 }}>Ex : 2026-05</div>
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Fin
              </label>
              <input className="input" type="month" value={toMonth} onChange={(e) => setToMonth(e.target.value)} />
              <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4 }}>Ex : 2026-11</div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 4, marginBottom: 16 }}>
            Pour chaque mois : archives si existantes. Mois en cours = accès live. Mois terminé non archivé = bouton Générer.
          </div>

          {rangeMonths.map((m) => {
            const st = monthStatus(m);
            const a = archivesMap.get(m) || null;
            const fr = resolveFrigo(a);
            const lv = resolveLivraison(a);

            return (
              <div key={m} style={{ background: 'var(--surface)', borderRadius: 12, padding: 12, border: '1px solid var(--border)', marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ fontWeight: 700, color: 'var(--on-surface)', fontSize: 14 }}>{m}</div>
                  <div style={{ fontSize: 12, color: 'var(--on-surface-3)' }}>
                    {st === "FUTUR" && "Futur"}
                    {st === "EN_COURS" && "En cours"}
                    {st === "TERMINE" && (a ? <span style={{ color: 'var(--success)' }}>Archivé</span> : "Non archivé")}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <a className="btn-secondary" href={`/cuisine/temperatures?month=${m}`}>
                    Frigos détail
                  </a>
                  <a className="btn-secondary" href={`/cuisine/livraisons?month=${m}`}>
                    Livraison détail
                  </a>
                </div>

                {a && (
                  <>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <button className="btn-secondary" type="button" onClick={() => openStoragePath(fr?.pdfPath)}>
                        Frigos PDF
                      </button>
                      <button className="btn-secondary" type="button" onClick={() => openStoragePath(fr?.csvPath)}>
                        Frigos CSV
                      </button>
                      <button className="btn-secondary" type="button" onClick={() => openStoragePath(lv?.pdfPath)}>
                        Livraison PDF
                      </button>
                      <button className="btn-secondary" type="button" onClick={() => openStoragePath(lv?.csvPath)}>
                        Livraison CSV
                      </button>
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 6 }}>
                      Frigos : {fr?.rows ?? "—"} j, {fr?.alerts ?? "—"} alertes · Livraison : {lv?.rows ?? "—"} docs, {lv?.refus ?? "—"} refus
                    </div>
                  </>
                )}

                {!a && st === "TERMINE" && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="btn-primary" type="button" disabled={loading} onClick={() => generateMonth(m)}>
                      Générer ce mois
                    </button>
                  </div>
                )}

                {!a && st === "FUTUR" && (
                  <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 8 }}>
                    Mois futur : rien à archiver.
                  </div>
                )}

                {!a && st === "EN_COURS" && (
                  <div style={{ fontSize: 12, color: 'var(--on-surface-3)', marginTop: 8 }}>
                    Mois en cours : consulte les jours via "détail". Archive finale au 1er du mois suivant.
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
