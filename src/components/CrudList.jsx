import { useState } from 'react'
import { Pencil, Trash2, Check, X } from 'lucide-react'

// Daftar CRUD yang rapi & interaktif: tambah di kolom atas, edit LANGSUNG di
// tempat (inline) dengan ikon yang jelas, hapus dengan konfirmasi. Dipakai untuk
// kategori, satuan, kategori produk, dan daftar sederhana lain.
//
// Props:
//   items     : [{ id, name }]
//   onAdd(name), onRename(id, name), onDelete(id)  -> async
export default function CrudList({ title, hint, items = [], placeholder, onAdd, onRename, onDelete, dupMsg = 'Sudah ada.', card = true }) {
  const [name, setName] = useState('')
  const [editId, setEditId] = useState(null)
  const [editName, setEditName] = useState('')
  const [err, setErr] = useState('')
  const flash = (m) => { setErr(m); setTimeout(() => setErr(''), 2800) }

  const add = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    try { await onAdd(name.trim()); setName('') }
    catch (e2) { flash(e2.code === '23505' ? dupMsg : (e2.message || 'Gagal menambah.')) }
  }
  const startEdit = (it) => { setEditId(it.id); setEditName(it.name) }
  const cancelEdit = () => { setEditId(null); setEditName('') }
  const saveEdit = async () => {
    if (!editName.trim()) return cancelEdit()
    try { await onRename(editId, editName.trim()); cancelEdit() }
    catch (e2) { flash(e2.code === '23505' ? dupMsg : (e2.message || 'Gagal menyimpan.')) }
  }
  const remove = async (it) => {
    if (!confirm(`Hapus "${it.name}"?`)) return
    if (editId === it.id) cancelEdit()
    try { await onDelete(it.id) } catch (e2) { flash(e2.message || 'Gagal menghapus.') }
  }

  const body = (
    <>
      {title && <h3 className="card-title">{title}</h3>}
      {hint && <div className="card-sub">{hint}</div>}
      {err && <div className="alert alert-err" style={{ marginBottom: 12 }}>{err}</div>}
      <form className="crud-add" onSubmit={add}>
        {/* Tidak ada label kasatmata di sini (hanya placeholder), jadi nama
            aksesibelnya diambil dari judul daftar agar pembaca layar jelas. */}
        <input className="input" value={name} onChange={(e) => setName(e.target.value)}
          placeholder={placeholder} aria-label={title ? `Tambah ${title}` : 'Tambah item baru'} />
        <button className="btn btn-primary">+ Tambah</button>
      </form>
      <div className="crud-list">
        {items.length === 0 && <p className="muted-sm">Belum ada. Tambahkan di kolom atas.</p>}
        {items.map((it) => (
          <div className={`crud-item ${editId === it.id ? 'editing' : ''}`} key={it.id}>
            {editId === it.id ? (
              <>
                <input className="input crud-input" value={editName} autoFocus
                  aria-label={`Ubah nama "${it.name}"`}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEdit() } if (e.key === 'Escape') cancelEdit() }} />
                <button type="button" className="icon-btn ok" title="Simpan" aria-label="Simpan" onClick={saveEdit}><Check size={16} /></button>
                <button type="button" className="icon-btn" title="Batal" aria-label="Batal" onClick={cancelEdit}><X size={16} /></button>
              </>
            ) : (
              <>
                <span className="crud-name">{it.name}</span>
                <button type="button" className="icon-btn" title="Ubah" aria-label="Ubah" onClick={() => startEdit(it)}><Pencil size={15} /></button>
                <button type="button" className="icon-btn danger" title="Hapus" aria-label="Hapus" onClick={() => remove(it)}><Trash2 size={15} /></button>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  )

  return card ? <div className="card card-pad" style={{ marginBottom: 20 }}>{body}</div> : body
}
