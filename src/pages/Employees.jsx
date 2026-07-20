import { useEffect, useState } from 'react'
import { User, Pencil, Trash2 } from 'lucide-react'
import Modal from '../components/Modal'
import { fetchEmployees, addEmployee, updateEmployee, deleteEmployee } from '../lib/api'
import { SALARY_TYPES } from '../lib/hr'
import { rupiah, fmtDate } from '../lib/format'

const blankForm = () => ({
  id: null, name: '', role: '', phone: '', salary_type: 'bulanan',
  salary_amount: '', join_date: '', note: '',
})

// Data Karyawan: master SDM. Gaji bulanan (nominal/bulan) atau harian
// (nominal per hari HADIR — dihitung otomatis dari absensi saat penggajian).
export default function Employees() {
  const [list, setList] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => { fetchEmployees().then(setList).catch(() => setList([])) }, [])

  const save = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.name.trim()) return setErr('Nama karyawan wajib diisi.')
    const amt = Number(form.salary_amount)
    if (!amt || amt <= 0) return setErr('Nominal gaji harus lebih dari 0.')
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
        setMsg(`Data ${upd.name} diperbarui.`)
      } else {
        const created = await addEmployee(payload)
        setList((prev) => [...(prev || []), created].sort((a, b) => a.name.localeCompare(b.name)))
        setMsg(`${created.name} ditambahkan. Catat absensinya di menu Absensi & Cuti.`)
      }
      setForm(null)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const toggleStatus = async (emp) => {
    const status = emp.status === 'aktif' ? 'nonaktif' : 'aktif'
    if (status === 'nonaktif' && !confirm(`Nonaktifkan ${emp.name}? Dia tidak ikut absensi & penggajian berikutnya (riwayat tetap tersimpan).`)) return
    try {
      const upd = await updateEmployee(emp.id, { status })
      setList((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
    } catch (e2) { setErr(e2.message) }
  }

  const remove = async (emp) => {
    if (!confirm(`Hapus ${emp.name} beserta riwayat absensinya? Tindakan ini terekam di Audit Log.`)) return
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
          <button className="icon-btn" onClick={() => setMsg('')} aria-label="Tutup">✕</button>
        </div>
      )}
      {err && !form && <div className="alert alert-err">{err}</div>}

      <div className="toolbar">
        <p className="muted-sm" style={{ flex: 1, margin: 0 }}>
          Gaji karyawan otomatis masuk Biaya Operasional di Laba Rugi saat dibayar lewat menu Penggajian.
        </p>
        <button className="btn btn-primary" onClick={() => { setErr(''); setForm(blankForm()) }}>+ Tambah Karyawan</button>
      </div>

      {list.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee"><User size={36} /></div>
          <h3>Belum ada karyawan</h3>
          <p>Tambahkan karyawan untuk mulai mencatat absensi dan menghitung gaji otomatis.</p>
          <button className="btn btn-primary" onClick={() => setForm(blankForm())}>+ Tambah Karyawan Pertama</button>
        </div></div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Nama</th><th>Jabatan</th><th>Tipe gaji</th><th>Nominal</th><th>Bergabung</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {list.map((emp) => (
                <tr key={emp.id}>
                  <td><b>{emp.name}</b>{emp.phone && <div className="muted-sm">{emp.phone}</div>}</td>
                  <td className="muted-sm">{emp.role || '-'}</td>
                  <td>{emp.salary_type === 'harian' ? 'Harian' : 'Bulanan'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <b>{rupiah(emp.salary_amount)}</b>
                    <span className="muted-sm">/{emp.salary_type === 'harian' ? 'hari hadir' : 'bulan'}</span>
                  </td>
                  <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{emp.join_date ? fmtDate(emp.join_date) : '-'}</td>
                  <td>
                    <span className={`badge ${emp.status === 'aktif' ? 'badge-green' : 'badge-red'}`}>
                      {emp.status === 'aktif' ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="linklike" onClick={() => toggleStatus(emp)}>
                        {emp.status === 'aktif' ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                      <button className="icon-btn" title="Ubah" aria-label="Ubah" onClick={() => {
                        setErr('')
                        setForm({
                          id: emp.id, name: emp.name, role: emp.role || '', phone: emp.phone || '',
                          salary_type: emp.salary_type, salary_amount: String(emp.salary_amount),
                          join_date: emp.join_date || '', note: emp.note || '',
                        })
                      }}><Pencil size={15} /></button>
                      <button className="icon-btn danger" title="Hapus" aria-label="Hapus" onClick={() => remove(emp)}><Trash2 size={15} /></button>
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
              <h3 id="empModalTitle">{form.id ? 'Ubah Karyawan' : 'Tambah Karyawan'}</h3>
              <button type="button" className="icon-btn" onClick={() => setForm(null)} aria-label="Tutup">✕</button>
            </div>
            <div className="modal-body">
              {err && <div className="alert alert-err">{err}</div>}
              <div className="field">
                <label>Nama</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="cth: Andi" />
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Jabatan <span className="muted-sm">(opsional)</span></label>
                  <input className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="cth: Kasir" />
                </div>
                <div className="field">
                  <label>No. HP / WA <span className="muted-sm">(opsional)</span></label>
                  <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08xxxxxxxxxx" />
                </div>
              </div>
              <div className="field">
                <label>Tipe gaji</label>
                <select className="input" value={form.salary_type} onChange={(e) => setForm({ ...form, salary_type: e.target.value })}>
                  {SALARY_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
                {form.salary_type === 'harian' && (
                  <p className="muted-sm" style={{ margin: '6px 0 0' }}>
                    Gaji harian dihitung otomatis: tarif × jumlah hari <b>Hadir</b> di absensi bulan tersebut.
                  </p>
                )}
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Nominal gaji (Rp)</label>
                  <input className="input" type="number" min="0" step="any" value={form.salary_amount}
                    onChange={(e) => setForm({ ...form, salary_amount: e.target.value })} placeholder={form.salary_type === 'harian' ? '100000' : '2500000'} />
                </div>
                <div className="field">
                  <label>Tanggal bergabung <span className="muted-sm">(opsional)</span></label>
                  <input className="input" type="date" value={form.join_date} onChange={(e) => setForm({ ...form, join_date: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label>Catatan <span className="muted-sm">(opsional)</span></label>
                <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost btn-block" onClick={() => setForm(null)}>Batal</button>
                <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
              </div>
            </div>
        </Modal>
      )}
    </>
  )
}
