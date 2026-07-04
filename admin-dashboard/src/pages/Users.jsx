import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { listUsers, updateUserProfile, deleteUser, subscribe } from '../lib/adminApi'
import { rupiah, num, fmtDate, timeAgo } from '../lib/format'
import { Modal, Spinner } from '../components/ui'

const emptyEdit = { id: '', business_name: '', owner_name: '', business_type: '', phone: '', taxpayer_type: 'pribadi' }

export default function Users() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const nav = useNavigate()

  const load = useCallback(() => listUsers().then(setRows).catch((e) => { console.error(e); setRows([]) }), [])
  useEffect(() => { load(); const unsub = subscribe('profiles', load); return unsub }, [load])

  const filtered = useMemo(() => {
    if (!rows) return []
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) =>
      [r.business_name, r.owner_name, r.email, r.phone].some((v) => (v || '').toLowerCase().includes(s)))
  }, [rows, q])

  const save = async (e) => {
    e.preventDefault()
    setSaving(true); setErr('')
    try {
      await updateUserProfile(edit.id, {
        business_name: edit.business_name, owner_name: edit.owner_name,
        business_type: edit.business_type, phone: edit.phone || null, taxpayer_type: edit.taxpayer_type,
      })
      setEdit(null); await load()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  const remove = async (r) => {
    if (!confirm(`Hapus PERMANEN akun "${r.business_name || r.email}" beserta SEMUA datanya (transaksi, feedback)?\n\nTindakan ini tidak bisa dibatalkan.`)) return
    try { await deleteUser(r.id); await load() }
    catch (e) { alert('Gagal menghapus: ' + e.message) }
  }

  if (!rows) return <Spinner />

  return (
    <>
      <div className="toolbar">
        <input className="input" placeholder="🔎 Cari nama usaha, pemilik, email, telepon..."
          value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted-sm">{num(filtered.length)} dari {num(rows.length)} pengguna</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Usaha / Pemilik</th><th>Email</th><th>Telepon</th>
              <th className="num">Transaksi</th><th className="num">Nilai</th>
              <th className="num">Feedback</th><th>Aktivitas terakhir</th><th>Bergabung</th><th>Persetujuan</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>
                  <b>{r.business_name || '-'}</b>
                  <div className="muted-sm">{r.owner_name || '-'}{r.business_type ? ` · ${r.business_type}` : ''}</div>
                </td>
                <td className="muted-sm">{r.email}</td>
                <td className="muted-sm">{r.phone || '-'}</td>
                <td className="num">{num(r.tx_count)}</td>
                <td className="num">{rupiah(r.tx_volume)}</td>
                <td className="num">{num(r.feedback_count)}</td>
                <td className="muted-sm">{r.last_activity ? timeAgo(r.last_activity) : 'belum ada'}</td>
                <td className="muted-sm">{fmtDate(r.created_at)}</td>
                <td className="muted-sm">
                  {r.accepted_terms
                    ? <span style={{ color: '#16a34a', fontWeight: 600 }}>
                        Sudah setuju{r.accepted_terms_at ? ` · ${fmtDate(r.accepted_terms_at)}` : ''}{r.terms_version ? ` (${r.terms_version})` : ''}
                      </span>
                    : <span style={{ color: '#dc2626', fontWeight: 600 }}>Belum</span>}
                </td>
                <td>
                  <div className="t-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => nav(`/transactions?user=${r.id}`)} title="Lihat transaksi akun ini">🧾 Transaksi</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...emptyEdit, ...r })}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={() => remove(r)}>Hapus</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={10}><div className="empty"><p>Tidak ada pengguna cocok.</p></div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal title="Edit Pengguna" onClose={() => setEdit(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>Batal</button>
            <button className="btn btn-primary" form="edit-user" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
          </>}>
          <form id="edit-user" onSubmit={save}>
            {err && <div className="alert alert-err">{err}</div>}
            <div className="muted-sm" style={{ marginBottom: 12 }}>Email: <b>{edit.email}</b> · ID: <code>{edit.id.slice(0, 8)}...</code></div>
            <div className="field"><label>Nama Usaha</label>
              <input className="input" value={edit.business_name || ''} onChange={(e) => setEdit({ ...edit, business_name: e.target.value })} /></div>
            <div className="field"><label>Nama Pemilik</label>
              <input className="input" value={edit.owner_name || ''} onChange={(e) => setEdit({ ...edit, owner_name: e.target.value })} /></div>
            <div className="field"><label>Jenis Usaha</label>
              <input className="input" value={edit.business_type || ''} onChange={(e) => setEdit({ ...edit, business_type: e.target.value })} /></div>
            <div className="field"><label>Telepon</label>
              <input className="input" value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></div>
            <div className="field"><label>Jenis Wajib Pajak</label>
              <select className="input" value={edit.taxpayer_type || 'pribadi'} onChange={(e) => setEdit({ ...edit, taxpayer_type: e.target.value })}>
                <option value="pribadi">Pribadi</option>
                <option value="badan">Badan</option>
              </select></div>
          </form>
        </Modal>
      )}
    </>
  )
}
