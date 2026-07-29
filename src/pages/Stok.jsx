import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Package, Plus, Search, Grid3x3, List, ChevronRight, Pencil, Trash2,
  AlertTriangle, TrendingUp, ShoppingCart, Sparkles, RefreshCw,
  Boxes, Layers, Gauge, Coffee, Wheat, ShoppingBasket, ImagePlus, ImageOff,
} from 'lucide-react'
import {
  fetchProducts, addProduct, updateProduct, deleteProduct,
  fetchUnits, addUnit, updateUnit, deleteUnit,
  fetchProductCategories, addProductCategory, updateProductCategory, deleteProductCategory,
  fetchSuppliers, ensureInventorySeed,
  uploadProductImage, deleteProductImage,
} from '../lib/api'
import { stokInsightAI } from '../lib/ai'
import { rupiah, rupiahShort } from '../lib/format'
import { ConfirmModal, KelolaModal } from '../components/StokDialogs'
import { useLang } from '../context/LangContext'
import './stok.css'

const emptyForm = { name: '', category: '', unit: 'pcs', stock: '', min_stock: '', price: '', cost_price: '', supplier_id: '', image_url: '' }

// Ikon placeholder berdasarkan kategori — fallback saat foto belum ada.
const CAT_ICONS = { Sembako: ShoppingBasket, 'Makanan Instan': Wheat, Minuman: Coffee }
const iconFor = (cat) => CAT_ICONS[cat] || Boxes

// Rasio stok terhadap min_stock*5 → warna & lebar bar progress.
function stockLevel(p) {
  const stock = Number(p.stock) || 0
  const min = Number(p.min_stock) || 0
  const cap = Math.max(min * 5, stock, 10)
  const pct = Math.min(100, Math.round((stock / cap) * 100))
  let variant = 'ok'
  if (min > 0 && stock <= min) variant = 'danger'
  else if (min > 0 && stock <= min * 2) variant = 'warn'
  else if (pct >= 90) variant = 'full'
  return { pct, variant }
}

export default function Stok() {
  const nav = useNavigate()
  const { t, lang } = useLang()
  const sk = t.stok
  const [products, setProducts] = useState(null)
  const [units, setUnits] = useState([])
  const [cats, setCats] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState(null)
  const [q, setQ] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [view, setView] = useState('grid') // grid | list
  const [err, setErr] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showKelola, setShowKelola] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [delTarget, setDelTarget] = useState(null) // { id, name, image_url }
  const [busyDel, setBusyDel] = useState(false)

  // AI insight state.
  const [ai, setAi] = useState({ loading: true, content: '', err: '' })
  const loadAI = (force = false) => {
    setAi((s) => ({ ...s, loading: true, err: '' }))
    stokInsightAI(force, lang)
      .then((d) => setAi({ loading: false, content: d.content || '', err: '' }))
      .catch((e) => setAi({ loading: false, content: '', err: e.message }))
  }

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

  useEffect(() => { loadAI(false) }, [lang]) // eslint-disable-line

  const reloadUnits = () => fetchUnits().then(setUnits).catch(() => {})
  const reloadCats = () => fetchProductCategories().then(setCats).catch(() => {})

  // Reveal on scroll.
  const rootRef = useRef(null)
  useEffect(() => {
    if (!rootRef.current || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target) }
    }, { threshold: 0.12 })
    rootRef.current.querySelectorAll('.s2-rv').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [products, showForm, catFilter, q, view])

  // Upload foto: unggah ke storage, simpan URL di state form. Foto belum
  // dikaitkan ke DB sampai form disubmit — jadi selalu bersihkan foto orphan.
  const handlePickPhoto = async (file) => {
    setErr('')
    if (!file) return
    setUploading(true)
    try {
      // Kalau ada foto lama di form ini (belum kesimpan), hapus dulu supaya tidak orphan.
      if (form.image_url) { await deleteProductImage(form.image_url) }
      const { publicUrl } = await uploadProductImage(file)
      setForm((f) => ({ ...f, image_url: publicUrl }))
    } catch (e) { setErr(e.message) } finally { setUploading(false) }
  }

  const handleRemovePhoto = async () => {
    if (!form.image_url) return
    try { await deleteProductImage(form.image_url) } catch { /* abaikan */ }
    setForm((f) => ({ ...f, image_url: '' }))
  }

  const submit = async (e) => {
    e.preventDefault(); setErr('')
    if (!form.name.trim()) { setErr(sk.errName); return }
    const payload = {
      name: form.name.trim(),
      category: form.category || null,
      unit: form.unit || 'pcs',
      stock: Number(form.stock) || 0,
      min_stock: Number(form.min_stock) || 0,
      price: Number(form.price) || 0,
      cost_price: Number(form.cost_price) || 0,
      supplier_id: form.supplier_id || null,
      image_url: form.image_url || null,
    }
    try {
      let oldImage = null
      if (editId) {
        // Kalau foto berubah, hapus foto lama setelah update sukses.
        const prev = products.find((x) => x.id === editId)
        if (prev?.image_url && prev.image_url !== payload.image_url) oldImage = prev.image_url
        await updateProduct(editId, payload)
      } else {
        await addProduct(payload)
      }
      if (oldImage) { try { await deleteProductImage(oldImage) } catch { /* abaikan */ } }
      setForm(emptyForm); setEditId(null); setShowForm(false)
      setProducts(await fetchProducts())
    } catch (e2) { setErr(e2.message) }
  }

  const startEdit = (p) => {
    setEditId(p.id)
    setForm({
      name: p.name, category: p.category || '', unit: p.unit || 'pcs',
      stock: String(p.stock ?? ''), min_stock: String(p.min_stock ?? ''),
      price: String(p.price ?? ''), cost_price: String(p.cost_price ?? ''),
      supplier_id: p.supplier_id || '', image_url: p.image_url || '',
    })
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const cancelForm = async () => {
    // Kalau foto sudah diupload tapi form dibatalkan pada produk BARU, foto perlu dibersihkan.
    if (!editId && form.image_url) { try { await deleteProductImage(form.image_url) } catch { /* abaikan */ } }
    setEditId(null); setForm(emptyForm); setShowForm(false)
  }

  // Delete confirm flow.
  const askDelete = (p) => setDelTarget(p)
  const doDelete = async () => {
    if (!delTarget) return
    setBusyDel(true)
    try {
      await deleteProduct(delTarget.id)
      if (delTarget.image_url) { try { await deleteProductImage(delTarget.image_url) } catch { /* abaikan */ } }
      setProducts((prev) => prev.filter((x) => x.id !== delTarget.id))
      setDelTarget(null)
    } catch (e) { setErr(e.message) } finally { setBusyDel(false) }
  }

  if (!products) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const filtered = products.filter((p) => {
    if (catFilter && p.category !== catFilter) return false
    if (!q) return true
    return `${p.name} ${p.category || ''}`.toLowerCase().includes(q.toLowerCase())
  })
  const lowStock = products.filter((p) => Number(p.min_stock) > 0 && Number(p.stock) <= Number(p.min_stock))
  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))]
  const turnover = (() => {
    if (products.length === 0) return '0'
    const avg = products.reduce((s, p) => s + (Number(p.stock) || 0), 0) / products.length
    return avg > 0 ? (Math.max(1, Math.round(avg / 10 * 10) / 10)).toFixed(1) : '0'
  })()
  const critical = [...products]
    .filter((p) => Number(p.min_stock) > 0 && Number(p.stock) <= Number(p.min_stock))
    .sort((a, b) => Number(a.stock) - Number(b.stock))[0]
  const potential = [...products]
    .sort((a, b) => (Number(b.price) - Number(b.cost_price)) - (Number(a.price) - Number(a.cost_price)))[0]

  // Kalimat pembuka & sisanya untuk AI card.
  const aiHead = (() => {
    if (ai.err) return sk.aiUnavailable
    if (ai.loading || !ai.content) return critical ? sk.needRestock.replace('{name}', critical.name) : sk.composing
    const firstDot = ai.content.indexOf('.')
    return firstDot > 20 ? ai.content.slice(0, firstDot + 1) : sk.aiTitle
  })()
  const aiBody = (() => {
    if (ai.loading) return sk.preparing
    if (ai.err) return ai.err
    if (!ai.content) return ''
    const firstDot = ai.content.indexOf('.')
    return firstDot > 20 ? ai.content.slice(firstDot + 1).trim() : ai.content
  })()

  return (
    <div className="s2" ref={rootRef}>
      {/* Header */}
      <div className="s2-head s2-rv">
        <div>
          <span className="s2-eyebrow"><Package size={16} />{sk.eyebrow}</span>
          <h1>{sk.title}</h1>
          <p>{sk.subtitle}</p>
        </div>
        <div className="s2-head-actions">
          <button className="s2-btn-outline" type="button" onClick={() => setShowKelola(true)}>
            <Layers size={16} />{sk.manageUnitsCats}
          </button>
          <button className="s2-btn-primary" type="button" onClick={() => { setEditId(null); setForm(emptyForm); setShowForm((v) => !v) }}>
            <Plus size={18} />{showForm ? sk.closeForm : sk.addProduct}
          </button>
        </div>
      </div>

      {/* Form Tambah/Ubah */}
      {showForm && (
        <form className="s2-form s2-rv" onSubmit={submit}>
          <h3>{editId ? sk.formEdit : sk.formAdd}</h3>
          <p style={{ margin: 0, color: 'var(--s2-on-surface-variant)', fontSize: 13 }}>{sk.formHint}</p>
          {err && <div className="s2-alert" style={{ marginTop: 12 }}><AlertTriangle size={16} />{err}</div>}

          <div style={{ marginTop: 14 }}>
            <label style={{ display: 'block', font: '600 12.5px Inter, sans-serif', color: 'var(--s2-on-surface-variant)', marginBottom: 6 }}>{sk.photo}</label>
            <div className="s2-photo">
              <div className="s2-photo-thumb">
                {form.image_url
                  ? <img src={form.image_url} alt={sk.photo} />
                  : <ImagePlus size={30} />}
              </div>
              <div className="s2-photo-copy">
                <p><b>{form.image_url ? sk.photoUploaded : sk.photoNone}</b> {sk.photoSpec}</p>
                <p>{sk.photoNote}</p>
                <div className="s2-photo-actions">
                  <label className="s2-photo-file" aria-disabled={uploading}>
                    <span><ImagePlus size={14} />{uploading ? sk.uploading : (form.image_url ? sk.changePhoto : sk.uploadPhoto)}</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePickPhoto(f); e.target.value = '' }} disabled={uploading} />
                  </label>
                  {form.image_url && (
                    <button type="button" className="s2-photo-remove" onClick={handleRemovePhoto} disabled={uploading}>
                      <ImageOff size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />{sk.removePhoto}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="s2-form-grid">
            <div className="s2-field"><label htmlFor="stok-name">{sk.fName}</label>
              <input id="stok-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={sk.namePh} /></div>
            <div className="s2-field"><label htmlFor="stok-cat">{sk.fCat}</label>
              <select id="stok-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">{sk.noCat}</option>
                {cats.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select></div>
            <div className="s2-field"><label htmlFor="stok-unit">{sk.fUnit}</label>
              <select id="stok-unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                {units.length === 0 && <option value="pcs">pcs</option>}
                {units.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
              </select></div>
            <div className="s2-field"><label htmlFor="stok-price">{sk.fPrice}</label>
              <input id="stok-price" type="number" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0" /></div>
            <div className="s2-field"><label htmlFor="stok-cost">{sk.fCost}</label>
              <input id="stok-cost" type="number" min="0" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} placeholder="0" /></div>
            <div className="s2-field"><label htmlFor="stok-stock">{sk.fStock}</label>
              <input id="stok-stock" type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} placeholder="0" /></div>
            <div className="s2-field"><label htmlFor="stok-min">{sk.fMin}</label>
              <input id="stok-min" type="number" min="0" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} placeholder="0" /></div>
            <div className="s2-field"><label htmlFor="stok-supplier">{sk.fSupplier}</label>
              <select id="stok-supplier" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">{sk.noSupplier}</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
          </div>
          <div className="s2-form-actions">
            <button type="submit" className="s2-btn-primary" disabled={uploading}>{editId ? sk.saveChanges : sk.addProduct}</button>
            <button type="button" className="s2-btn-outline" onClick={cancelForm}>{sk.cancel}</button>
          </div>
        </form>
      )}

      {/* Top: AI Card + KPI 2x2 */}
      <div className="s2-top">
        <div className="s2-ai s2-rv">
          <div className="s2-ai-orb" aria-hidden="true" />
          <div className="s2-ai-sparkle" aria-hidden="true"><Sparkles size={140} /></div>
          <div className="s2-ai-grid">
            <div className="s2-ai-copy">
              <div className="s2-ai-badge-row">
                <span className="s2-ai-badge"><Sparkles size={12} />{sk.aiBadge}</span>
                <span className="s2-ai-ts">{ai.loading ? sk.loading : sk.aiUpdated}</span>
                <button
                  type="button" className="s2-ai-refresh"
                  onClick={() => loadAI(true)} disabled={ai.loading}
                  aria-label={sk.aiRefresh} title={sk.aiRefresh}
                >
                  <RefreshCw size={16} className={ai.loading ? 's2-spin' : ''} />
                </button>
              </div>
              <h3>{aiHead}</h3>
              <p className="s2-ai-desc">{aiBody}</p>
              <div className="s2-ai-mini">
                <div className="s2-ai-mini-card">
                  <p>{sk.criticalStatus}</p>
                  <div className="s2-ai-mini-row">
                    <div className="s2-ai-mini-ic s2-ai-mini-ic-danger" aria-hidden="true"><AlertTriangle size={20} /></div>
                    <div>
                      <b>{critical ? sk.remaining.replace('{n}', Number(critical.stock)).replace('{unit}', critical.unit || 'pcs') : sk.allSafe}</b>
                      <small className="s2-hi-cyan">{sk.needAttention.replace('{n}', lowStock.length)}</small>
                    </div>
                  </div>
                </div>
                <div className="s2-ai-mini-card">
                  <p>{sk.marginPotential}</p>
                  <div className="s2-ai-mini-row">
                    <div className="s2-ai-mini-ic s2-ai-mini-ic-up" aria-hidden="true"><TrendingUp size={20} /></div>
                    <div>
                      <b>{potential?.name || '—'}</b>
                      <small className="s2-hi-cyan">{sk.highestMargin}</small>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {critical && (
              <button type="button" className="s2-ai-cta" onClick={() => nav('/app/po', { state: { productId: critical.id } })}>
                <div className="s2-ai-cta-ic"><ShoppingCart size={26} /></div>
                <span>{sk.orderNow}</span>
              </button>
            )}
          </div>
        </div>

        <div className="s2-kpi-grid">
          <div className="s2-kpi s2-kpi-primary s2-rv">
            <div className="s2-kpi-ic s2-kpi-ic-primary"><Boxes size={20} /></div>
            <div>
              <p className="s2-kpi-l">{sk.kTotal}</p>
              <p className="s2-kpi-v">{products.length}</p>
            </div>
          </div>
          <div className="s2-kpi s2-kpi-danger s2-rv">
            <div className="s2-kpi-ic s2-kpi-ic-danger"><AlertTriangle size={20} /></div>
            <div>
              <p className="s2-kpi-l s2-kpi-l-danger">{sk.kLow}</p>
              <p className="s2-kpi-v s2-kpi-v-danger">{String(lowStock.length).padStart(2, '0')}</p>
            </div>
          </div>
          <div className="s2-kpi s2-kpi-secondary s2-rv">
            <div className="s2-kpi-ic s2-kpi-ic-secondary"><Layers size={20} /></div>
            <div>
              <p className="s2-kpi-l">{sk.kCat}</p>
              <p className="s2-kpi-v">{categories.length}</p>
            </div>
          </div>
          <div className="s2-kpi s2-kpi-tertiary s2-rv">
            <div className="s2-kpi-ic s2-kpi-ic-tertiary"><Gauge size={20} /></div>
            <div>
              <p className="s2-kpi-l">{sk.kTurnover}</p>
              <p className="s2-kpi-v">{turnover}<small>x</small></p>
            </div>
          </div>
        </div>
      </div>

      {/* Daftar Inventaris */}
      <div>
        <div className="s2-section-head s2-rv">
          <h3>{sk.inventoryList}</h3>
          <div className="s2-toolbar">
            <label className="s2-search">
              <Search size={16} aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={sk.searchPh} aria-label={sk.searchPh} />
            </label>
            <div className="s2-view-toggle" role="group" aria-label={sk.gridView}>
              <button type="button" className={view === 'grid' ? 'is-on' : ''} onClick={() => setView('grid')} aria-label={sk.gridView} title={sk.gridView}><Grid3x3 size={18} /></button>
              <button type="button" className={view === 'list' ? 'is-on' : ''} onClick={() => setView('list')} aria-label={sk.listView} title={sk.listView}><List size={18} /></button>
            </div>
            <select className="s2-select" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} aria-label={sk.allCats}>
              <option value="">{sk.allCats}</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="s2-empty s2-rv">
            <h3>{sk.emptyTitle}</h3>
            <p>{q || catFilter ? sk.emptyFilter : sk.emptyAdd}</p>
          </div>
        ) : view === 'grid' ? (
          <div className="s2-grid">
            {filtered.map((p) => {
              const Ic = iconFor(p.category)
              const lv = stockLevel(p)
              return (
                <article className="s2-card s2-rv" key={p.id}>
                  <div className="s2-card-img">
                    {lv.variant === 'danger' && <span className="s2-card-tag s2-card-tag-danger">{sk.tagLow}</span>}
                    {lv.variant === 'ok' && Number(p.stock) > (Number(p.min_stock) || 0) * 3 && <span className="s2-card-tag s2-card-tag-ok">{sk.tagSafe}</span>}
                    {p.image_url
                      ? <img src={p.image_url} alt={p.name} loading="lazy" />
                      : <Ic size={78} strokeWidth={1.4} aria-hidden="true" />}
                  </div>
                  <div className="s2-card-body">
                    <div className="s2-card-head">
                      <div>
                        <div className="s2-card-cat">{p.category || sk.general}</div>
                        <h4 className="s2-card-name" title={p.name}>{p.name}</h4>
                      </div>
                      <div className="s2-card-actions">
                        <button className="s2-card-btn" type="button" onClick={() => startEdit(p)} aria-label={sk.editAria.replace('{name}', p.name)} title={sk.editProduct}><Pencil size={16} /></button>
                        <button className="s2-card-btn s2-card-btn-danger" type="button" onClick={() => askDelete(p)} aria-label={sk.delAria.replace('{name}', p.name)} title={sk.delProduct}><Trash2 size={16} /></button>
                      </div>
                    </div>
                    <div className="s2-card-row">
                      <span>{Number(p.stock)} {p.unit || 'pcs'} {sk.remainingSuffix}</span>
                      <span className="s2-card-price">{rupiahShort(p.price)}</span>
                    </div>
                    <div className={`s2-card-bar s2-card-bar-${lv.variant}`}>
                      <div style={{ width: `${Math.max(6, lv.pct)}%` }} />
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="s2-log s2-rv">
            <div className="s2-log-wrap">
              <table className="s2-log-tbl">
                <thead>
                  <tr>
                    <th>{sk.thProduct}</th>
                    <th>{sk.thCat}</th>
                    <th>{sk.thStatus}</th>
                    <th>{sk.thStock}</th>
                    <th className="s2-right">{sk.thAction}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const Ic = iconFor(p.category)
                    const lv = stockLevel(p)
                    const tagCls = lv.variant === 'danger' ? 's2-tag-danger' : lv.variant === 'warn' ? 's2-tag-warn' : 's2-tag-ok'
                    const tagText = lv.variant === 'danger' ? sk.tagCritical : lv.variant === 'warn' ? sk.tagThin : sk.tagStable
                    return (
                      <tr key={p.id}>
                        <td>
                          <div className="s2-log-prod">
                            <div className="s2-log-prod-ic">{p.image_url ? <img src={p.image_url} alt="" /> : <Ic size={20} />}</div>
                            <b>{p.name}</b>
                          </div>
                        </td>
                        <td style={{ color: 'var(--s2-on-surface-variant)' }}>{p.category || '—'}</td>
                        <td><span className={`s2-tag ${tagCls}`}><span className="s2-tag-dot" />{tagText}</span></td>
                        <td className={`s2-log-stock ${lv.variant === 'danger' ? 's2-log-stock-danger' : ''}`}>{Number(p.stock)} {p.unit || 'pcs'}</td>
                        <td>
                          <div className="s2-log-actions">
                            <button className="s2-icon-btn" title={sk.edit} onClick={() => startEdit(p)}><Pencil size={18} /></button>
                            <button className="s2-icon-btn s2-icon-btn-danger" title={sk.del} onClick={() => askDelete(p)}><Trash2 size={18} /></button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Log Pergerakan Stok — status ringkas untuk produk terbaru */}
      <div className="s2-log s2-rv">
        <div className="s2-log-head">
          <div>
            <h3>{sk.logTitle}</h3>
            <p>{sk.logSub}</p>
          </div>
          <Link to="/app/stok/histori" className="s2-log-link">
            {sk.seeAllHistory} <ChevronRight size={18} />
          </Link>
        </div>
        <div className="s2-log-wrap">
          <table className="s2-log-tbl">
            <thead>
              <tr>
                <th>{sk.thProdInfo}</th>
                <th>{sk.thSku}</th>
                <th>{sk.thInvStatus}</th>
                <th>{sk.thStock}</th>
                <th className="s2-right">{sk.thAction}</th>
              </tr>
            </thead>
            <tbody>
              {products.slice(0, 5).map((p) => {
                const Ic = iconFor(p.category)
                const lv = stockLevel(p)
                const tagCls = lv.variant === 'danger' ? 's2-tag-danger' : lv.variant === 'warn' ? 's2-tag-warn' : 's2-tag-ok'
                const tagText = lv.variant === 'danger' ? sk.tagCritical : lv.variant === 'warn' ? sk.tagThin : sk.tagStable
                const sku = p.sku || `${(p.category || 'PRD').slice(0, 3).toUpperCase()}-${String(p.id || '').replace(/-/g, '').slice(0, 6).toUpperCase()}`
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="s2-log-prod">
                        <div className="s2-log-prod-ic">{p.image_url ? <img src={p.image_url} alt="" /> : <Ic size={20} />}</div>
                        <b>{p.name}</b>
                      </div>
                    </td>
                    <td className="s2-log-sku">{sku}</td>
                    <td><span className={`s2-tag ${tagCls}`}><span className="s2-tag-dot" />{tagText}</span></td>
                    <td className={`s2-log-stock ${lv.variant === 'danger' ? 's2-log-stock-danger' : ''}`}>{Number(p.stock)} {p.unit || 'pcs'}</td>
                    <td>
                      <div className="s2-log-actions">
                        <button className="s2-icon-btn" title={sk.edit} onClick={() => startEdit(p)}><Pencil size={18} /></button>
                        <button className="s2-icon-btn s2-icon-btn-danger" title={sk.del} onClick={() => askDelete(p)}><Trash2 size={18} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal konfirmasi hapus */}
      <ConfirmModal
        open={!!delTarget}
        onClose={() => setDelTarget(null)}
        onConfirm={doDelete}
        title={sk.delTitle}
        message={delTarget ? sk.delMsg.replace('{name}', delTarget.name) : ''}
        confirmLabel={sk.delConfirm}
        busy={busyDel}
      />

      {/* Modal kelola satuan & kategori */}
      <KelolaModal
        open={showKelola}
        onClose={() => setShowKelola(false)}
        units={units}
        cats={cats}
        onAddUnit={async (n) => { await addUnit(n); await reloadUnits() }}
        onRenameUnit={async (id, n) => { await updateUnit(id, n); await reloadUnits() }}
        onDeleteUnit={async (id) => { await deleteUnit(id); await reloadUnits() }}
        onAddCat={async (n) => { await addProductCategory(n); await reloadCats() }}
        onRenameCat={async (id, n) => { await updateProductCategory(id, n); await reloadCats() }}
        onDeleteCat={async (id) => { await deleteProductCategory(id); await reloadCats() }}
      />
    </div>
  )
}
