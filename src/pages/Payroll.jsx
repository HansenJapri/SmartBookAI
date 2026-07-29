import { useEffect, useMemo, useState } from 'react'
import { Banknote } from 'lucide-react'
import Modal from '../components/Modal'
import {
  fetchEmployees, fetchPayrolls, addPayroll, updatePayroll, deletePayroll, payPayroll,
  fetchAttendanceRange, fetchAttendanceRules, fetchKpiCriteria, fetchKpiScores, fetchKpiBonusRules,
} from '../lib/api'
import {
  currentPeriod, periodLabel, periodRange, countHadir, buildPayrollBase, payrollTotal, PAYROLL_STATUS,
} from '../lib/hr'
import { attendanceAdjustments, recapAttendance, weightedTotal, applyBonusTier } from '../lib/kpi'
import { rupiah, fmtDate } from '../lib/format'
import { useCatalog } from '../context/CatalogContext'
import { useLang } from '../context/LangContext'

// Penggajian per periode: draf dihitung otomatis (bulanan = nominal tetap;
// harian = tarif x hari hadir dari absensi), bonus/potongan bisa diubah,
// lalu "Bayar" mencatat transaksi pengeluaran -> cashflow & Laba Rugi.
export default function Payroll() {
  const { t } = useLang()
  const pr = t.payroll
  const statusLabel = (key) => (key === 'paid' ? pr.statusPaid : pr.statusDraft)
  const { catNames } = useCatalog()
  const [employees, setEmployees] = useState(null)
  const [period, setPeriod] = useState(currentPeriod())
  const [rows, setRows] = useState(null)
  const [payTarget, setPayTarget] = useState(null)
  const [payCategory, setPayCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const expenseCats = catNames('out')

  useEffect(() => { fetchEmployees().then(setEmployees).catch(() => setEmployees([])) }, [])
  useEffect(() => { setRows(null); fetchPayrolls(period).then(setRows).catch(() => setRows([])) }, [period])

  const empOf = (id) => (employees || []).find((e) => e.id === id)
  const activeEmps = useMemo(() => (employees || []).filter((e) => e.status === 'aktif'), [employees])

  // Buat draf untuk karyawan aktif yang belum punya baris di periode ini.
  // Bonus/potongan awal dihitung otomatis dari aturan absensi + hasil KPI
  // tersimpan — tetap bisa diubah manual selama masih draf.
  const generate = async () => {
    setErr(''); setMsg(''); setBusy(true)
    try {
      const { from, to } = periodRange(period)
      const [att, attRules, kpiCriteria, kpiScores, kpiRules] = await Promise.all([
        fetchAttendanceRange(from, to),
        fetchAttendanceRules().catch(() => []),
        fetchKpiCriteria().catch(() => []),
        fetchKpiScores(period).catch(() => []),
        fetchKpiBonusRules().catch(() => []),
      ])
      const existing = new Set((rows || []).map((r) => r.employee_id))
      const created = []
      for (const emp of activeEmps) {
        if (existing.has(emp.id)) continue
        const hadir = countHadir(att, emp.id)
        const base = buildPayrollBase(emp, hadir)

        // Efek aturan absensi (per hari x jumlah hari status tsb).
        const adj = attendanceAdjustments(recapAttendance(att, emp.id), attRules)

        // Efek KPI: pakai skor TERSIMPAN periode ini (dari menu KPI Karyawan).
        const scoreByCrit = {}
        for (const s of kpiScores) if (s.employee_id === emp.id) scoreByCrit[s.criteria_id] = Number(s.score)
        const kpiTotal = weightedTotal(kpiCriteria.filter((c) => c.active !== false), scoreByCrit)
        const tier = applyBonusTier(kpiRules, kpiTotal)

        const bonus = adj.bonus + (tier?.bonus || 0)
        const deduction = adj.deduction + (tier?.deduction || 0)
        const noteParts = []
        if (emp.salary_type === 'harian') noteParts.push(pr.hadirNote.replace('{n}', hadir).replace('{amount}', rupiah(emp.salary_amount)))
        if (adj.detail.length) noteParts.push(adj.detail.join(', '))
        if (tier) noteParts.push(pr.kpiNote.replace('{score}', kpiTotal) + (tier.rule.label ? ` (${tier.rule.label})` : ''))

        const row = await addPayroll({
          employee_id: emp.id, period, base_amount: base, bonus, deduction,
          total: payrollTotal({ base_amount: base, bonus, deduction }),
          note: noteParts.length ? noteParts.join(' · ') : null,
        })
        created.push(row)
      }
      if (created.length) {
        setRows((prev) => [...(prev || []), ...created])
        setMsg(pr.draftCreatedMsg.replace('{n}', created.length).replace('{period}', periodLabel(period)))
      } else {
        setMsg(activeEmps.length === 0 ? pr.noActiveEmp : pr.allHaveRows)
      }
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const patchRow = async (row, patch) => {
    const base = { base_amount: row.base_amount, bonus: row.bonus, deduction: row.deduction, ...patch }
    try {
      const upd = await updatePayroll(row.id, { ...patch, total: payrollTotal(base) })
      setRows((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
    } catch (e2) { setErr(e2.message) }
  }

  const removeRow = async (row) => {
    if (!confirm(pr.confirmDelDraft.replace('{name}', empOf(row.employee_id)?.name || ''))) return
    try {
      await deletePayroll(row.id)
      setRows((prev) => prev.filter((x) => x.id !== row.id))
    } catch (e2) { setErr(e2.message) }
  }

  const openPay = (row) => {
    setErr('')
    setPayCategory(expenseCats.includes('Gaji Karyawan') ? 'Gaji Karyawan' : (expenseCats[0] || ''))
    setPayTarget(row)
  }

  const doPay = async () => {
    const row = payTarget
    const emp = empOf(row.employee_id)
    setBusy(true); setErr('')
    try {
      const res = await payPayroll(row, {
        employeeName: emp?.name || '', category: payCategory, periodText: periodLabel(period),
      })
      setRows((prev) => prev.map((x) => (x.id === res.payroll.id ? res.payroll : x)))
      setMsg(pr.paidMsg.replace('{name}', emp?.name).replace('{amount}', rupiah(res.txn.amount)))
      setPayTarget(null)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const totalPeriode = (rows || []).reduce((s, r) => s + (Number(r.total) || 0), 0)

  if (!employees || !rows) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <>
      {msg && (
        <div className="alert alert-ok" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{msg}</span>
          <button className="icon-btn" onClick={() => setMsg('')} aria-label={pr.close}>✕</button>
        </div>
      )}
      {err && <div className="alert alert-err">{err}</div>}

      <div className="toolbar">
        <label className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{pr.period}</label>
        <input className="input" type="month" style={{ maxWidth: 180 }} aria-label={pr.periodAria} value={period}
          onChange={(e) => setPeriod(e.target.value)} />
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={generate} disabled={busy}>
          {busy ? pr.calculating : pr.genDraft}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee"><Banknote size={36} /></div>
          <h3>{pr.emptyTitle.replace('{period}', periodLabel(period))}</h3>
          <p>{pr.emptyDesc}</p>
          <button className="btn btn-primary" onClick={generate} disabled={busy}>{pr.genDraft}</button>
        </div></div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr>
                <th>{pr.thEmployee}</th><th>{pr.thBase}</th><th>{pr.thBonus}</th><th>{pr.thDeduction}</th><th>{pr.thTotal}</th><th>{pr.thStatus}</th><th></th>
              </tr></thead>
              <tbody>
                {rows.map((row) => {
                  const emp = empOf(row.employee_id)
                  const st = PAYROLL_STATUS[row.status] || PAYROLL_STATUS.draft
                  const draft = row.status === 'draft'
                  return (
                    <tr key={row.id}>
                      <td>
                        <b>{emp?.name || pr.deletedEmp}</b>
                        {row.note && <div className="muted-sm">{row.note}</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{rupiah(row.base_amount)}</td>
                      <td style={{ maxWidth: 120 }}>
                        {draft ? (
                          <input className="input" type="number" min="0" step="any" value={row.bonus}
                            aria-label={pr.bonusAria.replace('{name}', empOf(row.employee_id)?.name || pr.defaultEmpName)}
                            onChange={(e) => patchRow(row, { bonus: Number(e.target.value) || 0 })} />
                        ) : rupiah(row.bonus)}
                      </td>
                      <td style={{ maxWidth: 120 }}>
                        {draft ? (
                          <input className="input" type="number" min="0" step="any" value={row.deduction}
                            aria-label={pr.deductionAria.replace('{name}', empOf(row.employee_id)?.name || pr.defaultEmpName)}
                            onChange={(e) => patchRow(row, { deduction: Number(e.target.value) || 0 })} />
                        ) : rupiah(row.deduction)}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}><b>{rupiah(row.total)}</b></td>
                      <td>
                        <span className={`badge ${st.cls}`}>{statusLabel(row.status)}</span>
                        {row.paid_at && <div className="muted-sm">{fmtDate(row.paid_at)}</div>}
                      </td>
                      <td>
                        <div className="row-actions">
                          {draft && (
                            <>
                              <button className="linklike" onClick={() => openPay(row)}>{pr.pay}</button>
                              <button className="linklike" style={{ color: 'var(--red)' }} onClick={() => removeRow(row)}>{pr.del}</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="muted-sm mt">
            {pr.footerTotal.replace('{period}', periodLabel(period))} <b>{rupiah(totalPeriode)}</b> ·
            {pr.footerNote}
          </p>
        </>
      )}

      {/* Konfirmasi bayar (dialog berujung tuntas — HCI rule 4) */}
      {payTarget && (
        <Modal onClose={() => setPayTarget(null)} labelledBy="payModalTitle">
            <div className="modal-head">
              <h3 id="payModalTitle">{pr.payTitle.replace('{name}', empOf(payTarget.employee_id)?.name)}</h3>
              <button type="button" className="icon-btn" onClick={() => setPayTarget(null)} aria-label={pr.close}>✕</button>
            </div>
            <div className="modal-body">
              {err && <div className="alert alert-err">{err}</div>}
              <p style={{ marginTop: 0 }}>
                {pr.payDesc
                  .replace('{period}', periodLabel(period))
                  .replace('{total}', rupiah(payTarget.total))
                  .replace('{base}', rupiah(payTarget.base_amount))
                  .replace('{bonus}', rupiah(payTarget.bonus))
                  .replace('{deduction}', rupiah(payTarget.deduction))}
              </p>
              <div className="field">
                <label htmlFor="payroll-category">{pr.lCategory}</label>
                <select id="payroll-category" className="input" value={payCategory} onChange={(e) => setPayCategory(e.target.value)}>
                  {expenseCats.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {!expenseCats.includes('Gaji Karyawan') && (
                  <p className="muted-sm" style={{ margin: '6px 0 0' }}>
                    {pr.catTip}
                  </p>
                )}
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost btn-block" onClick={() => setPayTarget(null)}>{pr.cancel}</button>
                <button className="btn btn-primary btn-block" disabled={busy || !payCategory} onClick={doPay}>
                  {busy ? pr.processing : pr.confirmPay}
                </button>
              </div>
            </div>
        </Modal>
      )}
    </>
  )
}
