import { useEffect, useMemo, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { fetchEmployees, fetchAttendanceByDate, fetchAttendanceRange, setAttendance } from '../lib/api'
import { ATTENDANCE_STATUS, currentPeriod, periodRange } from '../lib/hr'

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Absensi & Cuti: pilih tanggal, klik status per karyawan (langsung tersimpan).
// Rekap bulan berjalan tampil di bawah — dipakai otomatis oleh Penggajian
// untuk karyawan bergaji harian.
export default function Attendance() {
  const [employees, setEmployees] = useState(null)
  const [date, setDate] = useState(todayISO())
  const [rows, setRows] = useState([])       // absensi tanggal terpilih
  const [monthRows, setMonthRows] = useState([]) // absensi bulan berjalan (rekap)
  const [busyId, setBusyId] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => { fetchEmployees().then(setEmployees).catch(() => setEmployees([])) }, [])
  useEffect(() => { fetchAttendanceByDate(date).then(setRows).catch(() => setRows([])) }, [date])
  useEffect(() => {
    const { from, to } = periodRange(currentPeriod())
    fetchAttendanceRange(from, to).then(setMonthRows).catch(() => {})
  }, [rows.length]) // segarkan rekap saat ada perubahan

  const active = useMemo(() => (employees || []).filter((e) => e.status === 'aktif'), [employees])
  const statusOf = (empId) => rows.find((r) => r.employee_id === empId)?.status || ''

  const mark = async (empId, status) => {
    setErr('')
    setBusyId(empId)
    try {
      const saved = await setAttendance(empId, date, status)
      setRows((prev) => {
        const others = prev.filter((r) => r.employee_id !== empId)
        return [...others, saved]
      })
    } catch (e2) { setErr(e2.message) } finally { setBusyId(null) }
  }

  const recap = useMemo(() => {
    const per = {}
    for (const r of monthRows) {
      per[r.employee_id] = per[r.employee_id] || { hadir: 0, izin: 0, sakit: 0, cuti: 0, alpa: 0 }
      if (per[r.employee_id][r.status] !== undefined) per[r.employee_id][r.status]++
    }
    return per
  }, [monthRows])

  if (!employees) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <>
      {err && <div className="alert alert-err">{err}</div>}
      <div className="toolbar">
        <label className="muted-sm" style={{ whiteSpace: 'nowrap' }}>Tanggal:</label>
        <input className="input" type="date" style={{ maxWidth: 180 }} value={date}
          onChange={(e) => setDate(e.target.value)} max={todayISO()} />
        <p className="muted-sm" style={{ flex: 1, margin: 0 }}>
          Klik status per karyawan — langsung tersimpan. Salah klik? Klik status lain untuk mengganti.
        </p>
      </div>

      {active.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee"><CalendarDays size={36} /></div>
          <h3>Belum ada karyawan aktif</h3>
          <p>Tambahkan karyawan di menu Data Karyawan terlebih dulu.</p>
        </div></div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Karyawan</th><th>Status hari ini</th><th style={{ textAlign: 'right' }}>Rekap bulan ini (H/I/S/C/A)</th>
            </tr></thead>
            <tbody>
              {active.map((emp) => {
                const cur = statusOf(emp.id)
                const rc = recap[emp.id] || { hadir: 0, izin: 0, sakit: 0, cuti: 0, alpa: 0 }
                return (
                  <tr key={emp.id}>
                    <td><b>{emp.name}</b><div className="muted-sm">{emp.role || '-'}</div></td>
                    <td>
                      <div className="row-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', gap: 6 }}>
                        {ATTENDANCE_STATUS.map((s) => (
                          <button key={s.key} type="button" disabled={busyId === emp.id}
                            className={`badge ${cur === s.key ? s.cls : ''}`}
                            style={cur === s.key
                              ? { border: '1px solid transparent', cursor: 'pointer' }
                              : { background: 'transparent', color: 'var(--muted)', border: '1px solid var(--line)', cursor: 'pointer' }}
                            onClick={() => mark(emp.id, s.key)}>
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </td>
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
      <p className="muted-sm mt">
        H = Hadir · I = Izin · S = Sakit · C = Cuti · A = Alpa. Jumlah hari <b>Hadir</b> dipakai otomatis
        untuk menghitung gaji karyawan harian di menu Penggajian.
      </p>
    </>
  )
}
