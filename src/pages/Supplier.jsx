import { useEffect, useState, useCallback } from 'react'
import { fetchSuppliers, addSupplier, updateSupplier, deleteSupplier } from '../lib/api'
import { useLang } from '../context/LangContext'
import { useAlert } from '../context/AlertContext'
import GagalMuat from '../components/GagalMuat'

const empty = { name: '', phone: '', email: '', address: '', note: '' }

export default function Supplier() {
  const { t } = useLang()
  const { showConfirm } = useAlert()
  const s = t.supplier
  const [rows, setRows] = useState(null)
  const [form, setForm] = useState(empty)
  const [editId, setEditId] = useState(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [gagalMuat, setGagalMuat] = useState(null)

  const load = useCallback(() => fetchSuppliers()
    .then((d) => { setRows(d); setGagalMuat(null) })
    .catch((e) => setGagalMuat(e)), [])
  useEffect(() => { load() }, [load])

  const submit = async (e) => {
    e.preventDefault(); setErr('')
    if (!form.name.trim()) { setErr(s.errName); return }
    // Di HP dengan koneksi lambat, tombol yang tidak memberi umpan balik selalu
    // diketuk dua kali — dan dua ketukan di sini berarti dua baris pemasok
    // kembar yang harus dibersihkan pengguna sendiri.
    if (busy) return
    setBusy(true)
    try {
      if (editId) await updateSupplier(editId, form)
      else await addSupplier(form)
      setForm(empty); setEditId(null); await load()
    } catch (e2) { setErr(e2.message) }
    finally { setBusy(false) }
  }
  const startEdit = (row) => {
    setEditId(row.id)
    setForm({ name: row.name || '', phone: row.phone || '', email: row.email || '', address: row.address || '', note: row.note || '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const cancel = () => { setEditId(null); setForm(empty) }
  const remove = async (row) => { if (!await showConfirm({ message: `${s.confirmDel} "${row.name}"?`, type: 'error' })) return; await deleteSupplier(row.id); await load() }

  if (gagalMuat && !rows) return <GagalMuat galat={gagalMuat} onRetry={load} />
  if (!rows) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  const filtered = rows.filter((r) => !q || `${r.name} ${r.phone || ''}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <div>
      <form className="card card-pad" onSubmit={submit} style={{ marginBottom: 20 }}>
        <h3 className="card-title">{editId ? s.editTitle : s.addTitle}</h3>
        {err && <div className="alert alert-err" style={{ marginBottom: 10 }}>{err}</div>}
        <div className="grid-2">
          <div className="field"><label htmlFor="sup-name">{s.name}</label>
            <input id="sup-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={s.namePh} /></div>
          <div className="field"><label htmlFor="sup-phone">{s.phone}</label>
            <input id="sup-phone" className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08xxxxxxxxxx" /></div>
          <div className="field"><label htmlFor="sup-email">{s.email}</label>
            <input id="sup-email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={s.optional} /></div>
          <div className="field"><label htmlFor="sup-address">{s.address}</label>
            <input id="sup-address" className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder={s.optional} /></div>
        </div>
        <div className="field"><label htmlFor="sup-note">{s.note}</label>
          <input id="sup-note" className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={s.notePh} /></div>
        <div className="flex gap">
          <button className="btn btn-primary" disabled={busy}>{editId ? s.saveBtn : s.addBtn}</button>
          {editId && <button type="button" className="btn btn-ghost" onClick={cancel}>{s.cancel}</button>}
        </div>
      </form>

      <div className="toolbar"><input className="input" placeholder={s.searchPh} value={q} onChange={(e) => setQ(e.target.value)} aria-label={s.searchPh} /></div>

      {filtered.length === 0 ? (
        <div className="card"><div className="empty"><h3>{s.emptyTitle}</h3><p>{s.emptyDesc}</p></div></div>
      ) : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>{s.thName}</th><th>{s.thPhone}</th><th>{s.thEmail}</th><th>{s.thNote}</th><th></th></tr></thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td><b>{row.name}</b>{row.address ? <div className="muted-sm">{row.address}</div> : null}</td>
                <td className="muted-sm">{row.phone || '-'}</td>
                <td className="muted-sm">{row.email || '-'}</td>
                <td className="muted-sm">{row.note || '-'}</td>
                <td><div className="row-actions">
                  <button className="linklike" onClick={() => startEdit(row)}>{s.edit}</button>
                  <button className="linklike" style={{ color: 'var(--red)' }} onClick={() => remove(row)}>{s.delete}</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <p className="muted-sm mt">{s.totalA} {rows.length} {s.totalB}</p>
    </div>
  )
}
