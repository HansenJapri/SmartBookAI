import { useEffect, useState, useCallback } from 'react'
import {
  fetchProducts, addProduct, updateProduct, deleteProduct,
  fetchUnits, addUnit, updateUnit, deleteUnit,
  fetchProductCategories, addProductCategory, updateProductCategory, deleteProductCategory,
  fetchSuppliers, ensureInventorySeed,
} from '../lib/api'
import { rupiah } from '../lib/format'
import CrudList from '../components/CrudList'

const emptyForm = { name: '', category: '', unit: 'pcs', stock: '', min_stock: '', price: '', cost_price: '', supplier_id: '' }

export default function Stok() {
  const [products, setProducts] = useState(null)
  const [units, setUnits] = useState([])
  const [cats, setCats] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [showManage, setShowManage] = useState(false)

  const loadAll = useCallback(async () => {
    const [p, u, c, s] = await Promise.all([fetchProducts(), fetchUnits(), fetchProductCategories(), fetchSuppliers()])
    setProducts(p); setUnits(u); setCats(c); setSuppliers(s)
  }, [])

  useEffect(() => {
    (async () => {
      try { await ensureInventorySeed() } catch { /* tabel belum dimigrasi */ }
      try { await loadAll() } catch { setProducts([]) }
    })()
  }, [loadAll])

  const reloadUnits = () => fetchUnits().then(setUnits).catch(() => {})
  const reloadCats = () => fetchProductCategories().then(setCats).catch(() => {})

  const submit = async (e) => {
    e.preventDefault(); setErr('')
    if (!form.name.trim()) { setErr('Nama produk wajib diisi.'); return }
    const payload = {
      name: form.name.trim(),
      category: form.category || null,
      unit: form.unit || 'pcs',
      stock: Number(form.stock) || 0,
      min_stock: Number(form.min_stock) || 0,
      price: Number(form.price) || 0,
      cost_price: Number(form.cost_price) || 0,
      supplier_id: form.supplier_id || null,
    }
    try {
      if (editId) await updateProduct(editId, payload)
      else await addProduct(payload)
      setForm(emptyForm); setEditId(null)
      setProducts(await fetchProducts())
    } catch (e2) { setErr(e2.message) }
  }

  const startEdit = (p) => {
    setEditId(p.id)
    setForm({
      name: p.name, category: p.category || '', unit: p.unit || 'pcs',
      stock: String(p.stock ?? ''), min_stock: String(p.min_stock ?? ''),
      price: String(p.price ?? ''), cost_price: String(p.cost_price ?? ''), supplier_id: p.supplier_id || '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const cancel = () => { setEditId(null); setForm(emptyForm) }
  const remove = async (p) => {
    if (!confirm(`Hapus produk "${p.name}"?`)) return
    await deleteProduct(p.id); setProducts((prev) => prev.filter((x) => x.id !== p.id))
  }

  if (!products) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const filtered = products.filter((p) => !q || `${p.name} ${p.category || ''}`.toLowerCase().includes(q.toLowerCase()))
  const low = products.filter((p) => Number(p.min_stock) > 0 && Number(p.stock) <= Number(p.min_stock))
  const supplierName = (id) => suppliers.find((s) => s.id === id)?.name || '-'
  // Margin = (harga jual - harga modal) / harga jual. Nilai modal stok = total HPP x stok.
  const margin = (p) => { const pr = Number(p.price) || 0; const c = Number(p.cost_price) || 0; return pr > 0 ? Math.round((pr - c) / pr * 100) : 0 }
  const modalStok = products.reduce((s, p) => s + (Number(p.cost_price) || 0) * (Number(p.stock) || 0), 0)

  return (
    <div>
      {low.length > 0 && (
        <div className="alert alert-err" style={{ marginBottom: 16 }}>
          <b>Peringatan stok menipis:</b> {low.length} produk perlu segera diisi ulang
          {' '}({low.slice(0, 5).map((p) => p.name).join(', ')}{low.length > 5 ? ', dan lainnya' : ''}).
        </div>
      )}

      <form className="card card-pad" onSubmit={submit} style={{ marginBottom: 20 }}>
        <h3 className="card-title">{editId ? 'Ubah Produk' : 'Tambah Produk'}</h3>
        {err && <div className="alert alert-err" style={{ marginBottom: 10 }}>{err}</div>}
        <div className="grid-2">
          <div className="field"><label>Nama produk</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="cth: Indomie Goreng" /></div>
          <div className="field"><label>Kategori produk</label>
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">(tanpa kategori)</option>
              {cats.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select></div>
          <div className="field"><label>Satuan</label>
            <select className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
              {units.length === 0 && <option value="pcs">pcs</option>}
              {units.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
            </select></div>
          <div className="field"><label>Harga jual (Rp)</label>
            <input className="input" type="number" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0" /></div>
          <div className="field"><label>Harga modal / HPP (Rp) <span className="muted-sm">(untuk hitung margin)</span></label>
            <input className="input" type="number" min="0" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} placeholder="0" /></div>
          <div className="field"><label>Stok saat ini</label>
            <input className="input" type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} placeholder="0" /></div>
          <div className="field"><label>Stok minimum (untuk peringatan)</label>
            <input className="input" type="number" min="0" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} placeholder="0" /></div>
          <div className="field"><label>Pemasok</label>
            <select className="input" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
              <option value="">(tanpa pemasok)</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
        </div>
        <div className="flex gap">
          <button className="btn btn-primary">{editId ? 'Simpan Perubahan' : '+ Tambah Produk'}</button>
          {editId && <button type="button" className="btn btn-ghost" onClick={cancel}>Batal</button>}
        </div>
      </form>

      <div className="toolbar">
        <input className="input" placeholder="Cari produk..." value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-ghost" onClick={() => setShowManage((v) => !v)}>
          {showManage ? 'Tutup pengaturan' : 'Kelola satuan & kategori'}
        </button>
      </div>

      {showManage && (
        <div className="grid-2" style={{ marginBottom: 16 }}>
          <CrudList title="Satuan" placeholder="cth: karung" items={units} dupMsg="Satuan itu sudah ada."
            onAdd={async (n) => { await addUnit(n); await reloadUnits() }}
            onRename={async (id, n) => { await updateUnit(id, n); await reloadUnits() }}
            onDelete={async (id) => { await deleteUnit(id); await reloadUnits() }} />
          <CrudList title="Kategori Produk" placeholder="cth: Elektronik" items={cats} dupMsg="Kategori itu sudah ada."
            onAdd={async (n) => { await addProductCategory(n); await reloadCats() }}
            onRename={async (id, n) => { await updateProductCategory(id, n); await reloadCats() }}
            onDelete={async (id) => { await deleteProductCategory(id); await reloadCats() }} />
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card"><div className="empty"><h3>Belum ada produk</h3><p>Tambah produk pertama Anda di formulir di atas.</p></div></div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Produk</th><th>Kategori</th><th style={{ textAlign: 'right' }}>Stok</th>
              <th style={{ textAlign: 'right' }}>Modal (HPP)</th><th style={{ textAlign: 'right' }}>Harga Jual</th>
              <th style={{ textAlign: 'right' }}>Margin</th><th>Pemasok</th><th></th>
            </tr></thead>
            <tbody>
              {filtered.map((p) => {
                const isLow = Number(p.min_stock) > 0 && Number(p.stock) <= Number(p.min_stock)
                return (
                  <tr key={p.id} style={isLow ? { background: '#fff7ed' } : {}}>
                    <td><b>{p.name}</b></td>
                    <td className="muted-sm">{p.category || '-'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {Number(p.stock)} {p.unit}
                      {isLow && <span className="tx-type tx-type-out" style={{ marginLeft: 6 }}>Menipis</span>}
                    </td>
                    <td style={{ textAlign: 'right' }} className="muted-sm">{rupiah(p.cost_price)}</td>
                    <td style={{ textAlign: 'right' }}>{rupiah(p.price)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={`tx-type ${margin(p) >= 0 ? 'tx-type-in' : 'tx-type-out'}`}>{margin(p)}%</span>
                    </td>
                    <td className="muted-sm">{supplierName(p.supplier_id)}</td>
                    <td><div className="row-actions">
                      <button className="linklike" onClick={() => startEdit(p)}>Ubah</button>
                      <button className="linklike" style={{ color: 'var(--red)' }} onClick={() => remove(p)}>Hapus</button>
                    </div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted-sm mt">Total {products.length} produk &middot; Nilai modal stok (HPP): <b>{rupiah(modalStok)}</b></p>
    </div>
  )
}
