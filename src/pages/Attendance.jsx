import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Pencil } from 'lucide-react'
import Modal from '../components/Modal'
import {
  fetchEmployees, fetchAttendanceRange, setAttendance, deleteAttendance,
  fetchAttendanceRules, upsertAttendanceRule,
} from '../lib/api'
import { ATTENDANCE_STATUS, currentPeriod, periodLabel, periodRange } from '../lib/hr'
import { rupiah, fmtDate } from '../lib/format'
import { useLang } from '../context/LangContext'
import { BATAS_DATE, BATAS_MONTH, bersihkanTanggal } from '../lib/dateInput'

const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayISO = () => toISO(new Date())
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return toISO(d) }

// Senin sebagai awal minggu (kebiasaan kerja Indonesia).
function weekRange(iso) {
  const d = new Date(iso + 'T12:00:00')
  const dow = (d.getDay() + 6) % 7 // Senin=0
  const from = addDays(iso, -dow)
  return { from, to: addDays(from, 6) }
}
function listDates(from, to) {
  const out = []
  let cur = from
  while (cur <= to && out.length < 62) { out.push(cur); cur = addDays(cur, 1) }
  return out
}

// Absensi & Cuti: pilih tampilan (harian/mingguan/bulanan/rentang), klik untuk
// mengisi atau MEMPERBAIKI status (termasuk mengosongkan salah input), plus
// aturan bonus/potongan per status yang dipakai otomatis oleh Penggajian.
export default function Attendance() {
  const { t } = useLang()
  const an = t.attendance
  const statusLabel = (key) => t.hr['status' + key.charAt(0).toUpperCase() + key.slice(1)]
  const MODES = [
    { key: 'hari', label: an.modeHari },
    { key: 'minggu', label: an.modeMinggu },
    { key: 'bulan', label: an.modeBulan },
    { key: 'rentang', label: an.modeRentang },
  ]
  const STATUS_BY_KEY = Object.fromEntries(ATTENDANCE_STATUS.map((s) => [s.key, s]))
  const LETTER = an.letters
  const DOW_ID = an.dow
  const [employees, setEmployees] = useState(null)
  const [mode, setMode] = useState('hari')
  const [anchor, setAnchor] = useState(todayISO())      // hari & minggu
  const [month, setMonth] = useState(currentPeriod())   // bulanan
  const [range, setRange] = useState({ from: addDays(todayISO(), -6), to: todayISO() })
  const [rows, setRows] = useState([])
  const [rules, setRules] = useState([])
  const [editor, setEditor] = useState(null) // {empId, empName, date, status, note}
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  // Rentang tanggal yang sedang dilihat, mengikuti mode.
  const view = useMemo(() => {
    if (mode === 'hari') return { from: anchor, to: anchor }
    if (mode === 'minggu') return weekRange(anchor)
    if (mode === 'bulan') return periodRange(month)
    const from = range.from <= range.to ? range.from : range.to
    const to = range.from <= range.to ? range.to : range.from
    return { from, to }
  }, [mode, anchor, month, range])

  const dates = useMemo(() => listDates(view.from, view.to), [view])
  const tooWide = dates.length > 31

  useEffect(() => { fetchEmployees().then(setEmployees).catch(() => setEmployees([])) }, [])
  useEffect(() => { fetchAttendanceRules().then(setRules).catch(() => {}) }, [])
  useEffect(() => {
    if (tooWide) return
    fetchAttendanceRange(view.from, view.to).then(setRows).catch(() => setRows([]))
  }, [view.from, view.to, tooWide])

  const active = useMemo(() => (employees || []).filter((e) => e.status === 'aktif'), [employees])
  const byEmpDate = useMemo(() => {
    const m = {}
    for (const r of rows) m[`${r.employee_id}|${r.date}`] = r
    return m
  }, [rows])

  const recap = useMemo(() => {
    const per = {}
    for (const r of rows) {
      per[r.employee_id] = per[r.employee_id] || { hadir: 0, izin: 0, sakit: 0, cuti: 0, alpa: 0 }
      if (per[r.employee_id][r.status] !== undefined) per[r.employee_id][r.status]++
    }
    return per
  }, [rows])

  const shift = (dir) => {
    if (mode === 'hari') setAnchor((a) => addDays(a, dir))
    else if (mode === 'minggu') setAnchor((a) => addDays(a, dir * 7))
    else if (mode === 'bulan') {
      const [y, m] = month.split('-').map(Number)
      const d = new Date(y, m - 1 + dir, 1)
      setMonth(currentPeriod(d))
    }
  }

  const applyLocal = (empId, date, saved) => {
    setRows((prev) => {
      const others = prev.filter((r) => !(r.employee_id === empId && r.date === date))
      return saved ? [...others, saved] : others
    })
  }

  // Simpan cepat dari tombol status (tanpa membuka editor).
  const quickMark = async (empId, date, status) => {
    setErr('')
    try {
      const saved = await setAttendance(empId, date, status)
      applyLocal(empId, date, saved)
    } catch (e2) { setErr(e2.message) }
  }

  const saveEditor = async () => {
    const ed = editor
    if (!ed?.status) return setErr(an.chooseStatusErr)
    setBusy(true); setErr('')
    try {
      const saved = await setAttendance(ed.empId, ed.date, ed.status, ed.note.trim() || null)
      applyLocal(ed.empId, ed.date, saved)
      setEditor(null)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const clearEditor = async () => {
    const ed = editor
    setBusy(true); setErr('')
    try {
      await deleteAttendance(ed.empId, ed.date)
      applyLocal(ed.empId, ed.date, null)
      setEditor(null)
      setMsg(an.clearedMsg.replace('{name}', ed.empName).replace('{date}', fmtDate(ed.date)))
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const openEditor = (emp, date) => {
    const cur = byEmpDate[`${emp.id}|${date}`]
    setErr('')
    setEditor({
      empId: emp.id, empName: emp.name, date,
      status: cur?.status || '', note: cur?.note || '', exists: Boolean(cur),
    })
  }

  const ruleOf = (status) => rules.find((r) => r.status === status) || { status, bonus_per_day: 0, deduction_per_day: 0 }
  const patchRule = async (status, field, value) => {
    const val = Math.max(0, Number(value) || 0)
    const cur = ruleOf(status)
    if (Number(cur[field]) === val) return
    try {
      const saved = await upsertAttendanceRule(status, {
        bonus_per_day: field === 'bonus_per_day' ? val : Number(cur.bonus_per_day) || 0,
        deduction_per_day: field === 'deduction_per_day' ? val : Number(cur.deduction_per_day) || 0,
      })
      setRules((prev) => [...prev.filter((r) => r.status !== status), saved])
      setMsg(an.ruleSavedMsg)
    } catch (e2) { setErr(e2.message) }
  }

  if (!employees) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const today = todayISO()
  const periodTitle = mode === 'hari' ? fmtDate(anchor)
    : mode === 'bulan' ? periodLabel(month)
    : `${fmtDate(view.from)} – ${fmtDate(view.to)}`

  return (
    <>
      {msg && (
        <div className="alert alert-ok" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{msg}</span>
          <button className="icon-btn" onClick={() => setMsg('')} aria-label={an.close}>✕</button>
        </div>
      )}
      {err && !editor && <div className="alert alert-err">{err}</div>}

      {/* Pilihan tampilan & navigasi periode */}
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <div className="seg">
          {MODES.map((m) => (
            <button key={m.key} type="button"
              className={`seg-btn ${mode === m.key ? 'active' : ''}`}
              onClick={() => { setErr(''); setMode(m.key) }}>
              {m.label}
            </button>
          ))}
        </div>
        {mode !== 'rentang' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="icon-btn" onClick={() => shift(-1)} aria-label={an.prevAria}><ChevronLeft size={16} /></button>
            {mode === 'hari' && (
              <input className="input" type="date" {...BATAS_DATE} style={{ maxWidth: 165 }} aria-label={an.dateAria} value={anchor}
                max={today} onChange={(e) => bersihkanTanggal(e.target.value) && setAnchor(bersihkanTanggal(e.target.value))} />
            )}
            {mode === 'minggu' && (
              <input className="input" type="date" {...BATAS_DATE} style={{ maxWidth: 165 }} aria-label={an.weekDateAria} value={anchor}
                max={today} onChange={(e) => bersihkanTanggal(e.target.value) && setAnchor(bersihkanTanggal(e.target.value))} />
            )}
            {mode === 'bulan' && (
              <input className="input" type="month" {...BATAS_MONTH} style={{ maxWidth: 165 }} aria-label={an.monthAria} value={month}
                onChange={(e) => bersihkanTanggal(e.target.value) && setMonth(bersihkanTanggal(e.target.value))} />
            )}
            <button className="icon-btn" onClick={() => shift(1)} aria-label={an.nextAria}><ChevronRight size={16} /></button>
          </div>
        )}
        {mode === 'rentang' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <input className="input" type="date" {...BATAS_DATE} style={{ maxWidth: 160 }} aria-label={an.rangeFromAria} value={range.from}
              max={today} onChange={(e) => bersihkanTanggal(e.target.value) && setRange((r) => ({ ...r, from: bersihkanTanggal(e.target.value) }))} />
            <span className="muted-sm">{an.rangeSep}</span>
            <input className="input" type="date" {...BATAS_DATE} style={{ maxWidth: 160 }} aria-label={an.rangeToAria} value={range.to}
              max={today} onChange={(e) => bersihkanTanggal(e.target.value) && setRange((r) => ({ ...r, to: bersihkanTanggal(e.target.value) }))} />
          </div>
        )}
        <div className="muted-sm" style={{ marginLeft: 'auto' }}><b>{periodTitle}</b></div>
      </div>

      {active.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee"><CalendarDays size={36} /></div>
          <h3>{an.emptyEmpTitle}</h3>
          <p>{an.emptyEmpDesc}</p>
        </div></div>
      ) : tooWide ? (
        <div className="alert alert-err">{an.tooWide}</div>
      ) : mode === 'hari' ? (
        /* ---------- TAMPILAN HARIAN: tombol status besar, mudah diklik ---------- */
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>{an.colEmployee}</th><th>{an.colStatusPrefix} {fmtDate(anchor)}</th><th style={{ textAlign: 'right' }}>{an.colNote}</th>
            </tr></thead>
            <tbody>
              {active.map((emp) => {
                const cur = byEmpDate[`${emp.id}|${anchor}`]
                return (
                  <tr key={emp.id}>
                    <td><b>{emp.name}</b><div className="muted-sm">{emp.role || '-'}</div></td>
                    <td>
                      <div className="row-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', gap: 6 }}>
                        {ATTENDANCE_STATUS.map((s) => (
                          <button key={s.key} type="button"
                            className={`badge ${cur?.status === s.key ? s.cls : ''}`}
                            style={cur?.status === s.key
                              ? { border: '1px solid transparent', cursor: 'pointer' }
                              : { background: 'transparent', color: 'var(--muted)', border: '1px solid var(--line)', cursor: 'pointer' }}
                            onClick={() => quickMark(emp.id, anchor, s.key)}>
                            {statusLabel(s.key)}
                          </button>
                        ))}
                        <button type="button" className="icon-btn" title={an.colNote}
                          aria-label={an.editAttAria.replace('{name}', emp.name)} onClick={() => openEditor(emp, anchor)}>
                          <Pencil size={14} />
                        </button>
                      </div>
                    </td>
                    <td className="muted-sm" style={{ textAlign: 'right', maxWidth: 220 }}>
                      {cur?.note || (cur ? '' : an.notFilledYet)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ---------- TAMPILAN GRID: karyawan x tanggal, klik sel untuk ubah ---------- */
        <div className="table-wrap">
          <table className="tbl att-grid">
            <thead>
              <tr>
                <th>{an.colEmployee}</th>
                {dates.map((d) => {
                  const day = new Date(d + 'T12:00:00')
                  return (
                    <th key={d} className={`att-day ${d === today ? 'att-today' : ''}`}>
                      <span className="muted-sm">{DOW_ID[day.getDay()]}</span><br />{day.getDate()}
                    </th>
                  )
                })}
                <th style={{ textAlign: 'right' }}>{an.colRecap}</th>
              </tr>
            </thead>
            <tbody>
              {active.map((emp) => {
                const rc = recap[emp.id] || { hadir: 0, izin: 0, sakit: 0, cuti: 0, alpa: 0 }
                return (
                  <tr key={emp.id}>
                    <td style={{ whiteSpace: 'nowrap' }}><b>{emp.name}</b></td>
                    {dates.map((d) => {
                      const cur = byEmpDate[`${emp.id}|${d}`]
                      const st = cur ? STATUS_BY_KEY[cur.status] : null
                      const future = d > today
                      return (
                        <td key={d} className={`att-cell ${d === today ? 'att-today' : ''}`}>
                          <button type="button" disabled={future}
                            className={`att-dot ${st ? st.cls : ''}`}
                            title={`${emp.name} · ${fmtDate(d)}${st ? ` · ${statusLabel(st.key)}` : ` · ${an.notFilledYet}`}${cur?.note ? ` · ${cur.note}` : ''}`}
                            aria-label={st ? an.editAttDateAria.replace('{name}', emp.name).replace('{date}', fmtDate(d)).replace('{status}', statusLabel(st.key)) : an.editAttDateNoneAria.replace('{name}', emp.name).replace('{date}', fmtDate(d))}
                            onClick={() => openEditor(emp, d)}>
                            {st ? LETTER[cur.status] : '·'}
                          </button>
                        </td>
                      )
                    })}
                    <td className="muted-sm" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <b className="amt-in">{rc.hadir}</b> / {rc.izin} / {rc.sakit} / {rc.cuti} / <span className="amt-out">{rc.alpa}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted-sm mt">{an.legend}</p>

      {/* ---------- ATURAN BONUS & POTONGAN PER STATUS ---------- */}
      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h3 className="card-title">{an.ruleTitle}</h3>
        <div className="card-sub">{an.ruleSub}</div>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="tbl">
            <thead><tr>
              <th>{an.colStatus}</th><th>{an.colBonus}</th><th>{an.colDeduction}</th><th>{an.colImpact}</th>
            </tr></thead>
            <tbody>
              {ATTENDANCE_STATUS.map((s) => {
                const r = ruleOf(s.key)
                const b = Number(r.bonus_per_day) || 0
                const d = Number(r.deduction_per_day) || 0
                const label = statusLabel(s.key)
                return (
                  <tr key={s.key}>
                    <td><span className={`badge ${s.cls}`}>{label}</span></td>
                    <td style={{ maxWidth: 160 }}>
                      <input className="input" type="number" min="0" step="any" defaultValue={b || ''}
                        aria-label={an.bonusAria.replace('{status}', label)}
                        placeholder="0" onBlur={(e) => patchRule(s.key, 'bonus_per_day', e.target.value)} />
                    </td>
                    <td style={{ maxWidth: 160 }}>
                      <input className="input" type="number" min="0" step="any" defaultValue={d || ''}
                        aria-label={an.deductionAria.replace('{status}', label)}
                        placeholder="0" onBlur={(e) => patchRule(s.key, 'deduction_per_day', e.target.value)} />
                    </td>
                    <td className="muted-sm">
                      {b === 0 && d === 0 ? an.noImpact
                        : `${an.impactDays.replace('{status}', label.toLowerCase())} ${b > 0 ? an.impactBonus.replace('{v}', rupiah(b * 5)) : ''}${b > 0 && d > 0 ? an.impactAnd : ''}${d > 0 ? an.impactDeduction.replace('{v}', rupiah(d * 5)) : ''}`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- EDITOR SEL: status + catatan + kosongkan ---------- */}
      {editor && (
        <Modal onClose={() => setEditor(null)} labelledBy="attEditorModalTitle">
            <div className="modal-head">
              <h3 id="attEditorModalTitle">{editor.empName} · {fmtDate(editor.date)}</h3>
              <button type="button" className="icon-btn" onClick={() => setEditor(null)} aria-label={an.close}>✕</button>
            </div>
            <div className="modal-body">
              {err && <div className="alert alert-err">{err}</div>}
              <div className="field">
                <label id="att-status-label">{an.colStatus}</label>
                <div className="row-actions" role="group" aria-labelledby="att-status-label" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', gap: 6 }}>
                  {ATTENDANCE_STATUS.map((s) => (
                    <button key={s.key} type="button"
                      aria-pressed={editor.status === s.key}
                      className={`badge ${editor.status === s.key ? s.cls : ''}`}
                      style={editor.status === s.key
                        ? { border: '1px solid transparent', cursor: 'pointer' }
                        : { background: 'transparent', color: 'var(--muted)', border: '1px solid var(--line)', cursor: 'pointer' }}
                      onClick={() => setEditor((ed) => ({ ...ed, status: s.key }))}>
                      {statusLabel(s.key)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label htmlFor="att-note">{an.colNote} <span className="muted-sm">{an.editorNoteHint}</span></label>
                <input id="att-note" className="input" value={editor.note}
                  onChange={(e) => setEditor((ed) => ({ ...ed, note: e.target.value }))} />
              </div>
              <div className="modal-foot">
                {editor.exists && (
                  <button type="button" className="btn btn-ghost btn-block" style={{ color: 'var(--red)' }}
                    disabled={busy} onClick={clearEditor}>
                    {an.clear}
                  </button>
                )}
                <button type="button" className="btn btn-ghost btn-block" onClick={() => setEditor(null)}>{an.cancel}</button>
                <button type="button" className="btn btn-primary btn-block" disabled={busy || !editor.status} onClick={saveEditor}>
                  {busy ? an.saving : an.save}
                </button>
              </div>
            </div>
        </Modal>
      )}
    </>
  )
}
