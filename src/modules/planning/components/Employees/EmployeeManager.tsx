import { useState } from 'react'
import { deleteField } from 'firebase/firestore'
import type { Employee, RestrictionRule, Avenant } from '../../types'
import { HOURS, DAYS_LABELS } from '../../types'
import { createEmployee, updateEmployee, deactivateEmployee } from '../../firebase/employees'
import { getBareme } from '../../utils/primes'

const PRESET_COLORS = [
  '#1976D2','#43A047','#F4511E','#8E24AA','#00897B',
  '#6D4C41','#E53935','#FB8C00','#00ACC1','#7CB342',
  '#F06292','#FF7043','#26A69A','#AB47BC','#5C6BC0'
]

interface Props { employees: Employee[]; onClose: () => void }

export function EmployeeManager({ employees, onClose }: Props) {
  const [mode, setMode] = useState<'list' | 'edit'>('list')
  const [editing, setEditing] = useState<Employee | null>(null)
  const [name, setName] = useState('')
  const [initials, setInitials] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [cap, setCap] = useState(35)
  const [restrictions, setRestrictions] = useState<RestrictionRule[]>([])
  const [primeComp, setPrimeComp]   = useState<number | ''>('')
  const [primePonct, setPrimePonct] = useState<number | ''>('')
  const [avenants, setAvenants] = useState<Avenant[]>([])
  const [saving, setSaving] = useState(false)

  function openNew() {
    setEditing(null); setName(''); setInitials(''); setColor(PRESET_COLORS[0]); setCap(35); setRestrictions([]); setPrimeComp(''); setPrimePonct(''); setAvenants([]); setMode('edit')
  }

  function openEdit(emp: Employee) {
    setEditing(emp); setName(emp.name); setInitials(emp.initials); setColor(emp.color); setCap(emp.weeklyCapHours)
    const r = emp.restrictions
    if (!r) setRestrictions([])
    else if (Array.isArray(r)) setRestrictions(r)
    else setRestrictions([r as RestrictionRule])
    setPrimeComp(emp.primeComportement !== undefined ? emp.primeComportement : '')
    setPrimePonct(emp.primePonctualite !== undefined ? emp.primePonctualite : '')
    setAvenants(emp.avenants ?? [])
    setMode('edit')
  }

  function addRule() { setRestrictions(prev => [...prev, { days: [], hours: [] }]) }
  function removeRule(idx: number) { setRestrictions(prev => prev.filter((_, i) => i !== idx)) }

  function toggleRuleDay(ruleIdx: number, day: number) {
    setRestrictions(prev => prev.map((r, i) => i !== ruleIdx ? r : {
      ...r, days: r.days.includes(day) ? r.days.filter(d => d !== day) : [...r.days, day],
    }))
  }

  function toggleRuleHour(ruleIdx: number, h: string) {
    setRestrictions(prev => prev.map((r, i) => i !== ruleIdx ? r : {
      ...r, hours: r.hours.includes(h) ? r.hours.filter(x => x !== h) : [...r.hours, h],
    }))
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    const inits = initials.trim() || name.slice(0, 2).toUpperCase()
    const data: Omit<Employee, 'id'> = {
      name: name.trim(), initials: inits, color, weeklyCapHours: cap, active: true,
      restrictions: restrictions.filter(r => r.days.length > 0 && r.hours.length > 0),
      primeComportement: primeComp !== '' ? Number(primeComp) : (editing ? deleteField() as any : undefined),
      primePonctualite:  primePonct !== '' ? Number(primePonct) : (editing ? deleteField() as any : undefined),
      avenants: avenants.length > 0 ? avenants : [],
    }
    try {
      editing ? await updateEmployee(editing.id, data) : await createEmployee(data)
      setMode('list')
    } finally { setSaving(false) }
  }

  async function handleDelete(emp: Employee) {
    if (!confirm(`Désactiver ${emp.name} ?`)) return
    await deactivateEmployee(emp.id)
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(28,28,24,0.45)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="w-full max-w-lg flex flex-col"
        style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-float)',
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <h2 style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 700, fontSize: '1.05rem', color: 'var(--on-surface)' }}>
            {mode === 'list' ? '👥 Employés' : (editing ? `Modifier ${editing.name}` : 'Nouvel employé')}
          </h2>
          <button
            onClick={mode === 'edit' ? () => setMode('list') : onClose}
            className="btn-icon"
            style={{ color: 'var(--on-surface-2)', fontSize: '1.1rem', lineHeight: 1 }}
          >
            {mode === 'edit' ? '←' : '✕'}
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5">
          {mode === 'list' && (
            <>
              <button onClick={openNew} className="btn-primary w-full mb-4">
                + Ajouter un employé
              </button>
              <div className="space-y-2">
                {employees.map(emp => (
                  <div
                    key={emp.id}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl"
                    style={{ background: 'var(--surface-low)' }}
                  >
                    <span style={{
                      background: emp.color,
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 700,
                      color: '#fff',
                      flexShrink: 0,
                    }}>
                      {emp.initials}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div style={{ color: 'var(--on-surface)', fontSize: '0.875rem', fontWeight: 600 }} className="truncate">
                        {emp.name}
                      </div>
                      <div style={{ color: 'var(--on-surface-2)', fontSize: '0.75rem' }}>
                        {emp.weeklyCapHours}h/semaine
                        {(emp.restrictions?.length ?? 0) > 0 && (
                          <span style={{ marginLeft: 8, color: 'var(--warning)' }}>
                            {emp.restrictions!.length} règle{emp.restrictions!.length > 1 ? 's' : ''} d'indispo
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => openEdit(emp)}
                        className="btn-secondary"
                        style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleDelete(emp)}
                        className="btn-danger"
                        style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {mode === 'edit' && (
            <div className="space-y-5">
              {/* Nom */}
              <div>
                <label className="section-label mb-1 block">Nom complet *</label>
                <input
                  value={name}
                  onChange={e => { setName(e.target.value); if (!editing) setInitials(e.target.value.slice(0, 2).toUpperCase()) }}
                  className="input-filled w-full"
                  placeholder="ex: Matthieu"
                />
              </div>

              {/* Initiales */}
              <div>
                <label className="section-label mb-1 block">Initiales (1-2 caractères)</label>
                <input
                  value={initials}
                  onChange={e => setInitials(e.target.value.toUpperCase().slice(0, 2))}
                  maxLength={2}
                  className="input-filled w-full uppercase"
                  placeholder="ex: MT"
                />
              </div>

              {/* Couleur */}
              <div>
                <label className="section-label mb-2 block">Couleur</label>
                <div className="flex gap-2 flex-wrap mb-2">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      style={{
                        background: c,
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        border: color === c ? '2.5px solid var(--primary)' : '2px solid transparent',
                        outline: color === c ? '1.5px solid var(--surface)' : 'none',
                        outlineOffset: 1,
                      }}
                    />
                  ))}
                </div>
                <input
                  type="color"
                  value={color}
                  onChange={e => setColor(e.target.value)}
                  className="w-full h-9 rounded-lg cursor-pointer"
                  style={{ background: 'var(--surface-low)', border: '1px solid var(--border)' }}
                />
              </div>

              {/* Heures contrat */}
              <div>
                <label className="section-label mb-1 block">Heures contrat / semaine</label>
                <input
                  type="number"
                  value={cap}
                  onChange={e => setCap(Number(e.target.value))}
                  min={1}
                  max={45}
                  className="input-filled w-full"
                />
              </div>

              {/* Primes personnalisées */}
              <div>
                <label className="section-label mb-1 block">Primes personnalisées (optionnel)</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '10px', color: 'var(--on-surface-3)', marginBottom: 3 }}>Comportement (€)</div>
                    <input
                      type="number" min={0} max={500}
                      value={primeComp}
                      onChange={e => setPrimeComp(e.target.value === '' ? '' : Number(e.target.value))}
                      className="input-filled w-full"
                      placeholder={`${getBareme(cap).comp / 2} (barème)`}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '10px', color: 'var(--on-surface-3)', marginBottom: 3 }}>Ponctualité (€)</div>
                    <input
                      type="number" min={0} max={500}
                      value={primePonct}
                      onChange={e => setPrimePonct(e.target.value === '' ? '' : Number(e.target.value))}
                      className="input-filled w-full"
                      placeholder={`${getBareme(cap).comp / 2} (barème)`}
                    />
                  </div>
                </div>
                <div style={{ fontSize: '10px', color: 'var(--on-surface-3)', marginTop: 4 }}>
                  Laisser vide = barème par défaut selon les heures contrat
                </div>
              </div>

              {/* Avenants contrat */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <label style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 600, fontSize: '0.875rem', color: 'var(--on-surface)' }}>
                    Avenants contrat
                  </label>
                  <button
                    type="button"
                    onClick={() => setAvenants(prev => [...prev, { effectiveDate: '', weeklyCapHours: cap, label: '' }])}
                    className="btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '4px 12px' }}
                  >
                    + Ajouter
                  </button>
                </div>
                {avenants.length === 0 && (
                  <p style={{ color: 'var(--on-surface-3)', fontSize: '0.78rem', fontStyle: 'italic' }}>
                    Aucun avenant — les heures contrat actuelles s'appliquent toujours.
                  </p>
                )}
                {avenants.map((av, ai) => (
                  <div key={ai} style={{ background: 'var(--surface-low)', border: '1px solid var(--border)', borderRadius: '10px', padding: '10px 12px', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '10px', color: 'var(--on-surface-3)', marginBottom: 3 }}>À partir du</div>
                        <input
                          type="date"
                          value={av.effectiveDate}
                          onChange={e => setAvenants(prev => prev.map((a, i) => i === ai ? { ...a, effectiveDate: e.target.value } : a))}
                          className="input-filled w-full"
                        />
                      </div>
                      <div style={{ width: '70px' }}>
                        <div style={{ fontSize: '10px', color: 'var(--on-surface-3)', marginBottom: 3 }}>Heures</div>
                        <input
                          type="number" min={1} max={45}
                          value={av.weeklyCapHours}
                          onChange={e => setAvenants(prev => prev.map((a, i) => i === ai ? { ...a, weeklyCapHours: Number(e.target.value) } : a))}
                          className="input-filled w-full"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setAvenants(prev => prev.filter((_, i) => i !== ai))}
                        style={{ color: 'var(--danger)', fontSize: '0.75rem', paddingBottom: '6px', background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        ✕
                      </button>
                    </div>
                    <div style={{ marginTop: '6px' }}>
                      <input
                        type="text"
                        value={av.label ?? ''}
                        onChange={e => setAvenants(prev => prev.map((a, i) => i === ai ? { ...a, label: e.target.value } : a))}
                        className="input-filled w-full"
                        placeholder="Note (optionnel, ex: Passage à 35h)"
                        style={{ fontSize: '0.75rem' }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Indisponibilités */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 600, fontSize: '0.875rem', color: 'var(--on-surface)' }}>
                    Indisponibilités
                  </label>
                  <button
                    type="button"
                    onClick={addRule}
                    className="btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '4px 12px' }}
                  >
                    + Ajouter une règle
                  </button>
                </div>
                {restrictions.length === 0 && (
                  <p style={{ color: 'var(--on-surface-3)', fontSize: '0.78rem', fontStyle: 'italic', paddingTop: 2 }}>
                    Aucune règle — cliquez "+ Ajouter une règle" pour définir des créneaux indisponibles.
                  </p>
                )}
                {restrictions.map((rule, ri) => (
                  <div
                    key={ri}
                    className="rounded-xl p-3 mb-2"
                    style={{ background: 'var(--surface-low)', border: '1px solid var(--border)' }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ color: 'var(--on-surface-2)', fontSize: '0.75rem', fontWeight: 600 }}>
                        Règle {ri + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeRule(ri)}
                        style={{ color: 'var(--danger)', fontSize: '0.75rem' }}
                      >
                        ✕ Supprimer
                      </button>
                    </div>

                    {/* Jours */}
                    <div className="mb-2">
                      <div style={{ color: 'var(--on-surface-3)', fontSize: '0.72rem', marginBottom: 4 }}>Jours concernés</div>
                      <div className="flex gap-1.5 flex-wrap">
                        {DAYS_LABELS.map((day, di) => (
                          <button
                            key={di}
                            type="button"
                            onClick={() => toggleRuleDay(ri, di)}
                            style={{
                              fontSize: '0.72rem',
                              padding: '2px 8px',
                              borderRadius: 6,
                              fontWeight: 600,
                              transition: 'all 0.15s',
                              background: rule.days.includes(di) ? '#b10f21' : 'var(--surface-mid)',
                              color: rule.days.includes(di) ? '#fff' : 'var(--on-surface-2)',
                              border: 'none',
                            }}
                          >
                            {day}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Heures */}
                    <div>
                      <div style={{ color: 'var(--on-surface-3)', fontSize: '0.72rem', marginBottom: 4 }}>Heures bloquées</div>
                      <div className="flex gap-1 flex-wrap">
                        {HOURS.map(h => (
                          <button
                            key={h}
                            type="button"
                            onClick={() => toggleRuleHour(ri, String(h))}
                            style={{
                              fontSize: '0.7rem',
                              padding: '2px 6px',
                              borderRadius: 5,
                              fontWeight: 600,
                              transition: 'all 0.15s',
                              background: rule.hours.includes(String(h)) ? '#b10f21' : 'var(--surface-mid)',
                              color: rule.hours.includes(String(h)) ? '#fff' : 'var(--on-surface-2)',
                              border: 'none',
                            }}
                          >
                            {h}h
                          </button>
                        ))}
                      </div>
                    </div>

                    {rule.days.length > 0 && rule.hours.length > 0 && (
                      <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--warning)', fontWeight: 500 }}>
                        🚫 {rule.days.map(d => DAYS_LABELS[d]).join(', ')} · {(() => {
                          const sorted = [...rule.hours].sort((a, b) => Number(a) - Number(b))
                          const first = sorted[0], last = sorted[sorted.length - 1]
                          return first === last ? `${first}h` : `${first}h–${Number(last) + 1}h`
                        })()}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Save */}
              <button
                onClick={handleSave}
                disabled={saving || !name.trim()}
                className="btn-primary w-full"
                style={{ opacity: (saving || !name.trim()) ? 0.5 : 1 }}
              >
                {saving ? 'Enregistrement…' : (editing ? 'Mettre à jour' : "Créer l'employé")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
