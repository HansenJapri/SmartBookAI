import { useEffect, useMemo, useState } from 'react'
import { Gauge, ChevronLeft, ChevronRight, Trash2, Plus } from 'lucide-react'
import Modal from '../components/Modal'
import {
  fetchEmployees, fetchAttendanceRange, fetchTasks,
  fetchKpiCriteria, addKpiCriteria, updateKpiCriteria, deleteKpiCriteria,
  fetchKpiScores, saveKpiScores,
  fetchKpiBonusRules, addKpiBonusRule, updateKpiBonusRule, deleteKpiBonusRule,
} from '../lib/api'
import { currentPeriod, periodLabel, periodRange } from '../lib/hr'
import {
  KPI_SOURCES, DEFAULT_CRITERIA, attendanceScore, taskScore, weightedTotal,
  applyBonusTier, recapAttendance,
} from '../lib/kpi'
import { rupiah } from '../lib/format'
import { useLang } from '../context/LangContext'

// KPI Karyawan: skor per kriteria (otomatis dari absensi & papan tugas, atau
// manual), total tertimbang, lalu jenjang skor -> usulan bonus/potongan yang
// dipakai otomatis saat membuat draf gaji (tetap bisa dikoreksi manual).
export default function Kpi() {
  const { t } = useLang()
  const kp = t.kpi
  const srcLabel = (key) => (key === 'kehadiran' ? kp.srcKehadiran : key === 'tugas' ? kp.srcTugas : key === 'manual' ? kp.srcManual : (KPI_SOURCES.find((s) => s.key === key)?.label || key))
  const [employees, setEmployees] = useState(null)
  const [criteria, setCriteria] = useState(null)
  const [rules, setRules] = useState([])
  const [period, setPeriod] = useState(currentPeriod())
  const [attRows, setAttRows] = useState([])
  const [tasks, setTasks] = useState([])
  const [savedScores, setSavedScores] = useState([])
  const [manual, setManual] = useState({}) // {empId: {criteriaId: '87'}}
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [newCrit, setNewCrit] = useState(null) // {name, weight, source}
  const [newRule, setNewRule] = useState(null) // {min_score, bonus, deduction, label}

  useEffect(() => { fetchEmployees().then(setEmployees).catch(() => setEmployees([])) }, [])
  useEffect(() => { fetchTasks().then(setTasks).catch(() => {}) }, [])
  useEffect(() => { fetchKpiBonusRules().then(setRules).catch(() => {}) }, [])

  // Kriteria: seed bawaan saat pertama kali dipakai (belum ada satu pun).
  useEffect(() => {
    (async () => {
      try {
        let list = await fetchKpiCriteria()
        if (!list.length) {
          for (const c of DEFAULT_CRITERIA) list = [...list, await addKpiCriteria(c)]
        }
        setCriteria(list)
      } catch { setCriteria([]) }
    })()
  }, [])

  useEffect(() => {
    const { from, to } = periodRange(period)
    fetchAttendanceRange(from, to).then(setAttRows).catch(() => setAttRows([]))
    fetchKpiScores(period).then(setSavedScores).catch(() => setSavedScores([]))
    setManual({})
  }, [period])

  const active = useMemo(() => (employees || []).filter((e) => e.status === 'aktif'), [employees])
  const activeCriteria = useMemo(() => (criteria || []).filter((c) => c.active !== false), [criteria])
  const totalWeight = activeCriteria.reduce((s, c) => s + (Number(c.weight) || 0), 0)

  const savedOf = (empId, critId) =>
    savedScores.find((s) => s.employee_id === empId && s.criteria_id === critId)

  // Skor efektif satu sel: manual edit di layar > tersimpan > hitung otomatis.
  const scoreOf = (emp, crit) => {
    const typed = manual[emp.id]?.[crit.id]
    if (typed !== undefined && typed !== '') return Math.max(0, Math.min(100, Number(typed) || 0))
    if (typed === '') return null
    const saved = savedOf(emp.id, crit.id)
    if (saved) return Number(saved.score)
    if (crit.source === 'kehadiran') return attendanceScore(recapAttendance(attRows, emp.id))
    if (crit.source === 'tugas') return taskScore(tasks, emp.id, period)
    return null // manual belum diisi
  }

  const rowOf = (emp) => {
    const scores = {}
    for (const c of activeCriteria) scores[c.id] = scoreOf(emp, c)
    const total = weightedTotal(activeCriteria, scores)
    const tier = applyBonusTier(rules, total)
    return { scores, total, tier }
  }

  const saveAll = async () => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const rows = []
      for (const emp of active) {
        for (const c of activeCriteria) {
          const s = scoreOf(emp, c)
          if (s === null || s === undefined) continue
          rows.push({ employee_id: emp.id, criteria_id: c.id, period, score: s })
        }
      }
      const saved = await saveKpiScores(rows)
      setSavedScores((prev) => {
        const keep = prev.filter((p) => !saved.some((s) => s.employee_id === p.employee_id && s.criteria_id === p.criteria_id))
        return [...keep, ...saved]
      })
      setManual({})
      setMsg(kp.savedMsg.replace('{period}', periodLabel(period)).replace('{n}', rows.length))
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const shiftPeriod = (dir) => {
    const [y, m] = period.split('-').map(Number)
    setPeriod(currentPeriod(new Date(y, m - 1 + dir, 1)))
  }

  // ---- kelola kriteria ----
  const saveCrit = async () => {
    if (!newCrit.name.trim()) return setErr(kp.errCritName)
    setBusy(true); setErr('')
    try {
      const created = await addKpiCriteria({
        name: newCrit.name.trim(), weight: Math.max(0, Math.min(100, Number(newCrit.weight) || 0)), source: newCrit.source,
      })
      setCriteria((prev) => [...prev, created])
      setNewCrit(null)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }
  const patchCrit = async (c, patch) => {
    try {
      const upd = await updateKpiCriteria(c.id, patch)
      setCriteria((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
    } catch (e2) { setErr(e2.message) }
  }
  const removeCrit = async (c) => {
    if (!confirm(kp.confirmDelCrit.replace('{name}', c.name))) return
    try {
      await deleteKpiCriteria(c.id)
      setCriteria((prev) => prev.filter((x) => x.id !== c.id))
    } catch (e2) { setErr(e2.message) }
  }

  // ---- kelola jenjang bonus/potongan ----
  const saveRule = async () => {
    setBusy(true); setErr('')
    try {
      const created = await addKpiBonusRule({
        min_score: Math.max(0, Math.min(100, Number(newRule.min_score) || 0)),
        bonus: Math.max(0, Number(newRule.bonus) || 0),
        deduction: Math.max(0, Number(newRule.deduction) || 0),
        label: newRule.label.trim() || null,
      })
      setRules((prev) => [...prev, created].sort((a, b) => b.min_score - a.min_score))
      setNewRule(null)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }
  const patchRule = async (r, field, value) => {
    const val = field === 'label' ? (value.trim() || null) : Math.max(0, Number(value) || 0)
    if ((r[field] ?? (field === 'label' ? null : 0)) === val) return
    try {
      const upd = await updateKpiBonusRule(r.id, { [field]: val })
      setRules((prev) => prev.map((x) => (x.id === upd.id ? upd : x)).sort((a, b) => b.min_score - a.min_score))
    } catch (e2) { setErr(e2.message) }
  }
  const removeRule = async (r) => {
    if (!confirm(kp.confirmDelTier)) return
    try {
      await deleteKpiBonusRule(r.id)
      setRules((prev) => prev.filter((x) => x.id !== r.id))
    } catch (e2) { setErr(e2.message) }
  }

  if (!employees || !criteria) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <>
      {msg && (
        <div className="alert alert-ok" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{msg}</span>
          <button className="icon-btn" onClick={() => setMsg('')} aria-label={kp.close}>✕</button>
        </div>
      )}
      {err && <div className="alert alert-err">{err}</div>}

      <div className="toolbar">
        <button className="icon-btn" onClick={() => shiftPeriod(-1)} aria-label={kp.prevMonth}><ChevronLeft size={16} /></button>
        <input className="input" type="month" style={{ maxWidth: 170 }} aria-label={kp.periodAria} value={period}
          onChange={(e) => e.target.value && setPeriod(e.target.value)} />
        <button className="icon-btn" onClick={() => shiftPeriod(1)} aria-label={kp.nextMonth}><ChevronRight size={16} /></button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={saveAll} disabled={busy || active.length === 0}>
          {busy ? kp.saving : kp.saveScores}
        </button>
      </div>

      {/* ---------- TABEL SKOR PER KARYAWAN ---------- */}
      {active.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee"><Gauge size={36} /></div>
          <h3>{kp.emptyTitle}</h3>
          <p>{kp.emptyDesc}</p>
        </div></div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>{kp.colEmployee}</th>
              {activeCriteria.map((c) => (
                <th key={c.id} style={{ whiteSpace: 'nowrap' }}>
                  {c.name} <span className="muted-sm">({Number(c.weight)}%)</span>
                </th>
              ))}
              <th>{kp.colTotal}</th>
              <th style={{ whiteSpace: 'nowrap' }}>{kp.colProposal}</th>
            </tr></thead>
            <tbody>
              {active.map((emp) => {
                const { scores, total, tier } = rowOf(emp)
                return (
                  <tr key={emp.id}>
                    <td><b>{emp.name}</b><div className="muted-sm">{emp.role || '-'}</div></td>
                    {activeCriteria.map((c) => {
                      const s = scores[c.id]
                      const auto = c.source !== 'manual'
                      return (
                        <td key={c.id} style={{ maxWidth: 110 }}>
                          {auto ? (
                            <span title={srcLabel(c.source)}>
                              {s === null ? <span className="muted-sm">{kp.noData}</span> : <b>{s}</b>}
                            </span>
                          ) : (
                            <input className="input" type="number" min="0" max="100" placeholder="0-100"
                              aria-label={kp.valueAria.replace('{crit}', c.name).replace('{name}', emp.name)}
                              value={manual[emp.id]?.[c.id] ?? (savedOf(emp.id, c.id)?.score ?? '')}
                              onChange={(e) => setManual((prev) => ({
                                ...prev, [emp.id]: { ...prev[emp.id], [c.id]: e.target.value },
                              }))} />
                          )}
                        </td>
                      )
                    })}
                    <td>
                      {total === null ? <span className="muted-sm">{kp.noneYet}</span> : (
                        <b style={{ fontSize: 16, color: total >= 75 ? 'var(--green)' : total >= 50 ? 'var(--warn-ink)' : 'var(--red)' }}>
                          {total}
                        </b>
                      )}
                    </td>
                    <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>
                      {!tier ? (rules.length ? kp.noneYet : kp.setTierBelow)
                        : (
                          <>
                            {tier.bonus > 0 && <span className="amt-in">+{rupiah(tier.bonus)}</span>}
                            {tier.bonus > 0 && tier.deduction > 0 && ' · '}
                            {tier.deduction > 0 && <span className="amt-out">−{rupiah(tier.deduction)}</span>}
                            {tier.bonus === 0 && tier.deduction === 0 && kp.noEffect}
                            {tier.rule.label && <div>{tier.rule.label}</div>}
                          </>
                        )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted-sm mt">{kp.hint}</p>

      <div className="two-col two-col-kpi" style={{ marginTop: 16 }}>
        {/* ---------- KRITERIA ---------- */}
        <div className="card card-pad">
          <div className="card-head-row">
            <div>
              <h3 className="card-title">{kp.critTitle}</h3>
              <div className="card-sub">{kp.critWeightPre} <b style={{ color: totalWeight === 100 ? 'var(--green)' : 'var(--warn-ink)' }}>{totalWeight}%</b>{totalWeight !== 100 && ` ${kp.critWeightNormalized}`}</div>
            </div>
            <button className="btn btn-ghost" onClick={() => setNewCrit({ name: '', weight: 20, source: 'manual' })}>
              <Plus size={15} style={{ verticalAlign: '-2px' }} /> {kp.addCrit}
            </button>
          </div>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="tbl">
              <thead><tr><th>{kp.thName}</th><th>{kp.thWeight}</th><th>{kp.thSource}</th><th>{kp.thActive}</th><th></th></tr></thead>
              <tbody>
                {(criteria || []).map((c) => (
                  <tr key={c.id} style={c.active === false ? { opacity: 0.55 } : undefined}>
                    <td><b>{c.name}</b></td>
                    <td style={{ maxWidth: 90 }}>
                      <input className="input" type="number" min="0" max="100" defaultValue={Number(c.weight)}
                        aria-label={kp.weightAria.replace('{name}', c.name)}
                        onBlur={(e) => { const w = Math.max(0, Math.min(100, Number(e.target.value) || 0)); if (w !== Number(c.weight)) patchCrit(c, { weight: w }) }} />
                    </td>
                    <td className="muted-sm">{srcLabel(c.source)}</td>
                    <td>
                      <input type="checkbox" checked={c.active !== false}
                        aria-label={kp.activeAria.replace('{name}', c.name)}
                        onChange={(e) => patchCrit(c, { active: e.target.checked })} />
                    </td>
                    <td><button className="icon-btn danger" aria-label={kp.del} onClick={() => removeCrit(c)}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ---------- JENJANG BONUS/POTONGAN ---------- */}
        <div className="card card-pad">
          <div className="card-head-row">
            <div>
              <h3 className="card-title">{kp.tierTitle}</h3>
              <div className="card-sub">{kp.tierSub}</div>
            </div>
            <button className="btn btn-ghost" onClick={() => setNewRule({ min_score: 90, bonus: 0, deduction: 0, label: '' })}>
              <Plus size={15} style={{ verticalAlign: '-2px' }} /> {kp.addTier}
            </button>
          </div>
          {rules.length === 0 ? (
            <p className="muted-sm" style={{ marginTop: 10 }}>{kp.tierEmpty}</p>
          ) : (
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="tbl tbl-tier">
                <thead><tr><th className="col-score">{kp.thMinScore}</th><th className="col-money">{kp.thBonus}</th><th className="col-money">{kp.thDeduction}</th><th className="col-label">{kp.thLabel}</th><th className="col-act"></th></tr></thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id}>
                      <td className="col-score">
                        <input className="input" type="number" min="0" max="100" defaultValue={Number(r.min_score)}
                          aria-label={kp.minScoreAria}
                          onBlur={(e) => patchRule(r, 'min_score', e.target.value)} />
                        {/* Ambang ditulis ulang sebagai pertidaksamaan: "90" saja
                            tidak memberi tahu bahwa nilainya berlaku ke ATAS. */}
                        <span className="num-hint">≥ {Number(r.min_score)} poin</span>
                      </td>
                      <td className="col-money">
                        <input className="input" type="number" min="0" step="any" defaultValue={Number(r.bonus) || ''}
                          aria-label={kp.bonusAria.replace('{v}', r.min_score)}
                          placeholder="0" onBlur={(e) => patchRule(r, 'bonus', e.target.value)} />
                        {/* Nilai terformat di bawah kotak isian: input type=number
                            tidak bisa menampilkan pemisah ribuan, dan "500000"
                            tanpa titik mudah tertukar dengan "50000". */}
                        {Number(r.bonus) > 0 && <span className="num-hint is-bonus">+{rupiah(Number(r.bonus))}</span>}
                      </td>
                      <td className="col-money">
                        <input className="input" type="number" min="0" step="any" defaultValue={Number(r.deduction) || ''}
                          aria-label={kp.deductionAria.replace('{v}', r.min_score)}
                          placeholder="0" onBlur={(e) => patchRule(r, 'deduction', e.target.value)} />
                        {Number(r.deduction) > 0 && <span className="num-hint is-cut">−{rupiah(Number(r.deduction))}</span>}
                      </td>
                      <td className="col-label">
                        <input className="input" defaultValue={r.label || ''} placeholder={kp.labelPh}
                          onBlur={(e) => patchRule(r, 'label', e.target.value)} />
                      </td>
                      <td className="col-act"><button className="icon-btn danger" aria-label={kp.del} onClick={() => removeRule(r)}><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ---------- MODAL TAMBAH KRITERIA ---------- */}
      {newCrit && (
        <Modal onClose={() => setNewCrit(null)} labelledBy="kpiCritModalTitle">
            <div className="modal-head">
              <h3 id="kpiCritModalTitle">{kp.addCritTitle}</h3>
              <button type="button" className="icon-btn" onClick={() => setNewCrit(null)} aria-label={kp.close}>✕</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label htmlFor="kpi-crit-name">{kp.lCritName}</label>
                <input id="kpi-crit-name" className="input" value={newCrit.name} placeholder={kp.critNamePh}
                  onChange={(e) => setNewCrit({ ...newCrit, name: e.target.value })} />
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="kpi-crit-weight">{kp.lWeight}</label>
                  <input id="kpi-crit-weight" className="input" type="number" min="0" max="100" value={newCrit.weight}
                    onChange={(e) => setNewCrit({ ...newCrit, weight: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="kpi-crit-source">{kp.lSource}</label>
                  <select id="kpi-crit-source" className="input" value={newCrit.source} onChange={(e) => setNewCrit({ ...newCrit, source: e.target.value })}>
                    {KPI_SOURCES.map((s) => <option key={s.key} value={s.key}>{srcLabel(s.key)}</option>)}
                  </select>
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost btn-block" onClick={() => setNewCrit(null)}>{kp.cancel}</button>
                <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={saveCrit}>{kp.save}</button>
              </div>
            </div>
        </Modal>
      )}

      {/* ---------- MODAL TAMBAH JENJANG ---------- */}
      {newRule && (
        <Modal onClose={() => setNewRule(null)} labelledBy="kpiRuleModalTitle">
            <div className="modal-head">
              <h3 id="kpiRuleModalTitle">{kp.addTierTitle}</h3>
              <button type="button" className="icon-btn" onClick={() => setNewRule(null)} aria-label={kp.close}>✕</button>
            </div>
            <div className="modal-body">
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="kpi-rule-min">{kp.lMinScore}</label>
                  <input id="kpi-rule-min" className="input" type="number" min="0" max="100" value={newRule.min_score}
                    onChange={(e) => setNewRule({ ...newRule, min_score: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="kpi-rule-label">{kp.lLabel} <span className="muted-sm">{kp.optional}</span></label>
                  <input id="kpi-rule-label" className="input" value={newRule.label} placeholder={kp.labelPh}
                    onChange={(e) => setNewRule({ ...newRule, label: e.target.value })} />
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="kpi-rule-bonus">{kp.lBonus}</label>
                  <input id="kpi-rule-bonus" className="input" type="number" min="0" step="any" value={newRule.bonus}
                    onChange={(e) => setNewRule({ ...newRule, bonus: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="kpi-rule-deduction">{kp.lDeduction}</label>
                  <input id="kpi-rule-deduction" className="input" type="number" min="0" step="any" value={newRule.deduction}
                    onChange={(e) => setNewRule({ ...newRule, deduction: e.target.value })} />
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost btn-block" onClick={() => setNewRule(null)}>{kp.cancel}</button>
                <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={saveRule}>{kp.save}</button>
              </div>
            </div>
        </Modal>
      )}
    </>
  )
}
