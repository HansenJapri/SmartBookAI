import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { User, Pencil, Trash2 } from 'lucide-react'
import Modal from '../components/Modal'
import { fetchEmployees, addEmployee, updateEmployee, deleteEmployee } from '../lib/api'
import { SALARY_TYPES } from '../lib/hr'
import { rupiah, fmtDate } from '../lib/format'
import { useLang } from '../context/LangContext'
import { useAlert } from '../context/AlertContext'
import { BATAS_DATE, bersihkanTanggal } from '../lib/dateInput'

const blankForm = () => ({
  id: null, name: '', role: '', phone: '', salary_type: 'bulanan',
  salary_amount: '', join_date: '', note: '',
})

// Data Karyawan: master SDM. Gaji bulanan (nominal/bulan) atau harian
// (nominal per hari HADIR — dihitung otomatis dari absensi saat penggajian).
export default function Employees() {
  const { t } = useLang()
  const { showConfirm } = useAlert()
  const ee = t.employees
  const salaryTypeLabel = (key) => (key === 'harian' ? t.hr.salaryHarian : t.hr.salaryBulanan)
  const [list, setList] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => { fetchEmployees().then(setList).catch(() => setList([])) }, [])

  const save = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.name.trim()) return setErr(ee.errName)
    const amt = Number(form.salary_amount)
    if (!amt || amt <= 0) return setErr(ee.errSalary)
    setBusy(true)
    try {
      const payload = {
        name: form.name.trim(),
        role: form.role.trim() || null,
        phone: form.phone.trim() || null,
        salary_type: form.salary_type,
        salary_amount: amt,
        join_date: form.join_date || null,
        note: form.note.trim() || null,
      }
      if (form.id) {
        const upd = await updateEmployee(form.id, payload)
        setList((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
        setMsg(ee.updatedMsg.replace('{name}', upd.name))
      } else {
        const created = await addEmployee(payload)
        setList((prev) => [...(prev || []), created].sort((a, b) => a.name.localeCompare(b.name)))
        setMsg(ee.addedMsg.replace('{name}', created.name))
      }
      setForm(null)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const toggleStatus = async (emp) => {
    const status = emp.status === 'aktif' ? 'nonaktif' : 'aktif'
    if (status === 'nonaktif' && !await showConfirm({ message: ee.confirmDeactivate.replace('{name}', emp.name) })) return
    try {
      const upd = await updateEmployee(emp.id, { status })
      setList((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
    } catch (e2) { setErr(e2.message) }
  }

  const remove = async (emp) => {
    if (!await showConfirm({ message: ee.confirmDelete.replace('{name}', emp.name), type: 'error' })) return
    try {
      await deleteEmployee(emp.id)
      setList((prev) => prev.filter((x) => x.id !== emp.id))
    } catch (e2) { setErr(e2.message) }
  }

  if (!list) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <>
      {msg && (
        <div className="alert alert-ok" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{msg}</span>
          <button className="icon-btn" onClick={() => setMsg('')} aria-label={ee.close}>✕</button>
        </div>
      )}
      {err && !form && <div className="alert alert-err">{err}</div>}

      <div className="toolbar">
        <p className="muted-sm" style={{ flex: 1, margin: 0 }}>
          {ee.hint}
        </p>
        <button className="btn btn-primary" onClick={() => { setErr(''); setForm(blankForm()) }}>{ee.addEmployee}</button>
      </div>

      {list.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee"><User size={36} /></div>
          <h3>{ee.emptyTitle}</h3>
          <p>{ee.emptyDesc}</p>
          <button className="btn btn-primary" onClick={() => setForm(blankForm())}>{ee.addFirst}</button>
        </div></div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>{ee.thName}</th><th>{ee.thRole}</th><th>{ee.thSalaryType}</th><th>{ee.thAmount}</th><th>{ee.thJoined}</th><th>{ee.thStatus}</th><th></th>
            </tr></thead>
            <tbody>
              {list.map((emp) => (
                <tr key={emp.id}>
                  {/* Klik nama -> halaman profil bulanan karyawan (P15). */}
                  <td>
                    <Link to={`/app/karyawan/${emp.id}`} className="linklike" style={{ fontWeight: 700 }}
                      title={ee.openProfile?.replace('{name}', emp.name)}>
                      {emp.name}
                    </Link>
                    {emp.phone && <div className="muted-sm">{emp.phone}</div>}
                  </td>
                  <td className="muted-sm">{emp.role || '-'}</td>
                  <td>{salaryTypeLabel(emp.salary_type)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <b>{rupiah(emp.salary_amount)}</b>
                    <span className="muted-sm">/{emp.salary_type === 'harian' ? t.hr.perHariHadir : t.hr.perBulan}</span>
                  </td>
                  <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{emp.join_date ? fmtDate(emp.join_date) : '-'}</td>
                  <td>
                    <span className={`badge ${emp.status === 'aktif' ? 'badge-green' : 'badge-red'}`}>
                      {emp.status === 'aktif' ? ee.active : ee.inactive}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="linklike" onClick={() => toggleStatus(emp)}>
                        {emp.status === 'aktif' ? ee.deactivate : ee.activate}
                      </button>
                      <button className="icon-btn" title={ee.edit} aria-label={ee.edit} onClick={() => {
                        setErr('')
                        setForm({
                          id: emp.id, name: emp.name, role: emp.role || '', phone: emp.phone || '',
                          salary_type: emp.salary_type, salary_amount: String(emp.salary_amount),
                          join_date: emp.join_date || '', note: emp.note || '',
                        })
                      }}><Pencil size={15} /></button>
                      <button className="icon-btn danger" title={ee.del} aria-label={ee.del} onClick={() => remove(emp)}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal onClose={() => setForm(null)} onSubmit={save} labelledBy="empModalTitle">
            <div className="modal-head">
              <h3 id="empModalTitle">{form.id ? ee.modalEditTitle : ee.modalAddTitle}</h3>
              <button type="button" className="icon-btn" onClick={() => setForm(null)} aria-label={ee.close}>✕</button>
            </div>
            <div className="modal-body">
              {err && <div className="alert alert-err">{err}</div>}
              <div className="field">
                <label htmlFor="emp-name">{ee.lName}</label>
                <input id="emp-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={ee.namePh} />
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="emp-role">{ee.lRole} <span className="muted-sm">{ee.optional}</span></label>
                  <input id="emp-role" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder={ee.rolePh} />
                </div>
                <div className="field">
                  <label htmlFor="emp-phone">{ee.lPhone} <span className="muted-sm">{ee.optional}</span></label>
                  <input id="emp-phone" className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder={ee.phonePh} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="emp-salary-type">{ee.lSalaryType}</label>
                <select id="emp-salary-type" className="input" value={form.salary_type} onChange={(e) => setForm({ ...form, salary_type: e.target.value })}>
                  {SALARY_TYPES.map((st) => <option key={st.key} value={st.key}>{salaryTypeLabel(st.key)}</option>)}
                </select>
                {form.salary_type === 'harian' && (
                  <p className="muted-sm" style={{ margin: '6px 0 0' }}>
                    {ee.harianHintPre}<b>{ee.harianHintBold}</b>{ee.harianHintPost}
                  </p>
                )}
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="emp-salary-amount">{ee.lSalaryAmount}</label>
                  <input id="emp-salary-amount" className="input" type="number" min="0" step="any" value={form.salary_amount}
                    onChange={(e) => setForm({ ...form, salary_amount: e.target.value })} placeholder={form.salary_type === 'harian' ? '100000' : '2500000'} />
                </div>
                <div className="field">
                  <label htmlFor="emp-join-date">{ee.lJoinDate} <span className="muted-sm">{ee.optional}</span></label>
                  <input id="emp-join-date" className="input" type="date" {...BATAS_DATE} value={form.join_date} onChange={(e) => setForm({ ...form, join_date: bersihkanTanggal(e.target.value) })} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="emp-note">{ee.lNote} <span className="muted-sm">{ee.optional}</span></label>
                <input id="emp-note" className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost btn-block" onClick={() => setForm(null)}>{ee.cancel}</button>
                <button className="btn btn-primary btn-block" disabled={busy}>{busy ? ee.saving : ee.save}</button>
              </div>
            </div>
        </Modal>
      )}
    </>
  )
}
