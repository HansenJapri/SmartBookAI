import { useEffect, useState, useCallback } from 'react'
import { fetchSuppliers, addSupplier, updateSupplier, deleteSupplier } from '../lib/api'
import { useLang } from '../context/LangContext'

const empty = { name: '', phone: '', email: '', address: '', note: '' }

export default function Supplier() {
  const { t } = useLang()
  const s = t.supplier
  const [rows, setRows] = useState(null)
  const [form, setForm] = useState(empty)
  const [editId, setEditId] = useState(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(() => fetchSuppliers().then(setRows).catch(() => setRows([])), [])
  useEffect(() => { load() }, [load])

  const submit = async (e) => {
    e.preventDefault(); setErr('')
    if (!form.name.trim()) { setErr(s.errName); return }
    try {
      if (editId) await updateSupplier(editId, form)
      else await addSupplier(form)
      setForm(empty); setEditId(null); await load()
    } catch (e2) { setErr(e2.message) }
  }
  const startEdit = (row) => {
    setEditId(row.id)
    setForm({ name: row.name || '', phone: row.phone || '', email: row.email || '', address: row.address || '', note: row.note || '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const cancel = () => { setEditId(null); setForm(empty) }
  const remove = async (row) => { if (!confirm(`${s.confirmDel} "${row.name}"?`)) return; await deleteSupplier(row.id); await load() }

  if (!rows) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  const filtered = rows.filter((r) => !q || `${r.name} ${r.phone || ''}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <div>
      <form className="card card-pad" onSubmit={submit} style={{ marginBottom: 20 }}>
        <h3 className="card-title">{editId ? s.editTitle : s.addTitle}</h3>
        {err && <div className="alert alert-err" style={{ marginBottom: 10 }}>{err}</div>}
        <div className="grid-2">
          <div className="field"><label>{s.name}</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={s.namePh} /></div>
          <div className="field"><label>{s.phone}</label>
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08xxxxxxxxxx" /></div>
          <div className="field"><label>{s.email}</label>
            <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={s.optional} /></div>
          <div className="field"><label>{s.address}</label>
            <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder={s.optional} /></div>
        </div>
        <div className="field"><label>{s.note}</label>
          <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={s.notePh} /></div>
        <div className="flex gap">
          <button className="btn btn-primary">{editId ? s.saveBtn : s.addBtn}</button>
          {editId && <button type="button" className="btn btn-ghost" onClick={cancel}>{s.cancel}</button>}
        </div>
      </form>

      <div className="toolbar"><input className="input" placeholder={s.searchPh} value={q} onChange={(e) => setQ(e.target.value)} /></div>

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
