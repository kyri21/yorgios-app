import React, { useState, useRef, useCallback } from 'react'
import type { Employee, WeekDraft } from '../../types'
import {
  parseCSV, parseICS, buildWeekImports, countSlots,
  type ImportRow, type WeekImport,
} from '../../utils/importParsers'
import { saveWeek, loadWeek, emptyWeekDraft } from '../../firebase/planning'
import { PlanningGrid } from '../Grid/PlanningGrid'

interface Props {
  employees: Employee[]
  currentWeekId: string
  uid: string
  onImported: (affectedWeekIds: string[]) => void
  onClose: () => void
}

type Step = 'upload' | 'resolve' | 'preview' | 'preview-grid' | 'importing' | 'done'

interface FileEntry {
  name: string
  rows: ImportRow[]
  errors: string[]
  unknownNames: string[]
}

export function ImportModal({ employees, currentWeekId, uid, onImported, onClose }: Props) {
  const [step, setStep]               = useState<Step>('upload')
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([])
  const [nameMap, setNameMap]         = useState<Record<string, string>>({})
  const [weekImports, setWeekImports] = useState<WeekImport[]>([])
  const [mergeMode, setMergeMode]     = useState<'merge' | 'replace'>('replace')
  const [isDragging, setIsDragging]   = useState(false)
  const [progress, setProgress]       = useState({ done: 0, total: 0 })

  const [previewDrafts, setPreviewDrafts]               = useState<Record<string, WeekDraft>>({})
  const [loadingPreview, setLoadingPreview]             = useState(false)
  const [selectedPreviewIdx, setSelectedPreviewIdx]     = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const byId = Object.fromEntries(employees.map(e => [e.id, e]))

  const allUnknown = [...new Set(fileEntries.flatMap(f => f.unknownNames))]
  const allErrors  = fileEntries.flatMap(f => f.errors.map(e => `[${f.name}] ${e}`))

  async function processFile(file: File): Promise<FileEntry> {
    const text = await file.text()
    return file.name.endsWith('.ics')
      ? { name: file.name, ...parseICS(text, employees) }
      : { name: file.name, ...parseCSV(text, employees) }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const entries: FileEntry[] = []
    for (const f of Array.from(files)) entries.push(await processFile(f))
    setFileEntries(entries)
    if (entries.some(e => e.unknownNames.length > 0)) {
      setStep('resolve')
    } else {
      buildPreview(entries, {})
    }
  }

  function buildPreview(entries: FileEntry[], nm: Record<string, string>) {
    const imports = buildWeekImports(entries.flatMap(e => e.rows), employees, nm)
    setWeekImports(imports)
    setSelectedPreviewIdx(0)
    setStep('preview')
  }

  async function enterPreviewGrid() {
    setStep('preview-grid')
    setLoadingPreview(true)
    setSelectedPreviewIdx(0)

    const existingDrafts = await Promise.all(weekImports.map(w => loadWeek(w.monday)))

    const previews: Record<string, WeekDraft> = {}
    weekImports.forEach(({ monday, weekId, draft: importDraft }, i) => {
      if (mergeMode === 'replace') {
        const importedEmpIds = new Set<string>()
        for (let d = 0; d < 7; d++)
          Object.values(importDraft[d]?.hours ?? {}).forEach(ids => ids.forEach(id => importedEmpIds.add(id)))

        const merged = emptyWeekDraft()
        for (let d = 0; d < 7; d++) {
          const hours: Record<string, string[]> = {}
          const existingHours = existingDrafts[i][d]?.hours ?? {}
          Object.keys(existingHours).forEach(h => {
            hours[h] = existingHours[h].filter(id => !importedEmpIds.has(id))
          })
          Object.entries(importDraft[d]?.hours ?? {}).forEach(([h, ids]) => {
            hours[h] = [...(hours[h] ?? []), ...ids]
          })
          merged[d] = { dayIndex: d, hours }
        }
        previews[weekId] = merged
      } else {
        const merged = emptyWeekDraft()
        for (let d = 0; d < 7; d++) {
          const hours: Record<string, string[]> = {}
          const existing = existingDrafts[i][d]?.hours ?? {}
          Object.keys(existing).forEach(h => { hours[h] = [...existing[h]] })
          Object.entries(importDraft[d]?.hours ?? {}).forEach(([h, ids]) => {
            const current = hours[h] ?? []
            ids.forEach(id => { if (!current.includes(id)) current.push(id) })
            hours[h] = current
          })
          merged[d] = { dayIndex: d, hours }
        }
        previews[weekId] = merged
      }
    })

    setPreviewDrafts(previews)
    setLoadingPreview(false)
  }

  async function doImport() {
    setStep('importing')
    setProgress({ done: 0, total: weekImports.length })
    const affected: string[] = []

    const hasPreviews = Object.keys(previewDrafts).length > 0

    for (let i = 0; i < weekImports.length; i++) {
      const { monday, weekId: wid, draft: importDraft } = weekImports[i]
      let finalDraft: WeekDraft

      if (hasPreviews && previewDrafts[wid]) {
        finalDraft = previewDrafts[wid]
      } else {
        if (mergeMode === 'replace') {
          const existing = await loadWeek(monday)
          const importedEmpIds = new Set<string>()
          for (let d = 0; d < 7; d++)
            Object.values(importDraft[d]?.hours ?? {}).forEach(ids => ids.forEach(id => importedEmpIds.add(id)))
          finalDraft = emptyWeekDraft()
          for (let d = 0; d < 7; d++) {
            const hours: Record<string, string[]> = {}
            Object.keys(existing[d]?.hours ?? {}).forEach(h => {
              hours[h] = (existing[d].hours[h] ?? []).filter(id => !importedEmpIds.has(id))
            })
            Object.entries(importDraft[d]?.hours ?? {}).forEach(([h, ids]) => {
              hours[h] = [...(hours[h] ?? []), ...ids]
            })
            finalDraft[d] = { dayIndex: d, hours }
          }
        } else {
          finalDraft = importDraft
        }
      }

      await saveWeek(monday, finalDraft, uid)
      affected.push(wid)
      setProgress({ done: i + 1, total: weekImports.length })
    }

    setStep('done')
    onImported(affected)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
  }, [employees])

  const modalWidth = step === 'preview-grid' ? 'min(92vw, 1000px)' : '520px'

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300,
    }} onClick={onClose}>
      <div
        style={{
          background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
          padding: '24px', width: modalWidth,
          maxHeight: step === 'preview-grid' ? '92vh' : '80vh',
          overflowY: step === 'preview-grid' ? 'hidden' : 'auto',
          boxShadow: '0 20px 48px rgba(28,28,24,0.14)',
          display: 'flex', flexDirection: 'column',
          transition: 'width 0.2s',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {(step === 'preview' || step === 'preview-grid') && (
              <button
                onClick={() => setStep(step === 'preview-grid' ? 'preview' : 'upload')}
                style={{ background: 'none', border: 'none', color: 'var(--on-surface-2)', fontSize: '14px', cursor: 'pointer' }}
              >
                ←
              </button>
            )}
            <div>
              <div style={{ color: 'var(--on-surface)', fontWeight: 700, fontSize: '15px', fontFamily: 'Epilogue, sans-serif' }}>
                {step === 'upload'       && '📥 Importer un planning'}
                {step === 'resolve'      && '🔗 Associer les noms'}
                {step === 'preview'      && '📋 Récapitulatif'}
                {step === 'preview-grid' && '🔍 Aperçu de la grille'}
                {step === 'importing'    && '⏳ Importation…'}
                {step === 'done'         && '✅ Import terminé'}
              </div>
              {step === 'preview-grid' && weekImports.length > 0 && (
                <div style={{ color: 'var(--on-surface-2)', fontSize: '11px', marginTop: '2px' }}>
                  Résultat final après import ({mergeMode === 'replace' ? 'remplacement' : 'fusion'})
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--on-surface-3)', fontSize: '18px', cursor: 'pointer', flexShrink: 0 }}>✕</button>
        </div>

        {/* ── Étape 1 : Upload ─────────────────────────────────────── */}
        {step === 'upload' && (
          <div style={{ overflowY: 'auto' }}>
            <div
              onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: '12px', padding: '32px 16px', textAlign: 'center',
                cursor: 'pointer', background: isDragging ? 'rgba(0,66,117,0.04)' : 'var(--surface-low)',
                transition: 'all 0.15s', marginBottom: '16px',
              }}
            >
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>📂</div>
              <div style={{ color: 'var(--on-surface)', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                Déposer vos fichiers ici
              </div>
              <div style={{ color: 'var(--on-surface-2)', fontSize: '11px' }}>
                CSV (.csv) ou ICS (.ics) — plusieurs fichiers acceptés
              </div>
              <input ref={inputRef} type="file" accept=".csv,.ics" multiple style={{ display: 'none' }}
                onChange={e => handleFiles(e.target.files)} />
            </div>

            <details style={{ marginBottom: '12px' }}>
              <summary style={{ color: 'var(--on-surface-2)', fontSize: '11px', cursor: 'pointer', userSelect: 'none' }}>
                ℹ️ Format CSV attendu
              </summary>
              <div style={{ marginTop: '8px', background: 'var(--surface-low)', borderRadius: '8px', padding: '10px 12px', fontFamily: 'monospace', fontSize: '10px', color: 'var(--on-surface-2)', lineHeight: 1.8 }}>
                <div style={{ color: 'var(--on-surface-3)' }}># Format simple (recommandé)</div>
                <div>date,employe,debut,fin</div>
                <div>2025-03-03,Markella,9,17</div>
                <div>2025-03-03,Sébastien,10,18</div>
                <div>2025-03-04,Elena,11,20</div>
                <div style={{ color: 'var(--on-surface-3)', marginTop: '6px' }}># debut/fin = heures incluses · plusieurs semaines OK</div>
              </div>
            </details>

            <details>
              <summary style={{ color: 'var(--on-surface-2)', fontSize: '11px', cursor: 'pointer', userSelect: 'none' }}>
                💡 Prompt Claude web pour convertir votre Excel
              </summary>
              <div style={{ marginTop: '8px', background: 'var(--surface-low)', border: '1px solid var(--primary)', borderRadius: '8px', padding: '10px 12px', fontSize: '11px', color: 'var(--on-surface)', lineHeight: 1.7 }}>
                {`Voici mon planning Excel. Convertis-le en CSV :\n\ndate,employe,debut,fin\n\n- date : YYYY-MM-DD\n- employe : prénom exact (Markella, Sébastien, Elena…)\n- debut : heure de début (ex: 9)\n- fin : heure du dernier créneau (ex: 17 = travaille jusqu'à 18h)\n- Une ligne par plage continue, par employé, par jour\n\nGénère uniquement le CSV.`}
              </div>
            </details>
          </div>
        )}

        {/* ── Étape 2 : Résoudre les noms ──────────────────────────── */}
        {step === 'resolve' && (
          <div style={{ overflowY: 'auto' }}>
            <div style={{ color: 'var(--warning)', fontSize: '12px', marginBottom: '14px', fontWeight: 600 }}>
              ⚠️ {allUnknown.length} nom(s) non reconnu(s) — associez-les à un employé
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '18px' }}>
              {allUnknown.map(name => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ flex: 1, background: 'var(--surface-low)', borderRadius: '6px', padding: '5px 10px', fontSize: '12px', color: 'var(--warning)', fontWeight: 600 }}>
                    "{name}"
                  </div>
                  <div style={{ color: 'var(--on-surface-3)', fontSize: '11px' }}>→</div>
                  <select
                    value={nameMap[name] ?? ''}
                    onChange={e => setNameMap(prev => ({ ...prev, [name]: e.target.value }))}
                    style={{ flex: 1, background: 'var(--surface-low)', border: '1px solid var(--border)', color: 'var(--on-surface)', borderRadius: '6px', padding: '5px 8px', fontSize: '12px' }}
                  >
                    <option value="">— Ignorer —</option>
                    {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <button onClick={() => buildPreview(fileEntries, nameMap)} style={primaryBtn}>
              Continuer →
            </button>
          </div>
        )}

        {/* ── Étape 3 : Récapitulatif ───────────────────────────────── */}
        {step === 'preview' && (
          <div style={{ overflowY: 'auto' }}>
            {allErrors.length > 0 && (
              <div style={{ background: 'rgba(192,57,43,0.06)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px' }}>
                <div style={{ color: 'var(--danger)', fontSize: '11px', fontWeight: 600, marginBottom: '4px' }}>
                  {allErrors.length} erreur(s) ignorée(s)
                </div>
                {allErrors.slice(0, 5).map((e, i) => <div key={i} style={{ color: 'var(--danger)', fontSize: '10px', opacity: 0.8 }}>{e}</div>)}
                {allErrors.length > 5 && <div style={{ color: 'var(--on-surface-3)', fontSize: '10px' }}>…et {allErrors.length - 5} autres</div>}
              </div>
            )}

            {weekImports.length === 0 ? (
              <div style={{ color: 'var(--danger)', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>
                Aucune donnée valide. Vérifiez le format du fichier.
              </div>
            ) : (
              <>
                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '16px' }}>
                  {[
                    { label: 'Semaines', value: weekImports.length },
                    { label: 'Employés', value: new Set(weekImports.flatMap(w => {
                      const ids: string[] = []
                      for (let d = 0; d < 7; d++) Object.values(w.draft[d]?.hours ?? {}).forEach(a => a.forEach(id => ids.push(id)))
                      return ids
                    })).size },
                    { label: 'Créneaux', value: countSlots(weekImports) },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ background: 'var(--surface-low)', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--primary)', fontFamily: 'Epilogue, sans-serif' }}>{value}</div>
                      <div style={{ fontSize: '10px', color: 'var(--on-surface-2)' }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Liste semaines avec chips employés */}
                <div style={{ maxHeight: '160px', overflowY: 'auto', marginBottom: '14px' }}>
                  {weekImports.map(w => {
                    const empIds = new Set<string>()
                    for (let d = 0; d < 7; d++) Object.values(w.draft[d]?.hours ?? {}).forEach(a => a.forEach(id => empIds.add(id)))
                    return (
                      <div key={w.weekId} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 8px', borderRadius: '6px', background: w.weekId === currentWeekId ? 'rgba(0,66,117,0.06)' : 'transparent' }}>
                        <span style={{ fontSize: '10px', color: 'var(--on-surface-2)', fontFamily: 'monospace', minWidth: '90px' }}>{w.weekId}</span>
                        <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                          {[...empIds].map(id => {
                            const emp = employees.find(e => e.id === id)
                            return (
                              <span key={id} style={{ background: emp?.color ?? 'var(--on-surface-3)', color: '#fff', borderRadius: '3px', padding: '1px 4px', fontSize: '9px', fontWeight: 700 }}>
                                {emp?.initials ?? id.slice(0, 2)}
                              </span>
                            )
                          })}
                        </div>
                        {w.weekId === currentWeekId && <span style={{ fontSize: '9px', color: 'var(--primary)', marginLeft: 'auto', fontWeight: 600 }}>semaine affichée</span>}
                      </div>
                    )
                  })}
                </div>

                {/* Mode fusion/remplacement */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', background: 'var(--surface-low)', borderRadius: '8px', padding: '4px' }}>
                  {(['replace', 'merge'] as const).map(mode => (
                    <button key={mode} onClick={() => setMergeMode(mode)} style={{
                      flex: 1, padding: '6px', borderRadius: '6px', border: 'none', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                      background: mergeMode === mode ? (mode === 'replace' ? 'var(--primary)' : 'var(--success)') : 'transparent',
                      color: mergeMode === mode ? '#fff' : 'var(--on-surface-3)',
                    }}>
                      {mode === 'replace' ? '🔄 Remplacer' : '➕ Fusionner'}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--on-surface-3)', marginBottom: '16px', lineHeight: 1.6 }}>
                  {mergeMode === 'replace'
                    ? 'Remplace les créneaux des employés importés (les autres sont préservés).'
                    : 'Ajoute les créneaux importés sans rien effacer.'}
                </div>

                <button onClick={enterPreviewGrid} style={{ ...primaryBtn, background: 'var(--surface-low)', border: '1px solid var(--primary)', color: 'var(--primary)', marginBottom: '8px' }}>
                  🔍 Aperçu détaillé de la grille
                </button>
                <button onClick={doImport} style={primaryBtn}>
                  Importer {weekImports.length} semaine{weekImports.length > 1 ? 's' : ''} →
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Étape 4 : Aperçu grille ──────────────────────────────── */}
        {step === 'preview-grid' && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {loadingPreview ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-surface-2)', fontSize: '13px' }}>
                Chargement des données existantes…
              </div>
            ) : (
              <>
                {/* Navigation semaines */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexShrink: 0 }}>
                  <button
                    onClick={() => setSelectedPreviewIdx(i => Math.max(0, i - 1))}
                    disabled={selectedPreviewIdx === 0}
                    style={{ ...navBtn, opacity: selectedPreviewIdx === 0 ? 0.3 : 1 }}
                  >◀</button>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    {weekImports.map((w, i) => (
                      <button
                        key={w.weekId}
                        onClick={() => setSelectedPreviewIdx(i)}
                        style={{
                          margin: '0 3px', padding: '3px 8px', borderRadius: '5px', border: 'none',
                          fontSize: '10px', fontWeight: 600, cursor: 'pointer',
                          background: i === selectedPreviewIdx ? 'var(--primary)' : 'var(--surface-low)',
                          color: i === selectedPreviewIdx ? '#fff' : 'var(--on-surface-2)',
                        }}
                      >
                        {w.weekId}
                        {w.weekId === currentWeekId && ' ★'}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setSelectedPreviewIdx(i => Math.min(weekImports.length - 1, i + 1))}
                    disabled={selectedPreviewIdx === weekImports.length - 1}
                    style={{ ...navBtn, opacity: selectedPreviewIdx === weekImports.length - 1 ? 0.3 : 1 }}
                  >▶</button>
                </div>

                {/* Grille */}
                <div style={{ flex: 1, minHeight: 0, background: 'var(--surface-low)', borderRadius: '10px', padding: '8px', display: 'flex', flexDirection: 'column' }}>
                  {weekImports[selectedPreviewIdx] && (
                    <PlanningGrid
                      monday={weekImports[selectedPreviewIdx].monday}
                      draft={previewDrafts[weekImports[selectedPreviewIdx].weekId] ?? emptyWeekDraft()}
                      byId={byId}
                      selectedEmpId={null}
                      canEdit={false}
                      onPaintCell={() => {}}
                      weekEvents={{}}
                    />
                  )}
                </div>

                {/* Légende employés */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px', flexShrink: 0 }}>
                  {employees.map(emp => (
                    <span key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--on-surface-2)' }}>
                      <span style={{ background: emp.color, borderRadius: '3px', padding: '1px 5px', fontSize: '9px', fontWeight: 700, color: '#fff' }}>{emp.initials}</span>
                      {emp.name}
                    </span>
                  ))}
                </div>

                <button onClick={doImport} style={{ ...primaryBtn, marginTop: '12px', flexShrink: 0 }}>
                  Confirmer l'import ({weekImports.length} semaine{weekImports.length > 1 ? 's' : ''}) →
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Étape 5 : Importing ───────────────────────────────────── */}
        {step === 'importing' && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{ fontSize: '28px', marginBottom: '12px' }}>⏳</div>
            <div style={{ color: 'var(--on-surface)', fontWeight: 600, marginBottom: '8px' }}>Importation en cours…</div>
            <div style={{ color: 'var(--on-surface-2)', fontSize: '12px', marginBottom: '16px' }}>
              {progress.done} / {progress.total} semaine{progress.total > 1 ? 's' : ''}
            </div>
            <div style={{ background: 'var(--surface-low)', borderRadius: '6px', height: '6px', overflow: 'hidden' }}>
              <div style={{
                height: '100%', background: 'var(--primary)', borderRadius: '6px',
                width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        )}

        {/* ── Étape 6 : Done ───────────────────────────────────────── */}
        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>✅</div>
            <div style={{ color: 'var(--on-surface)', fontWeight: 700, fontSize: '15px', marginBottom: '6px', fontFamily: 'Epilogue, sans-serif' }}>Import terminé !</div>
            <div style={{ color: 'var(--on-surface-2)', fontSize: '12px', marginBottom: '20px' }}>
              {weekImports.length} semaine{weekImports.length > 1 ? 's' : ''} importée{weekImports.length > 1 ? 's' : ''}.
            </div>
            <button onClick={onClose} style={primaryBtn}>Fermer</button>
          </div>
        )}
      </div>
    </div>
  )
}

const primaryBtn: React.CSSProperties = {
  width: '100%', background: 'var(--primary)', border: 'none',
  color: '#fff', borderRadius: '10px', padding: '10px',
  fontSize: '13px', fontWeight: 700, cursor: 'pointer',
}
const navBtn: React.CSSProperties = {
  background: 'var(--surface-low)', border: '1px solid var(--border)',
  color: 'var(--on-surface-2)', borderRadius: '6px', padding: '4px 8px',
  cursor: 'pointer', fontSize: '12px',
}
