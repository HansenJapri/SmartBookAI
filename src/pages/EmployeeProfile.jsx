import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, User, CalendarDays, Gauge, Banknote } from 'lucide-react'
import {
  fetchEmployees, fetchAttendanceRange, fetchAttendanceRules,
  fetchKpiCriteria, fetchKpiScores, fetchKpiBonusRules, fetchPayrolls, fetchTasks,
} from '../lib/api'
import { currentPeriod, periodLabel, periodRange, ATTENDANCE_STATUS, SALARY_TYPES, PAYROLL_STATUS } from '../lib/hr'
import {
  attendanceScore, taskScore, recapAttendance, weightedTotal, applyBonusTier, attendanceAdjustments,
} from '../lib/kpi'
import { rupiah, fmtDate } from '../lib/format'
import { useLang } from '../context/LangContext'

// Halaman profil karyawan (P15).
//
// Sebelumnya data satu karyawan tersebar di empat menu: Data Karyawan (identitas),
// Absensi & Cuti (kehadiran), KPI Karyawan (skor), dan Penggajian (gaji). Untuk
// menjawab satu pertanyaan biasa — "bulan lalu si A bagaimana?" — pemilik usaha
// harus membuka empat halaman dan menyamakan periodenya sendiri di tiap halaman.
// Halaman ini menyatukannya di satu periode, dengan navigator bulan supaya
// riwayat bulan-bulan sebelumnya bisa ditelusuri tanpa berpindah menu.

const geserPeriode = (period, delta) => {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(y, (m - 1) + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function EmployeeProfile() {
  const { id } = useParams()
  const nav = useNavigate()
  const { t } = useLang()
  const ep = t.employeeProfile

  const [employee, setEmployee] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [period, setPeriod] = useState(currentPeriod())
  const [attRows, setAttRows] = useState([])
  const [attRules, setAttRules] = useState([])
  const [criteria, setCriteria] = useState([])
  const [savedScores, setSavedScores] = useState([])
  const [bonusRules, setBonusRules] = useState([])
  const [payrolls, setPayrolls] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchEmployees()
      .then((list) => {
        const found = (list || []).find((e) => e.id === id)
        if (found) setEmployee(found)
        else setNotFound(true)
      })
      .catch(() => setNotFound(true))
    fetchAttendanceRules().then(setAttRules).catch(() => {})
    fetchKpiCriteria().then(setCriteria).catch(() => {})
    fetchKpiBonusRules().then(setBonusRules).catch(() => {})
    fetchTasks().then(setTasks).catch(() => {})
  }, [id])

  // Data yang bergantung periode ditarik ulang setiap navigator bulan digeser.
  useEffect(() => {
    let batal = false
    setLoading(true)
    const { from, to } = periodRange(period)
    Promise.all([
      fetchAttendanceRange(from, to).catch(() => []),
      fetchKpiScores(period).catch(() => []),
      fetchPayrolls(period).catch(() => []),
    ]).then(([att, skor, gaji]) => {
      if (batal) return
      setAttRows(att); setSavedScores(skor); setPayrolls(gaji)
    }).finally(() => { if (!batal) setLoading(false) })
    return () => { batal = true }
  }, [period])

  const rekap = useMemo(() => recapAttendance(attRows, id), [attRows, id])
  const hariTercatat = Object.values(rekap).reduce((s, n) => s + n, 0)

  const activeCriteria = useMemo(() => (criteria || []).filter((c) => c.active !== false), [criteria])

  // Urutan yang sama dengan halaman KPI: hitung otomatis mengalahkan nilai
  // tersimpan untuk kriteria kehadiran & tugas, supaya koreksi absensi
  // langsung terbaca di sini juga.
  const skorPer = useMemo(() => {
    const out = {}
    for (const c of activeCriteria) {
      const saved = savedScores.find((s) => s.employee_id === id && s.criteria_id === c.id)
      if (c.source === 'kehadiran') {
        const hitung = attendanceScore(rekap)
        out[c.id] = hitung !== null ? hitung : (saved ? Number(saved.score) : null)
      } else if (c.source === 'tugas') {
        const hitung = taskScore(tasks, id, period)
        out[c.id] = hitung !== null ? hitung : (saved ? Number(saved.score) : null)
      } else {
        out[c.id] = saved ? Number(saved.score) : null
      }
    }
    return out
  }, [activeCriteria, savedScores, rekap, tasks, id, period])

  const totalKpi = weightedTotal(activeCriteria, skorPer)
  const jenjang = applyBonusTier(bonusRules, totalKpi)
  const penyesuaian = useMemo(() => attendanceAdjustments(rekap, attRules), [rekap, attRules])
  const gajiPeriode = payrolls.find((p) => p.employee_id === id) || null

  const statusLabel = (key) => ATTENDANCE_STATUS.find((s) => s.key === key)?.label || key
  const salaryLabel = SALARY_TYPES.find((s) => s.key === employee?.salary_type)?.label || employee?.salary_type

  if (notFound) {
    return (
      <div className="card card-pad">
        <p>{ep.notFound}</p>
        <button className="btn btn-ghost" onClick={() => nav('/app/karyawan')}>
          <ArrowLeft size={15} style={{ verticalAlign: '-3px', marginRight: 4 }} />{ep.back}
        </button>
      </div>
    )
  }
  if (!employee) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <div style={{ maxWidth: 1040 }}>
      <div className="toolbar">
        <Link to="/app/karyawan" className="btn btn-ghost">
          <ArrowLeft size={15} style={{ verticalAlign: '-3px', marginRight: 4 }} />{ep.back}
        </Link>
        <div style={{ flex: 1 }} />
        {/* Navigator bulan: satu kendali periode untuk SELURUH halaman, jadi
            absensi, KPI, dan gaji tidak mungkin lagi menampilkan bulan berbeda. */}
        <div className="flex gap" style={{ alignItems: 'center' }} role="group" aria-label={ep.periodNav}>
          <button className="icon-btn" onClick={() => setPeriod((p) => geserPeriode(p, -1))} aria-label={ep.prevMonth} title={ep.prevMonth}>
            <ChevronLeft size={18} />
          </button>
          <b style={{ minWidth: 140, textAlign: 'center' }}>{periodLabel(period)}</b>
          <button className="icon-btn" onClick={() => setPeriod((p) => geserPeriode(p, 1))}
            disabled={period >= currentPeriod()} aria-label={ep.nextMonth} title={ep.nextMonth}>
            <ChevronRight size={18} />
          </button>
          {period !== currentPeriod() && (
            <button className="btn btn-ghost" onClick={() => setPeriod(currentPeriod())}>{ep.thisMonth}</button>
          )}
        </div>
      </div>

      {/* Identitas */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="flex gap" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="alert-dlg-icon" style={{ color: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 12%, transparent)' }}>
            <User size={22} aria-hidden="true" />
          </span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h3 className="card-title" style={{ margin: 0 }}>{employee.name}</h3>
            <div className="card-sub">
              {employee.role || ep.noRole}
              {employee.phone ? ` · ${employee.phone}` : ''}
              {employee.join_date ? ` · ${ep.joined} ${fmtDate(employee.join_date)}` : ''}
            </div>
          </div>
          <span className={`badge ${employee.status === 'aktif' ? 'badge-green' : 'badge-amber'}`}>
            {employee.status === 'aktif' ? ep.active : ep.inactive}
          </span>
          <div style={{ textAlign: 'right' }}>
            <div className="muted-sm">{salaryLabel}</div>
            <b>{rupiah(employee.salary_amount)}</b>
          </div>
        </div>
      </div>

      {loading ? <div className="spinner" style={{ margin: '24px auto' }} /> : (
        <>
          {/* Kehadiran periode ini */}
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <h3 className="card-title">
              <CalendarDays size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />
              {ep.attendanceTitle.replace('{period}', periodLabel(period))}
            </h3>
            {hariTercatat === 0 ? (
              <p className="muted-sm">{ep.attendanceEmpty}</p>
            ) : (
              <>
                <div className="grid-kpi" style={{ marginTop: 10 }}>
                  {ATTENDANCE_STATUS.map((s) => (
                    <div className="card" key={s.key}>
                      <div className="kpi-l">{s.label}</div>
                      <div className="kpi-v">{rekap[s.key] || 0}</div>
                      <div className="kpi-d muted-sm">{ep.days}</div>
                    </div>
                  ))}
                </div>
                <p className="muted-sm" style={{ marginTop: 10 }}>
                  {ep.attendanceSummary
                    .replace('{total}', hariTercatat)
                    .replace('{score}', attendanceScore(rekap) ?? '-')}
                </p>
                {(penyesuaian.bonus > 0 || penyesuaian.deduction > 0) && (
                  <div className="alert alert-info" style={{ marginTop: 8 }}>
                    {ep.attendanceAdj
                      .replace('{bonus}', rupiah(penyesuaian.bonus))
                      .replace('{deduction}', rupiah(penyesuaian.deduction))}
                    {penyesuaian.detail?.length ? ` (${penyesuaian.detail.join(', ')})` : ''}
                  </div>
                )}
              </>
            )}
            <Link to="/app/absensi" className="linklike" style={{ display: 'inline-block', marginTop: 8 }}>{ep.toAttendance}</Link>
          </div>

          {/* KPI periode ini */}
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <h3 className="card-title">
              <Gauge size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />
              {ep.kpiTitle.replace('{period}', periodLabel(period))}
            </h3>
            {activeCriteria.length === 0 ? (
              <p className="muted-sm">{ep.kpiNoCriteria}</p>
            ) : (
              <>
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table className="tbl">
                    <thead><tr>
                      <th style={{ minWidth: 180 }}>{ep.thCriteria}</th>
                      <th style={{ minWidth: 130 }}>{ep.thWeight}</th>
                      <th style={{ minWidth: 130 }}>{ep.thSource}</th>
                      <th style={{ minWidth: 110, textAlign: 'right' }}>{ep.thScore}</th>
                    </tr></thead>
                    <tbody>
                      {activeCriteria.map((c) => (
                        <tr key={c.id}>
                          <td><b>{c.name}</b></td>
                          <td>{Number(c.weight)}%</td>
                          <td className="muted-sm">{ep.sources[c.source] || c.source}</td>
                          <td style={{ textAlign: 'right' }}>
                            {skorPer[c.id] === null || skorPer[c.id] === undefined
                              ? <span className="muted-sm">{ep.notScored}</span>
                              : <b>{skorPer[c.id]}</b>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pnl" style={{ marginTop: 10 }}>
                  <div className="pnl-row pnl-net">
                    <span>{ep.kpiTotal}</span>
                    <b>{totalKpi === null ? ep.notScored : totalKpi}</b>
                  </div>
                  {jenjang && (
                    <div className="pnl-row">
                      <span>{ep.kpiTier}{jenjang.rule.label ? ` — ${jenjang.rule.label}` : ''}</span>
                      <b>
                        {jenjang.bonus > 0 ? `+${rupiah(jenjang.bonus)}` : ''}
                        {jenjang.deduction > 0 ? ` −${rupiah(jenjang.deduction)}` : ''}
                        {!jenjang.bonus && !jenjang.deduction ? '—' : ''}
                      </b>
                    </div>
                  )}
                </div>
              </>
            )}
            <Link to="/app/kpi" className="linklike" style={{ display: 'inline-block', marginTop: 8 }}>{ep.toKpi}</Link>
          </div>

          {/* Gaji periode ini */}
          <div className="card card-pad">
            <h3 className="card-title">
              <Banknote size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />
              {ep.payrollTitle.replace('{period}', periodLabel(period))}
            </h3>
            {!gajiPeriode ? (
              <p className="muted-sm">{ep.payrollEmpty}</p>
            ) : (
              <div className="pnl" style={{ marginTop: 8 }}>
                <div className="pnl-row"><span>{ep.pBase}</span><b>{rupiah(gajiPeriode.base_amount)}</b></div>
                <div className="pnl-row"><span>{ep.pBonus}</span><b className="amt-in">+{rupiah(gajiPeriode.bonus)}</b></div>
                <div className="pnl-row"><span>{ep.pDeduction}</span><b className="amt-out">−{rupiah(gajiPeriode.deduction)}</b></div>
                <div className="pnl-row pnl-net"><span>{ep.pTotal}</span><b>{rupiah(gajiPeriode.total)}</b></div>
                <div className="pnl-row">
                  <span>{ep.pStatus}</span>
                  <span className={`badge ${(PAYROLL_STATUS[gajiPeriode.status] || PAYROLL_STATUS.draft).cls}`}>
                    {gajiPeriode.status === 'paid' ? ep.paid : ep.draft}
                  </span>
                </div>
                {gajiPeriode.note && <p className="muted-sm" style={{ margin: '8px 0 0' }}>{gajiPeriode.note}</p>}
              </div>
            )}
            <Link to="/app/gaji" className="linklike" style={{ display: 'inline-block', marginTop: 8 }}>{ep.toPayroll}</Link>
          </div>
        </>
      )}
    </div>
  )
}
