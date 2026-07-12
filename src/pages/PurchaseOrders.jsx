import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ClipboardList, CheckCircle2, PackageCheck, Trash2, XCircle, Pencil } from 'lucide-react'
import {
  fetchPurchaseOrders, addPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder,
  receivePurchaseOrder, fetchProducts, fetchSuppliers,
} from '../lib/api'
import { nextDocNumber, PO_STATUS } from '../lib/gudang'
import { rupiah, fmtDate } from '../lib/format'
import { useCatalog } from '../context/CatalogContext'

const blankForm = (productId = '') => ({
  id: null, product_id: productId, supplier_id: '', qty: '1', unit_price: '',
  expected_date: '', note: '',
})

// Alur PO: Draf -> Disetujui -> Diterima (stok bertambah + opsi catat pengeluaran).
// Satu PO = satu produk (selaras aturan 1 transaksi = 1 produk).
export default function PurchaseOrders() {
  const { catNames } = useCatalog()
  const loc = useLocation()
  const [list, setList] = useState(null)
  const [products, setProducts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [form, setForm] = useState(null)          // modal buat/edit draf
  const [receiveTarget, setReceiveTarget] = useState(null) // modal terima PO
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const load = () => fetchPurchaseOrders().then(setList).catch(() => setList([]))
  useEffect(() => {
    load()
    fetchProducts().then(setProducts).catch(() => {})
    fetchSuppliers().then(setSuppliers).catch(() => {})
  }, [])

  // Dibuka dari tombol "Buat PO" pada baris stok menipis di halaman Stok.
  useEffect(() => {
    if (loc.state?.productId) setForm(blankForm(loc.state.productId))
  }, [loc.state])

  // Harga satuan default (harga modal produk) saat produk sudah terpilih
  // tapi harga belum terisi — mis. ketika dibuka dari halaman Stok.
  useEffect(() => {
    if (!form || form.id || !form.product_id || form.unit_price !== '') return
    const p = products.find((x) => x.id === form.product_id)
    if (p) setForm((f) => ({ ...f, unit_price: String(Number(p.cost_price) || Number(p.price) || 0) }))
  }, [form?.product_id, products]) // eslint-disable-line

  const productOf = (id) => products.find((p) => p.id === id)
  const supplierOf = (id) => suppliers.find((s) => s.id === id)
  const expenseCats = catNames('out')

  const formProduct = form ? productOf(form.product_id) : null
  const formTotal = Math.round((Number(form?.qty) || 0) * (Number(form?.unit_price) || 0))

  const pickFormProduct = (productId) => {
    const p = productOf(productId)
    const def = p ? (Number(p.cost_price) || Number(p.price) || 0) : 0
    setForm((f) => ({ ...f, product_id: productId, unit_price: f.unit_price && f.id ? f.unit_price : String(def) }))
  }

  const saveForm = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.product_id) return setErr('Pilih produk dulu.')
    const qty = Number(form.qty)
    if (!qty || qty <= 0) return setErr('Jumlah harus lebih dari 0.')
    setBusy(true)
    try {
      const payload = {
        product_id: form.product_id,
        supplier_id: form.supplier_id || null,
        qty,
        unit_price: Number(form.unit_price) || 0,
        expected_date: form.expected_date || null,
        note: form.note.trim() || null,
      }
      if (form.id) {
        const upd = await updatePurchaseOrder(form.id, payload)
        setList((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
        setMsg(`${upd.po_number} diperbarui.`)
      } else {
        const po_number = nextDocNumber('PO', (list || []).map((x) => x.po_number))
        const created = await addPurchaseOrder({ ...payload, po_number, status: 'draft' })
        setList((prev) => [created, ...(prev || [])])
        setMsg(`${created.po_number} tersimpan sebagai draf. Setujui untuk melanjutkan.`)
      }
      setForm(null)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const approve = async (po) => {
    setMsg(''); setErr('')
    try {
      const upd = await updatePurchaseOrder(po.id, { status: 'approved', approved_at: new Date().toISOString() })
      setList((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
      setMsg(`${upd.po_number} disetujui. Tandai "Diterima" saat barang sampai.`)
    } catch (e2) { setErr(e2.message) }
  }

  const cancel = async (po) => {
    if (!confirm(`Batalkan ${po.po_number}? Stok tidak berubah.`)) return
    try {
      const upd = await updatePurchaseOrder(po.id, { status: 'cancelled' })
      setList((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
    } catch (e2) { setErr(e2.message) }
  }

  const remove = async (po) => {
    if (!confirm(`Hapus ${po.po_number}? Tindakan ini tidak bisa dibatalkan.`)) return
    try {
      await deletePurchaseOrder(po.id)
      setList((prev) => prev.filter((x) => x.id !== po.id))
    } catch (e2) { setErr(e2.message) }
  }

  // ---- modal terima PO ----
  const [rcExpense, setRcExpense] = useState(true)
  const [rcCategory, setRcCategory] = useState('')
  const [rcPayment, setRcPayment] = useState('lunas') // 'belum' = beli kredit (utang)
  const [rcDueDate, setRcDueDate] = useState('')
  const openReceive = (po) => {
    setMsg(''); setErr('')
    setRcExpense(true)
    setRcPayment('lunas')
    setRcDueDate('')
    setRcCategory(expenseCats.includes('Pembelian Stok') ? 'Pembelian Stok' : (expenseCats[0] || ''))
    setReceiveTarget(po)
  }
  const doReceive = async () => {
    const po = receiveTarget
    setBusy(true); setErr('')
    try {
      const res = await receivePurchaseOrder(po, {
        createExpense: rcExpense, category: rcCategory,
        paymentStatus: rcPayment, dueDate: rcDueDate || null,
      })
      setList((prev) => prev.map((x) => (x.id === res.po.id ? res.po : x)))
      const s = res.stock
      setMsg(
        `${res.po.po_number} diterima. Stok ${s.name}: ${s.before} → ${s.after} ${s.unit}.`
        + (res.txn
          ? rcPayment === 'belum'
            ? ` Utang ${rupiah(res.txn.amount)} tercatat — pantau di menu Piutang & Utang.`
            : ` Pengeluaran ${rupiah(res.txn.amount)} tercatat otomatis.`
          : '')
      )
      setReceiveTarget(null)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const rcProduct = receiveTarget ? productOf(receiveTarget.product_id) : null
  const rcTotal = receiveTarget ? Math.round((Number(receiveTarget.qty) || 0) * (Number(receiveTarget.unit_price) || 0)) : 0

  const rows = useMemo(() => list || [], [list])

  if (!list) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <>
      {msg && (
        <div className="alert alert-ok" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{msg}</span>
          <button className="icon-btn" onClick={() => setMsg('')} aria-label="Tutup">✕</button>
        </div>
      )}
      {err && <div className="alert alert-err">{err}</div>}

      <div className="toolbar">
        <p className="muted-sm" style={{ flex: 1, margin: 0 }}>
          Alur: <b>Draf</b> → <b>Disetujui</b> → <b>Diterima</b> (stok bertambah otomatis, pengeluaran bisa tercatat otomatis).
        </p>
        <button className="btn btn-primary" onClick={() => { setErr(''); setForm(blankForm()) }}>+ Buat PO</button>
      </div>

      {rows.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee"><ClipboardList size={36} /></div>
          <h3>Belum ada Purchase Order</h3>
          <p>Buat PO saat mau belanja stok ke supplier. Saat barang diterima, stok & pengeluaran tercatat otomatis.</p>
          <button className="btn btn-primary" onClick={() => setForm(blankForm())}>+ Buat PO Pertama</button>
        </div></div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>No. PO</th><th>Tanggal</th><th>Produk</th><th>Jumlah</th><th>Supplier</th><th>Total</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map((po) => {
                const p = productOf(po.product_id)
                const st = PO_STATUS[po.status] || PO_STATUS.draft
                return (
                  <tr key={po.id}>
                    <td><b>{po.po_number}</b></td>
                    <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDate(po.created_at)}</td>
                    <td>{p?.name || '(produk terhapus)'}{po.note && <div className="muted-sm">{po.note}</div>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{Number(po.qty)} {p?.unit || ''}</td>
                    <td className="muted-sm">{supplierOf(po.supplier_id)?.name || '-'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><b>{rupiah(Math.round(Number(po.qty) * Number(po.unit_price)))}</b></td>
                    <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                    <td>
                      <div className="row-actions">
                        {po.status === 'draft' && (
                          <>
                            <button className="linklike" title="Setujui PO ini" onClick={() => approve(po)}>
                              <CheckCircle2 size={13} style={{ verticalAlign: '-2px' }} /> Setujui
                            </button>
                            <button className="icon-btn" title="Ubah draf" aria-label="Ubah draf" onClick={() => {
                              setErr('')
                              setForm({
                                id: po.id, product_id: po.product_id, supplier_id: po.supplier_id || '',
                                qty: String(po.qty), unit_price: String(po.unit_price),
                                expected_date: po.expected_date || '', note: po.note || '',
                              })
                            }}><Pencil size={15} /></button>
                            <button className="icon-btn danger" title="Hapus draf" aria-label="Hapus draf" onClick={() => remove(po)}><Trash2 size={15} /></button>
                          </>
                        )}
                        {po.status === 'approved' && (
                          <>
                            <button className="linklike" title="Barang sudah sampai" onClick={() => openReceive(po)}>
                              <PackageCheck size={13} style={{ verticalAlign: '-2px' }} /> Tandai Diterima
                            </button>
                            <button className="icon-btn danger" title="Batalkan PO" aria-label="Batalkan PO" onClick={() => cancel(po)}><XCircle size={15} /></button>
                          </>
                        )}
                        {po.status === 'received' && (
                          <span className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDate(po.received_at)}</span>
                        )}
                        {po.status === 'cancelled' && (
                          <button className="icon-btn danger" title="Hapus" aria-label="Hapus" onClick={() => remove(po)}><Trash2 size={15} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Modal buat/edit draf PO ---- */}
      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={saveForm}>
            <div className="modal-head">
              <h3>{form.id ? 'Ubah Draf PO' : 'Buat Purchase Order'}</h3>
              <button type="button" className="icon-btn" onClick={() => setForm(null)}>✕</button>
            </div>
            <div className="modal-body">
              {err && <div className="alert alert-err">{err}</div>}
              <div className="field">
                <label>Produk <span className="muted-sm">— satu produk per PO</span></label>
                <select className="input" value={form.product_id} onChange={(e) => pickFormProduct(e.target.value)}>
                  <option value="">— pilih produk —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} · stok {Number(p.stock)} {p.unit}</option>
                  ))}
                </select>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Jumlah {formProduct ? `(${formProduct.unit})` : ''}</label>
                  <input className="input" type="number" min="0" step="any" value={form.qty}
                    onChange={(e) => setForm({ ...form, qty: e.target.value })} />
                </div>
                <div className="field">
                  <label>Harga satuan (Rp)</label>
                  <input className="input" type="number" min="0" step="any" value={form.unit_price}
                    onChange={(e) => setForm({ ...form, unit_price: e.target.value })} placeholder="0" />
                </div>
              </div>
              <div className="field">
                <label>Supplier <span className="muted-sm">(opsional)</span></label>
                <select className="input" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                  <option value="">— tanpa supplier —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Perkiraan tiba <span className="muted-sm">(opsional)</span></label>
                  <input className="input" type="date" value={form.expected_date}
                    onChange={(e) => setForm({ ...form, expected_date: e.target.value })} />
                </div>
                <div className="field">
                  <label>Catatan <span className="muted-sm">(opsional)</span></label>
                  <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                    placeholder="cth: minta yang fresh" />
                </div>
              </div>
              <p className="muted-sm" style={{ textAlign: 'right' }}>Total: <b>{rupiah(formTotal)}</b></p>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost btn-block" onClick={() => setForm(null)}>Batal</button>
                <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Draf'}</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ---- Modal terima PO (layar penutup yang jelas — HCI rule 4) ---- */}
      {receiveTarget && (
        <div className="modal-backdrop" onClick={() => setReceiveTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Terima {receiveTarget.po_number}</h3>
              <button type="button" className="icon-btn" onClick={() => setReceiveTarget(null)}>✕</button>
            </div>
            <div className="modal-body">
              {err && <div className="alert alert-err">{err}</div>}
              <p style={{ marginTop: 0 }}>
                <b>{rcProduct?.name}</b> — {Number(receiveTarget.qty)} {rcProduct?.unit}.
                Stok akan berubah: <b>{Number(rcProduct?.stock) || 0} → {(Number(rcProduct?.stock) || 0) + Number(receiveTarget.qty)} {rcProduct?.unit}</b>.
              </p>
              <label className="agree" style={{ margin: '0 0 12px' }}>
                <input type="checkbox" checked={rcExpense} onChange={(e) => setRcExpense(e.target.checked)} />
                <span>Catat sebagai transaksi pengeluaran <b>{rupiah(rcTotal)}</b> (masuk cashflow & Laba Rugi)</span>
              </label>
              {rcExpense && (
                <>
                  <div className="field">
                    <label>Kategori pengeluaran</label>
                    <select className="input" value={rcCategory} onChange={(e) => setRcCategory(e.target.value)}>
                      {expenseCats.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Pembayaran ke supplier</label>
                    <div className="seg">
                      <button type="button" className={rcPayment === 'lunas' ? 'on-in' : ''}
                        onClick={() => setRcPayment('lunas')}>Lunas</button>
                      <button type="button" className={rcPayment === 'belum' ? 'on-out' : ''}
                        onClick={() => setRcPayment('belum')}>Belum (kredit)</button>
                    </div>
                  </div>
                  {rcPayment === 'belum' && (
                    <div className="field">
                      <label>Jatuh tempo pembayaran <span className="muted-sm">(opsional)</span></label>
                      <input className="input" type="date" value={rcDueDate} onChange={(e) => setRcDueDate(e.target.value)} />
                    </div>
                  )}
                </>
              )}
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost btn-block" onClick={() => setReceiveTarget(null)}>Batal</button>
                <button className="btn btn-primary btn-block" disabled={busy || (rcExpense && !rcCategory)} onClick={doReceive}>
                  {busy ? 'Memproses...' : 'Konfirmasi Terima'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
