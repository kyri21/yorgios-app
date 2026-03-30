import { useState, useEffect } from 'react';
import { collection, getDocs, updateDoc, doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';

const ALLERGENES_LIST = [
  'Gluten', 'Crustacés', 'Œufs', 'Poisson', 'Arachides', 'Soja', 'Lait',
  'Fruits à coque', 'Céleri', 'Moutarde', 'Graines de sésame',
  'Anhydride sulfureux', 'Lupin', 'Mollusques', 'Ail',
];

const ALLERGENES_SHORT = [
  'Gluten', 'Crustacés', 'Œufs', 'Poisson', 'Arachides', 'Soja', 'Lait',
  'Fruits à coque', 'Céleri', 'Moutarde', 'Sésame', 'SO₂', 'Lupin', 'Mollusques', 'Ail',
];

type Produit = {
  id: string;
  name: string;
  allergenes?: string[];
  inMenu?: boolean;
  active?: boolean;
};

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 12mm 10mm; }
  body * { visibility: hidden !important; }
  #allergen-print-zone, #allergen-print-zone * { visibility: visible !important; }
  #allergen-print-zone {
    display: block !important;
    position: absolute !important;
    top: 0; left: 0;
    width: 100%;
    background: white !important;
  }
  .allergen-print-table {
    width: 100%;
    border-collapse: collapse;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9pt;
    color: #000 !important;
  }
  .allergen-print-table th,
  .allergen-print-table td {
    border: 1px solid #444;
    padding: 2px;
    text-align: center;
    vertical-align: bottom;
    color: #000 !important;
    background: white !important;
  }
  .allergen-print-table td.product-name {
    text-align: left;
    padding: 3px 5px;
    font-size: 9pt;
    font-weight: 600;
    white-space: nowrap;
    max-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .allergen-print-table th.allergen-header {
    width: 18px;
    min-width: 18px;
    max-width: 18px;
    padding: 2px 1px;
  }
  .allergen-header-rotate {
    display: block;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-size: 8pt;
    font-weight: 700;
    white-space: nowrap;
    height: 90px;
    line-height: 1;
    text-align: left;
  }
  .allergen-check { font-size: 12pt; font-weight: 900; color: #1a1a1a !important; }
  .print-header { margin-bottom: 8mm; }
  .print-title { font-size: 18pt; font-weight: 900; font-family: Arial, sans-serif; margin: 0; color: #000; }
  .print-subtitle { font-size: 10pt; font-family: Arial, sans-serif; color: #333; margin: 2px 0 0 0; }
  .print-legend { font-size: 8pt; font-family: Arial, sans-serif; color: #333; margin-top: 5mm; }
  .print-note { font-size: 7.5pt; font-family: Arial, sans-serif; color: #555; margin-top: 3mm; font-style: italic; }
  .no-print { display: none !important; }
  /* Pagination */
  .allergen-print-table thead { display: table-header-group; }
  .allergen-print-table tbody tr { page-break-inside: avoid; break-inside: avoid; }
  .allergen-print-table tfoot { display: table-footer-group; }
}
`;

function autoAbrv(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'PROD';
}

export default function AllergeneMenu() {
  const [produits, setProduits] = useState<Produit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Set<string>>(new Set());

  // Formulaire ajout
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAllergenes, setNewAllergenes] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Formulaire édition allergènes
  const [editId, setEditId] = useState<string | null>(null);
  const [editAllergenes, setEditAllergenes] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = PRINT_CSS;
    style.id = 'allergen-print-style';
    document.head.appendChild(style);
    return () => { document.getElementById('allergen-print-style')?.remove(); };
  }, []);

  async function load() {
    setLoading(true);
    const snap = await getDocs(collection(db, 'produits'));
    const list = snap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) } as Produit))
      .filter(p => p.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    setProduits(list);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function toggleMenu(p: Produit) {
    const next = !p.inMenu;
    setSaving(prev => new Set(prev).add(p.id));
    setProduits(prev => prev.map(x => x.id === p.id ? { ...x, inMenu: next } : x));
    await updateDoc(doc(db, 'produits', p.id), { inMenu: next });
    setSaving(prev => { const s = new Set(prev); s.delete(p.id); return s; });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    if (!newName.trim()) { setAddError('Le nom est obligatoire.'); return; }
    setAdding(true);
    try {
      const ref = doc(collection(db, 'produits'));
      await setDoc(ref, {
        name: newName.trim(),
        abrv: autoAbrv(newName),
        defaultCategory: 'PLAT_CUISINE',
        dlcDays: 3,
        allergenes: newAllergenes,
        active: true,
        inMenu: true,
        createdAt: Timestamp.now(),
      });
      setNewName('');
      setNewAllergenes([]);
      setShowForm(false);
      await load();
    } catch (err: any) {
      setAddError(err?.message || 'Erreur');
    } finally {
      setAdding(false);
    }
  }

  function toggleNewAllergen(a: string) {
    setNewAllergenes(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]);
  }

  function openEdit(p: Produit) {
    setEditId(p.id);
    setEditAllergenes(p.allergenes ?? []);
  }

  async function saveEdit() {
    if (!editId) return;
    setEditSaving(true);
    await updateDoc(doc(db, 'produits', editId), { allergenes: editAllergenes });
    setProduits(prev => prev.map(p => p.id === editId ? { ...p, allergenes: editAllergenes } : p));
    setEditId(null);
    setEditSaving(false);
  }

  function toggleEditAllergen(a: string) {
    setEditAllergenes(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]);
  }

  const enVente = produits.filter(p => p.inMenu);
  const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--surface-mid)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '10px 12px',
    color: '#fff', fontSize: 15, outline: 'none',
  };

  return (
    <div style={{ padding: '16px', maxWidth: 700, margin: '0 auto' }}>

      {/* Header */}
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--on-surface)', margin: 0 }}>Fiche Allergènes</h1>
          <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: '4px 0 0' }}>
            {enVente.length} produit{enVente.length !== 1 ? 's' : ''} en vente · Cochez ceux du moment puis imprimez
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => { setShowForm(v => !v); setAddError(null); }}
            style={{
              background: showForm ? 'var(--surface-mid)' : 'rgba(0,66,117,0.10)',
              color: showForm ? 'var(--primary)' : 'rgba(255,255,255,0.7)',
              border: `1px solid ${showForm ? 'rgba(0,66,117,0.30)' : 'rgba(0,66,117,0.12)'}`,
              borderRadius: 10, padding: '10px 16px',
              fontWeight: 600, fontSize: 14, cursor: 'pointer',
            }}
          >
            {showForm ? '✕ Annuler' : '+ Nouveau produit'}
          </button>
          <button
            onClick={() => window.print()}
            disabled={enVente.length === 0}
            style={{
              background: enVente.length === 0 ? 'var(--surface-mid)' : 'var(--primary)',
              color: enVente.length === 0 ? 'rgba(255,255,255,0.3)' : '#fff',
              border: 'none', borderRadius: 10, padding: '10px 20px',
              fontWeight: 700, fontSize: 15, cursor: enVente.length === 0 ? 'default' : 'pointer',
            }}
          >
            🖨️ Imprimer ({enVente.length})
          </button>
        </div>
      </div>

      {/* ── Formulaire ajout ── */}
      {showForm && (
        <div className="no-print" style={{ background: 'var(--surface-low)', border: '1px solid rgba(0,66,117,0.20)', borderRadius: 14, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Nouveau produit
          </div>
          <form onSubmit={handleAdd}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Nom du produit *
            </label>
            <input
              style={inputStyle}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Ex : Moussaka, Salade grecque…"
              autoFocus
            />

            <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 10, marginTop: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Allergènes contenus
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
              {ALLERGENES_LIST.map(a => {
                const on = newAllergenes.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => toggleNewAllergen(a)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: on ? 'rgba(0,66,117,0.08)' : 'var(--surface-mid)',
                      border: `1px solid ${on ? 'rgba(0,66,117,0.35)' : 'rgba(0,66,117,0.10)'}`,
                      borderRadius: 8, padding: '8px 10px',
                      cursor: 'pointer', textAlign: 'left',
                      transition: 'all 0.15s',
                    }}
                  >
                    <span style={{
                      width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                      background: on ? 'var(--primary)' : 'transparent',
                      border: `2px solid ${on ? 'var(--primary)' : 'rgba(255,255,255,0.2)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 900, color: '#fff',
                    }}>{on ? '✓' : ''}</span>
                    <span style={{ fontSize: 13, color: on ? '#fff' : 'rgba(255,255,255,0.55)', fontWeight: on ? 600 : 400 }}>{a}</span>
                  </button>
                );
              })}
            </div>

            {newAllergenes.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {newAllergenes.map(a => (
                  <span key={a} style={{ background: 'rgba(0,66,117,0.12)', color: 'var(--primary)', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>{a}</span>
                ))}
              </div>
            )}

            {addError && (
              <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(136,0,20,0.12)', border: '1px solid rgba(136,0,20,0.25)', borderRadius: 8, fontSize: 13, color: 'var(--danger)' }}>
                {addError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                type="submit"
                disabled={adding}
                style={{
                  background: 'var(--primary)', color: '#fff', border: 'none',
                  borderRadius: 10, padding: '10px 20px',
                  fontWeight: 700, fontSize: 14, cursor: adding ? 'default' : 'pointer',
                  opacity: adding ? 0.7 : 1,
                }}
              >
                {adding ? 'Enregistrement…' : 'Ajouter le produit'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Modal édition allergènes ── */}
      {editId && (
        <>
          <div onClick={() => setEditId(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: 'var(--surface-low)', border: '1px solid var(--border)', borderRadius: 16,
            padding: 20, zIndex: 101, width: 'min(520px, 94vw)', maxHeight: '90vh', overflowY: 'auto',
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
              Modifier les allergènes
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 16 }}>
              {produits.find(p => p.id === editId)?.name}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
              {ALLERGENES_LIST.map(a => {
                const on = editAllergenes.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => toggleEditAllergen(a)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: on ? 'rgba(0,66,117,0.08)' : 'var(--surface-mid)',
                      border: `1px solid ${on ? 'rgba(0,66,117,0.35)' : 'rgba(0,66,117,0.10)'}`,
                      borderRadius: 8, padding: '8px 10px',
                      cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                    }}
                  >
                    <span style={{
                      width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                      background: on ? 'var(--primary)' : 'transparent',
                      border: `2px solid ${on ? 'var(--primary)' : 'rgba(255,255,255,0.2)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 900, color: '#fff',
                    }}>{on ? '✓' : ''}</span>
                    <span style={{ fontSize: 13, color: on ? '#fff' : 'rgba(255,255,255,0.55)', fontWeight: on ? 600 : 400 }}>{a}</span>
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                onClick={saveEdit}
                disabled={editSaving}
                style={{
                  background: 'var(--primary)', color: '#fff', border: 'none',
                  borderRadius: 10, padding: '10px 20px',
                  fontWeight: 700, fontSize: 14, cursor: editSaving ? 'default' : 'pointer',
                  opacity: editSaving ? 0.7 : 1,
                }}
              >
                {editSaving ? 'Sauvegarde…' : 'Enregistrer'}
              </button>
              <button
                onClick={() => setEditId(null)}
                style={{
                  background: 'var(--surface-mid)', color: 'var(--on-surface-3)', border: '1px solid var(--border)',
                  borderRadius: 10, padding: '10px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                }}
              >
                Annuler
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Liste produits ── */}
      {loading ? (
        <div className="no-print" style={{ color: 'var(--on-surface-3)', padding: 24, textAlign: 'center' }}>Chargement…</div>
      ) : (
        <div className="no-print" style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--on-surface-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {produits.length} produits actifs
            </span>
            <button
              onClick={() => {
                const allOn = produits.every(p => p.inMenu);
                const next = !allOn;
                setProduits(prev => prev.map(p => ({ ...p, inMenu: next })));
                Promise.all(produits.map(p => updateDoc(doc(db, 'produits', p.id), { inMenu: next })));
              }}
              style={{ fontSize: 11, color: 'var(--on-surface-3)', background: 'var(--surface-mid)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}
            >
              {produits.every(p => p.inMenu) ? 'Tout décocher' : 'Tout cocher'}
            </button>
          </div>

          {produits.map((p, i) => (
            <div
              key={p.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px 10px 16px',
                borderBottom: i < produits.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                background: p.inMenu ? 'rgba(0,66,117,0.05)' : 'transparent',
                transition: 'background 0.15s',
                opacity: saving.has(p.id) ? 0.6 : 1,
              }}
            >
              {/* Checkbox */}
              <div
                onClick={() => toggleMenu(p)}
                style={{
                  width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                  background: p.inMenu ? 'var(--primary)' : 'transparent',
                  border: `2px solid ${p.inMenu ? 'var(--primary)' : 'rgba(255,255,255,0.2)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 900, color: '#fff',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {p.inMenu ? '✓' : ''}
              </div>

              {/* Nom + badges — cliquable pour toggle */}
              <div onClick={() => toggleMenu(p)} style={{ flex: 1, cursor: 'pointer', minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: p.inMenu ? 600 : 400, color: p.inMenu ? '#fff' : 'rgba(255,255,255,0.6)' }}>
                  {p.name}
                </span>
                {p.allergenes && p.allergenes.length > 0 ? (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                    {p.allergenes.map(a => (
                      <span key={a} style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
                        background: p.inMenu ? 'rgba(0,66,117,0.12)' : 'rgba(255,255,255,0.07)',
                        color: p.inMenu ? 'var(--primary)' : 'rgba(255,255,255,0.35)',
                      }}>{a}</span>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic', marginTop: 2 }}>aucun allergène</div>
                )}
              </div>

              {/* Bouton modifier allergènes */}
              <button
                onClick={e => { e.stopPropagation(); openEdit(p); }}
                title="Modifier les allergènes"
                style={{
                  background: 'var(--surface-mid)', border: '1px solid rgba(0,66,117,0.10)',
                  borderRadius: 8, padding: '5px 10px', cursor: 'pointer',
                  fontSize: 12, color: 'rgba(255,255,255,0.4)', flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                ✏️ Allergènes
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── ZONE D'IMPRESSION ── */}
      <div id="allergen-print-zone" style={{ display: 'none' }}>
        <div className="print-header">
          <p className="print-title">Yorgios — Fiche Allergènes</p>
          <p className="print-subtitle">Mise à jour le {today} · {enVente.length} produit{enVente.length !== 1 ? 's' : ''} en vente</p>
        </div>

        <table className="allergen-print-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '4px 6px', fontSize: '10pt', fontWeight: 900, width: '38%', borderBottom: '2px solid #000' }}>
                Produit
              </th>
              {ALLERGENES_SHORT.map(a => (
                <th key={a} className="allergen-header">
                  <span className="allergen-header-rotate">{a}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {enVente.map((p, i) => (
              <tr key={p.id} style={{ background: i % 2 === 0 ? '#fff' : '#f7f7f7' }}>
                <td className="product-name">{p.name}</td>
                {ALLERGENES_LIST.map(a => (
                  <td key={a}>
                    {p.allergenes?.includes(a)
                      ? <span className="allergen-check">✓</span>
                      : <span style={{ color: '#ccc', fontSize: '9pt' }}>·</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <p className="print-legend">✓ = allergène présent dans le produit</p>
        <p className="print-note">
          Les 14 allergènes majeurs (règlement INCO n°1169/2011) — Cette liste est indicative et établie sur la base des informations fournisseurs.
          En cas d'allergie sévère, demandez conseil à notre équipe.
        </p>
      </div>
    </div>
  );
}
