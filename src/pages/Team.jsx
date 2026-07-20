import { useEffect, useState } from 'react'
import { Users, Trash2, Pencil } from 'lucide-react'
import Modal from '../components/Modal'
import { fetchStaff, addStaff, updateStaff, deleteStaff, fetchMyMembership } from '../lib/api'
import { MODULES, STAFF_STATUS } from '../lib/rbac'
import { fmtDate } from '../lib/format'

const blankForm = () => ({ id: null, email: '', modules: [] })

// Pengguna & Hak Akses (owner): undang staf via email, batasi per modul.
// Staf mendaftar/login dengan email yang diundang -> otomatis aktif, dan
// hanya melihat menu + data modul yang diizinkan (dijaga RLS di database).
export default function Team() {
  const [list, setList] = useState(null)
  const [membership, setMembership] = useState(null) // bila BUKAN owner
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    fetchStaff().then(setList).catch(() => setList([]))
    fetchMyMembership().then(setMembership).catch(() => {})
  }, [])

  const toggleModule = (key) => setForm((f) => ({
    ...f,
    modules: f.modules.includes(key) ? f.modules.filter((m) => m !== key) : [...f.modules, key],
  }))

  const save = async (e) => {
    e.preventDefault()
    setErr('')
    const email = form.email.trim().toLowerCase()
    if (!form.id && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setErr('Format email tidak valid.')
    if (form.modules.length === 0) return setErr('Pilih minimal satu modul akses.')
    setBusy(true)
    try {
      if (form.id) {
        const upd = await updateStaff(form.id, { modules: form.modules })
        setList((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
        setMsg(`Hak akses ${upd.email} diperbarui.`)
      } else {
        const created = await addStaff(email, form.modules)
        setList((prev) => [created, ...(prev || [])])
        setMsg(`${email} diundang. Minta dia mendaftar/login di aplikasi ini memakai email tersebut — aksesnya aktif otomatis.`)
      }
      setForm(null)
    } catch (e2) {
      setErr(e2.message?.includes('duplicate') ? 'Email itu sudah pernah diundang.' : e2.message)
    } finally { setBusy(false) }
  }

  const setStatus = async (s, status) => {
    const labels = { revoked: 'dicabut', active: 'diaktifkan lagi' }
    if (status === 'revoked' && !confirm(`Cabut akses ${s.email}? Dia tidak bisa lagi membuka data usaha Anda.`)) return
    try {
      const upd = await updateStaff(s.id, { status })
      setList((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
      setMsg(`Akses ${s.email} ${labels[status] || status}.`)
    } catch (e2) { setErr(e2.message) }
  }

  const remove = async (s) => {
    if (!confirm(`Hapus ${s.email} dari daftar? (Riwayat aksinya tetap tersimpan di Audit Log)`)) return
    try {
      await deleteStaff(s.id)
      setList((prev) => prev.filter((x) => x.id !== s.id))
    } catch (e2) { setErr(e2.message) }
  }

  if (!list) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  // Halaman ini untuk owner; staf yang nyasar ke sini melihat info keanggotaannya.
  if (membership) {
    return (
      <div className="card card-pad">
        <h3 className="card-title">Anda staf di usaha ini</h3>
        <p className="muted-sm">
          Akses Anda: {(membership.modules || []).map((k) => MODULES.find((m) => m.key === k)?.label || k).join(', ') || '-'}.
          Hubungi pemilik usaha untuk perubahan hak akses.
        </p>
      </div>
    )
  }

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
          Staf hanya melihat menu & data pada modul yang Anda izinkan — dijaga sampai level database, bukan sekadar disembunyikan.
        </p>
        <button className="btn btn-primary" onClick={() => { setErr(''); setForm(blankForm()) }}>+ Undang Staf</button>
      </div>

      {list.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee"><Users size={36} /></div>
          <h3>Belum ada staf</h3>
          <p>Undang staf per divisi (gudang, keuangan, analisis). Semua tindakan mereka terekam di Audit Log.</p>
          <button className="btn btn-primary" onClick={() => setForm(blankForm())}>+ Undang Staf Pertama</button>
        </div></div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Email</th><th>Akses modul</th><th>Status</th><th>Sejak</th><th></th></tr></thead>
            <tbody>
              {list.map((s) => {
                const st = STAFF_STATUS[s.status] || STAFF_STATUS.invited
                return (
                  <tr key={s.id}>
                    <td><b>{s.email}</b></td>
                    <td>
                      {(s.modules || []).map((k) => (
                        <span key={k} className="pill pill-ch" style={{ marginRight: 4 }}>
                          {MODULES.find((m) => m.key === k)?.label || k}
                        </span>
                      ))}
                    </td>
                    <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                    <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDate(s.created_at)}</td>
                    <td>
                      <div className="row-actions">
                        {s.status !== 'revoked' ? (
                          <button className="linklike" onClick={() => setStatus(s, 'revoked')}>Cabut</button>
                        ) : (
                          <button className="linklike" onClick={() => setStatus(s, 'active')}>Aktifkan</button>
                        )}
                        <button className="icon-btn" title="Ubah modul" aria-label="Ubah modul"
                          onClick={() => { setErr(''); setForm({ id: s.id, email: s.email, modules: s.modules || [] }) }}>
                          <Pencil size={15} />
                        </button>
                        <button className="icon-btn danger" title="Hapus" aria-label="Hapus" onClick={() => remove(s)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal onClose={() => setForm(null)} onSubmit={save} labelledBy="teamModalTitle">
            <div className="modal-head">
              <h3 id="teamModalTitle">{form.id ? 'Ubah Hak Akses' : 'Undang Staf'}</h3>
              <button type="button" className="icon-btn" onClick={() => setForm(null)} aria-label="Tutup">✕</button>
            </div>
            <div className="modal-body">
              {err && <div className="alert alert-err">{err}</div>}
              <div className="field">
                <label>Email staf</label>
                <input className="input" type="email" value={form.email} disabled={Boolean(form.id)}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="staf@usaha.com" />
                {!form.id && (
                  <p className="muted-sm" style={{ margin: '6px 0 0' }}>
                    Staf mendaftar/login dengan email ini — tidak perlu email undangan; akses aktif otomatis.
                  </p>
                )}
              </div>
              <div className="field">
                <label>Modul yang boleh diakses</label>
                {MODULES.map((m) => (
                  <label key={m.key} className="agree" style={{ margin: '0 0 8px' }}>
                    <input type="checkbox" checked={form.modules.includes(m.key)} onChange={() => toggleModule(m.key)} />
                    <span><b>{m.label}</b><br /><span className="muted-sm">{m.desc}</span></span>
                  </label>
                ))}
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost btn-block" onClick={() => setForm(null)}>Batal</button>
                <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Menyimpan...' : form.id ? 'Simpan' : 'Undang'}</button>
              </div>
            </div>
        </Modal>
      )}
    </>
  )
}
