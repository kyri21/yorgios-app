import { useState } from 'react'
import { Timestamp, collection, getDocs, orderBy, query } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { db } from '../../../firebase/config'

// ─── Types ────────────────────────────────────────────────────────
type TempDoc = {
  id: string; date: string; fridgeId: string; fridgeName: string
  session: string; tempC: number; status: string
}
type LivraisonDoc = {
  id: string; productName?: string; lotCode?: string; category?: string
  departTempC?: number; departAt?: any; receptionTempC?: number; receptionAt?: any; result?: string
}
type NCDoc = {
  id: string; livraisonId: string; productName?: string; lotCode?: string
  tempC?: number; decision?: string
}
type StockDoc = {
  id: string; productName?: string; dateAjout?: any; retireAt?: any
  fabricationAt?: any; dlcAt?: any
}
type HygieneDoc = {
  id: string; type: 'quotidien' | 'hebdo' | 'mensuel'
  items: Record<string, boolean>; createdAt?: any
}
type Report = {
  temperatures: TempDoc[]
  livraisons: LivraisonDoc[]
  nonConformites: NCDoc[]
  vitrineEntrees: StockDoc[]
  vitrineSorties: StockDoc[]
  hygiene: HygieneDoc[]
  dateFrom: string
  dateTo: string
}

// ─── Référentiels ──────────────────────────────────────────────────
const FRIDGES: { id: string; name: string }[] = [
  { id: 'FRIGO_3P',    name: 'Frigo 3P' },
  { id: 'VITRINE_1',   name: 'Vitrine 1' },
  { id: 'VITRINE_2',   name: 'Vitrine 2' },
  { id: 'VITRINE_3',   name: 'Vitrine 3' },
  { id: 'GRAND_FRIGO', name: 'Grand Frigo' },
]

const HYGIENE_ITEMS: Record<'quotidien' | 'hebdo' | 'mensuel', Array<{ id: string; label: string }>> = {
  quotidien: [
    { id: 'plats_service',    label: 'Plats de service' },
    { id: 'int_vitrines',     label: 'Int. vitrines' },
    { id: 'ustensiles',       label: 'Ustensiles' },
    { id: 'meuble_vente',     label: 'Meuble de vente' },
    { id: 'comptoir_balance', label: 'Comptoir / balance' },
    { id: 'micro_ondes',      label: 'Micro-ondes' },
    { id: 'evier_papier',     label: 'Évier / Papier' },
    { id: 'etiquettes',       label: 'Étiquettes' },
    { id: 'plan_travail',     label: 'Plan de travail' },
    { id: 'ext_placards',     label: 'Ext. placards' },
    { id: 'ext_frigo',        label: 'Ext. frigo' },
    { id: 'poubelle',         label: 'Poubelle' },
    { id: 'vitres',           label: 'Vitres' },
  ],
  hebdo: [
    { id: 'int_frigos',         label: 'Int. frigos' },
    { id: 'etageres_materiels', label: 'Étagères' },
    { id: 'support_papier',     label: 'Support papier' },
    { id: 'placard_hygiene',    label: 'Placard hygiène' },
    { id: 'machine_glacon',     label: 'Machine glaçons' },
  ],
  mensuel: [
    { id: 'placard_rangement', label: 'Placard rangement' },
  ],
}

const TYPE_LABELS: Record<string, string> = {
  quotidien: 'Quotidien', hebdo: 'Hebdomadaire', mensuel: 'Mensuel',
}

// ─── Helpers ──────────────────────────────────────────────────────
function todayISO() {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function nDaysAgoISO(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n)
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function fmtDate(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
function fmtTs(ts: any): string {
  if (!ts?.toDate) return '—'
  return ts.toDate().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtTsTime(ts: any): string {
  if (!ts?.toDate) return '—'
  const d = ts.toDate()
  return `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}
function daysInRange(from: string, to: string): string[] {
  const days: string[] = []
  const cur = new Date(from + 'T12:00:00')
  const end = new Date(to + 'T12:00:00')
  while (cur <= end) {
    const p = (n: number) => String(n).padStart(2, '0')
    days.push(`${cur.getFullYear()}-${p(cur.getMonth() + 1)}-${p(cur.getDate())}`)
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

// ─── Constructeurs de tableaux (partagés Excel + PDF) ────────────

// 1. Températures frigos — pivot : 1 ligne = 1 date, colonnes = frigo × session
function buildTempTable(report: Report): { head: string[]; rows: (string | number)[][] } {
  const head = ['Date']
  for (const f of FRIDGES) {
    head.push(`${f.name} Matin`, `${f.name} Soir`)
  }
  const allDays = daysInRange(report.dateFrom, report.dateTo)
  const rows = allDays.map(day => {
    const row: (string | number)[] = [fmtDate(day)]
    for (const f of FRIDGES) {
      for (const s of ['matin', 'soir']) {
        const t = report.temperatures.find(x => x.date === day && x.fridgeId === f.id && x.session === s)
        row.push(t != null ? t.tempC : '')
      }
    }
    return row
  })
  return { head, rows }
}

// 2. Hygiène — pivot : 1 ligne = 1 date, colonnes = items
function buildHygieneTable(report: Report, type: 'quotidien' | 'hebdo' | 'mensuel'): { head: string[]; rows: string[][] } {
  const items = HYGIENE_ITEMS[type]
  const head = ['Période', ...items.map(i => i.label)]
  const docs = report.hygiene
    .filter(h => h.type === type)
    .sort((a, b) => a.id.localeCompare(b.id))
  const rows = docs.map(h => {
    const period = h.id.split('_')[0]
    return [period, ...items.map(i => (h.items?.[i.id] ? '✓' : '✗'))]
  })
  return { head, rows }
}

// 3. Vitrine — 1 ligne = 1 produit, colonnes = Date ajout | Fabrication | DLC | Date sortie
function buildVitrineTable(report: Report): { head: string[]; rows: string[][] } {
  const head = ['Produit', 'Date ajout', 'Fabrication', 'DLC', 'Date sortie']
  // Fusionner entrées et sorties par id de produit
  const allIds = new Set([
    ...report.vitrineEntrees.map(s => s.id),
    ...report.vitrineSorties.map(s => s.id),
  ])
  const byId: Record<string, StockDoc> = {}
  for (const s of [...report.vitrineEntrees, ...report.vitrineSorties]) {
    if (!byId[s.id]) byId[s.id] = s
    else byId[s.id] = { ...byId[s.id], ...s }
  }
  const rows = Array.from(allIds).map(id => {
    const s = byId[id]
    return [
      s.productName || '—',
      fmtTs(s.dateAjout),
      fmtTs(s.fabricationAt),
      fmtTs(s.dlcAt),
      fmtTs(s.retireAt),
    ]
  })
  return { head, rows }
}

// 4. Livraisons — 1 ligne = 1 livraison, colonnes fixes
function buildLivraisonsTable(report: Report): { head: string[]; rows: string[][] } {
  const head = ['Produit', 'N° Lot', 'Catégorie', 'T° Départ (°C)', 'Date/Heure départ', 'T° Réception (°C)', 'Date/Heure réception', 'Résultat', 'Action corrective']
  const rows = report.livraisons.map(l => {
    const nc = report.nonConformites.find(n => n.livraisonId === l.id)
    return [
      l.productName || '—',
      l.lotCode || '—',
      l.category || '—',
      l.departTempC != null ? String(l.departTempC) : '—',
      fmtTsTime(l.departAt),
      l.receptionTempC != null ? String(l.receptionTempC) : 'Non saisie',
      fmtTsTime(l.receptionAt),
      l.result || '—',
      nc ? nc.decision || '—' : '—',
    ]
  })
  return { head, rows }
}

// ─── Export Excel ──────────────────────────────────────────────────
function exportExcel(report: Report) {
  const wb = XLSX.utils.book_new()
  const periodLabel = `${fmtDate(report.dateFrom)} au ${fmtDate(report.dateTo)}`

  function addSheet(name: string, head: string[], rows: (string | number)[][]) {
    const ws = XLSX.utils.aoa_to_sheet([
      [`Export Contrôle Hygiène Matias — ${name}`],
      [`Période : ${periodLabel}`],
      [],
      head,
      ...rows,
    ])
    XLSX.utils.book_append_sheet(wb, ws, name)
  }

  const temp = buildTempTable(report)
  addSheet('Températures frigos', temp.head, temp.rows)

  const hyqDaily = buildHygieneTable(report, 'quotidien')
  addSheet('Hygiène Quotidien', hyqDaily.head, hyqDaily.rows)

  const hyqHebdo = buildHygieneTable(report, 'hebdo')
  addSheet('Hygiène Hebdo', hyqHebdo.head, hyqHebdo.rows)

  const hyqMensuel = buildHygieneTable(report, 'mensuel')
  addSheet('Hygiène Mensuel', hyqMensuel.head, hyqMensuel.rows)

  const vit = buildVitrineTable(report)
  addSheet('Vitrine', vit.head, vit.rows)

  const liv = buildLivraisonsTable(report)
  addSheet('Livraisons', liv.head, liv.rows)

  XLSX.writeFile(wb, `controle_hygiene_${report.dateFrom}_${report.dateTo}.xlsx`)
}

// ─── Export PDF ────────────────────────────────────────────────────
const PDF_ORANGE = [232, 118, 10] as [number, number, number]
const PDF_DARK   = [30, 30, 30]  as [number, number, number]
const PDF_GRAY   = [120, 120, 120] as [number, number, number]

function exportPDF(report: Report) {
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4', unit: 'mm' })
  const periodLabel = `Période : ${fmtDate(report.dateFrom)} au ${fmtDate(report.dateTo)}`
  const pageW = doc.internal.pageSize.width

  function addSectionHeader(title: string, isFirstPage: boolean) {
    if (!isFirstPage) doc.addPage()
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...PDF_DARK)
    doc.text('Export Contrôle Hygiène Matias', pageW / 2, 12, { align: 'center' })
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...PDF_GRAY)
    doc.text(periodLabel, pageW / 2, 18, { align: 'center' })
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...PDF_ORANGE)
    doc.text(title, 14, 26)
    doc.setDrawColor(...PDF_ORANGE)
    doc.setLineWidth(0.5)
    doc.line(14, 28, pageW - 14, 28)
  }

  function addTable(title: string, head: string[], rows: (string | number)[][], isFirst: boolean) {
    addSectionHeader(title, isFirst)
    autoTable(doc, {
      head: [head],
      body: rows,
      startY: 32,
      styles: { fontSize: 7.5, cellPadding: 2, overflow: 'linebreak' },
      headStyles: {
        fillColor: PDF_ORANGE,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
      },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      margin: { left: 14, right: 14 },
      didDrawPage: (data) => {
        // Footer
        const pageNum = (doc as any).internal.getCurrentPageInfo().pageNumber
        doc.setFontSize(7)
        doc.setTextColor(...PDF_GRAY)
        doc.text(`Page ${pageNum}`, pageW / 2, doc.internal.pageSize.height - 5, { align: 'center' })
      },
    })
  }

  const temp  = buildTempTable(report)
  const hyqD  = buildHygieneTable(report, 'quotidien')
  const hyqH  = buildHygieneTable(report, 'hebdo')
  const hyqM  = buildHygieneTable(report, 'mensuel')
  const vit   = buildVitrineTable(report)
  const liv   = buildLivraisonsTable(report)

  addTable('🌡️ Températures frigos',        temp.head, temp.rows, true)
  addTable('✅ Hygiène Quotidien',           hyqD.head, hyqD.rows, false)
  addTable('✅ Hygiène Hebdomadaire',        hyqH.head, hyqH.rows, false)
  addTable('✅ Hygiène Mensuel',             hyqM.head, hyqM.rows, false)
  addTable('🫙 Vitrine',                     vit.head,  vit.rows,  false)
  addTable('🚚 Températures livraisons',     liv.head,  liv.rows,  false)

  doc.save(`controle_hygiene_${report.dateFrom}_${report.dateTo}.pdf`)
}

// ─── Composant principal ──────────────────────────────────────────
export default function Controle() {
  const [dateFrom, setDateFrom] = useState(nDaysAgoISO(6))
  const [dateTo, setDateTo]     = useState(todayISO())
  const [report, setReport]     = useState<Report | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function generateReport() {
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      setError('Dates invalides')
      return
    }
    setError(null)
    setGenerating(true)
    setReport(null)
    try {
      const tsFrom = Timestamp.fromDate(new Date(dateFrom + 'T00:00:00'))
      const tsTo   = Timestamp.fromDate(new Date(dateTo + 'T23:59:59'))

      const tempSnap = await getDocs(
        query(collection(db, 'temperatures'), orderBy('date', 'asc'))
      )
      const temperatures: TempDoc[] = tempSnap.docs
        .filter(d => {
          const date = (d.data() as any).date as string
          return date >= dateFrom && date <= dateTo
        })
        .map(d => ({ id: d.id, ...(d.data() as any) } as TempDoc))

      const livSnap = await getDocs(
        query(collection(db, 'livraisons'), orderBy('departAt', 'asc'))
      )
      const livraisons: LivraisonDoc[] = livSnap.docs
        .filter(d => {
          const departAt = (d.data() as any).departAt
          if (!departAt?.toMillis) return false
          const ms = departAt.toMillis()
          return ms >= tsFrom.toMillis() && ms <= tsTo.toMillis()
        })
        .map(d => ({ id: d.id, ...(d.data() as any) } as LivraisonDoc))

      const livraisonIds = new Set(livraisons.map(l => l.id))
      const ncSnap = await getDocs(collection(db, 'non_conformites'))
      const nonConformites: NCDoc[] = ncSnap.docs
        .filter(d => livraisonIds.has((d.data() as any).livraisonId))
        .map(d => ({ id: d.id, ...(d.data() as any) } as NCDoc))

      const stockSnap = await getDocs(collection(db, 'corner_stock'))
      const vitrineEntrees: StockDoc[] = stockSnap.docs
        .filter(d => {
          const ms = (d.data() as any).dateAjout?.toMillis?.()
          return ms != null && ms >= tsFrom.toMillis() && ms <= tsTo.toMillis()
        })
        .map(d => ({ id: d.id, ...(d.data() as any) } as StockDoc))

      const vitrineSorties: StockDoc[] = stockSnap.docs
        .filter(d => {
          const ms = (d.data() as any).retireAt?.toMillis?.()
          return ms != null && ms >= tsFrom.toMillis() && ms <= tsTo.toMillis()
        })
        .map(d => ({ id: d.id, ...(d.data() as any) } as StockDoc))

      const hygSnap = await getDocs(
        query(collection(db, 'hygiene_corner'), orderBy('__name__', 'asc'))
      )
      const hygiene: HygieneDoc[] = hygSnap.docs
        .filter(d => {
          // Doc ID formats: YYYY-MM-DD_quotidien | YYYY-WXX_hebdo | YYYY-MM_mensuel
          const parts = d.id.split('_')
          const datePart = parts[0] // YYYY-MM-DD or YYYY-WXX or YYYY-MM
          // For quotidien: direct ISO date comparison
          if (datePart.length === 10) return datePart >= dateFrom && datePart <= dateTo
          // For mensuel YYYY-MM: check if month overlaps the range
          if (/^\d{4}-\d{2}$/.test(datePart)) {
            const monthStart = datePart + '-01'
            const monthEnd = datePart + '-31'
            return monthEnd >= dateFrom && monthStart <= dateTo
          }
          // For hebdo YYYY-WXX: extract year and include if year matches
          if (/^\d{4}-W\d{2}$/.test(datePart)) {
            return datePart.slice(0, 4) >= dateFrom.slice(0, 4) && datePart.slice(0, 4) <= dateTo.slice(0, 4)
          }
          return true
        })
        .map(d => {
          const data = d.data() as any
          // Derive type from doc ID if not stored
          const idSuffix = d.id.split('_').slice(1).join('_')
          const type = data.type || (idSuffix.includes('hebdo') ? 'hebdo' : idSuffix.includes('mensuel') ? 'mensuel' : 'quotidien')
          return { id: d.id, ...data, type } as HygieneDoc
        })

      setReport({ temperatures, livraisons, nonConformites, vitrineEntrees, vitrineSorties, hygiene, dateFrom, dateTo })
    } catch (e: any) {
      setError(e?.message || 'Erreur lors de la génération')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="page">
      <div>
        <p className="section-label" style={{ marginBottom: 2 }}>Corner</p>
        <h1 style={{ fontFamily: 'Epilogue, sans-serif', fontSize: 24, fontWeight: 800, color: 'var(--on-surface)', letterSpacing: '-0.03em', margin: 0 }}>
          Contrôle & Archives
        </h1>
        <p style={{ fontSize: 13, color: 'var(--on-surface-3)', margin: '4px 0 0', fontFamily: 'Manrope, sans-serif' }}>
          Génère le rapport sur une période, puis exporte en Excel ou PDF.
        </p>
      </div>

      {/* Date pickers + bouton générer */}
      <div className="card space-y-3" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', display: 'block', marginBottom: 4 }}>DU</label>
            <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', display: 'block', marginBottom: 4 }}>AU</label>
            <input type="date" className="input" value={dateTo} max={todayISO()} onChange={e => setDateTo(e.target.value)} />
          </div>
        </div>
        <button onClick={generateReport} disabled={generating} className="btn-primary">
          {generating
            ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <div className="spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} />
                Génération…
              </span>
            : '📋 Générer le rapport'}
        </button>
      </div>

      {error && (
        <div style={{ background: 'rgba(136,0,20,0.1)', border: '1px solid rgba(136,0,20,0.3)', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: 'var(--danger)', marginBottom: 16 }}>
          ⚠️ {error}
        </div>
      )}

      {report && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* En-tête récap */}
          <div style={{ background: 'var(--surface-mid)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)', letterSpacing: '0.05em' }}>RAPPORT HYGIÈNE</div>
            <div style={{ fontSize: 13, color: 'var(--on-surface)', marginTop: 4, fontWeight: 600 }}>
              {fmtDate(report.dateFrom)} → {fmtDate(report.dateTo)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 10, flexWrap: 'wrap' }}>
              <Stat label="Relevés temp." value={report.temperatures.length} />
              <Stat label="Livraisons" value={report.livraisons.length} />
              <Stat label="Mouvements vitrine" value={report.vitrineEntrees.length + report.vitrineSorties.length} />
              <Stat label="Checklists" value={report.hygiene.length} />
            </div>
          </div>

          {/* Alertes rapides */}
          {(() => {
            const tempAlertes = report.temperatures.filter(t => t.status === 'ALERTE')
            const livraisonsNC = report.nonConformites.length
            const missing = daysInRange(report.dateFrom, report.dateTo)
              .filter(d => !report.temperatures.some(t => t.date === d))
            if (tempAlertes.length === 0 && livraisonsNC === 0 && missing.length === 0) return null
            return (
              <div style={{ background: 'rgba(136,0,20,0.08)', border: '1px solid rgba(136,0,20,0.3)', borderRadius: 12, padding: '12px 16px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)', marginBottom: 6 }}>⚠️ Points d'attention</div>
                {tempAlertes.length > 0 && <div style={{ fontSize: 12, color: 'var(--danger)' }}>• {tempAlertes.length} alerte(s) température frigos</div>}
                {livraisonsNC > 0 && <div style={{ fontSize: 12, color: 'var(--danger)' }}>• {livraisonsNC} non-conformité(s) livraison</div>}
                {missing.length > 0 && <div style={{ fontSize: 12, color: 'var(--warning)' }}>• {missing.length} jour(s) sans relevé température : {missing.map(fmtDate).join(', ')}</div>}
              </div>
            )
          })()}

          {/* Boutons export */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button
              onClick={() => exportExcel(report)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '13px', borderRadius: 12, border: '1px solid rgba(84,101,30,0.4)',
                background: 'rgba(84,101,30,0.1)', color: 'var(--success)',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              📊 Exporter Excel
            </button>
            <button
              onClick={() => exportPDF(report)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '13px', borderRadius: 12, border: '1px solid rgba(0,66,117,0.35)',
                background: 'rgba(0,66,117,0.08)', color: 'var(--primary)',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              📄 Exporter PDF
            </button>
          </div>

          {/* Aperçu par section */}
          <ReportSection icon="🌡️" title="Températures frigos" count={report.temperatures.length}>
            {report.temperatures.length === 0
              ? <EmptyState text="Aucun relevé" />
              : <PreviewTable {...buildTempTable(report)} maxRows={5} />
            }
          </ReportSection>

          <ReportSection icon="✅" title="Hygiène" count={report.hygiene.length}>
            {(['quotidien', 'hebdo', 'mensuel'] as const).map(type => {
              const t = buildHygieneTable(report, type)
              if (t.rows.length === 0) return null
              return (
                <div key={type} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-3)', marginBottom: 6, textTransform: 'uppercase' }}>
                    {TYPE_LABELS[type]}
                  </div>
                  <PreviewTable head={t.head} rows={t.rows} maxRows={3} />
                </div>
              )
            })}
            {report.hygiene.length === 0 && <EmptyState text="Aucune checklist" />}
          </ReportSection>

          <ReportSection icon="🫙" title="Vitrine" count={report.vitrineEntrees.length + report.vitrineSorties.length}>
            {report.vitrineEntrees.length === 0 && report.vitrineSorties.length === 0
              ? <EmptyState text="Aucun mouvement" />
              : <PreviewTable {...buildVitrineTable(report)} maxRows={5} />
            }
          </ReportSection>

          <ReportSection icon="🚚" title="Livraisons" count={report.livraisons.length}>
            {report.livraisons.length === 0
              ? <EmptyState text="Aucune livraison" />
              : <PreviewTable {...buildLivraisonsTable(report)} maxRows={5} />
            }
          </ReportSection>

          <div style={{ height: 8 }} />
        </div>
      )}
    </div>
  )
}

// ─── Sous-composants UI ───────────────────────────────────────────
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--on-surface)' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--on-surface-3)' }}>{label}</div>
    </div>
  )
}

function ReportSection({ icon, title, count, children }: {
  icon: string; title: string; count: number; children: React.ReactNode
}) {
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)', flex: 1 }}>{title}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-3)', background: 'var(--surface-mid)', padding: '2px 8px', borderRadius: 20, border: '1px solid var(--border)' }}>
          {count}
        </span>
      </div>
      {children}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ fontSize: 13, color: 'var(--on-surface-3)', textAlign: 'center', padding: '12px 0' }}>{text}</div>
}

// Aperçu tableau tronqué (max N lignes + "... et X de plus")
function PreviewTable({ head, rows, maxRows }: { head: string[]; rows: (string | number)[][]; maxRows: number }) {
  const shown = rows.slice(0, maxRows)
  const rest = rows.length - shown.length
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} style={{
                padding: '6px 8px', textAlign: 'left', fontWeight: 700,
                color: 'var(--primary)', background: 'rgba(0,66,117,0.08)',
                borderBottom: '1px solid rgba(0,66,117,0.20)',
                whiteSpace: 'nowrap',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  padding: '5px 8px',
                  borderBottom: '1px solid var(--border)',
                  whiteSpace: 'nowrap',
                  color: cell === '✗' ? 'var(--danger)' : cell === '✓' ? 'var(--success)' : 'var(--on-surface)',
                } as any}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rest > 0 && (
        <div style={{ fontSize: 11, color: 'var(--on-surface-3)', textAlign: 'center', padding: '8px 0' }}>
          … et {rest} ligne{rest > 1 ? 's' : ''} de plus (visible dans l'export)
        </div>
      )}
    </div>
  )
}
