import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ClipboardList, CheckCircle2, PackageCheck, Trash2, XCircle, Pencil } from 'lucide-react'
import Modal from '../components/Modal'
import {
  fetchPurchaseOrders, addPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder,
  receivePurchaseOrder, fetchProducts, fetchSuppliers,
} from '../lib/api'
import { nextDocNumber, PO_STATUS } from '../lib/gudang'
import { rupiah, fmtDate } from '../lib/format'
import { useCatalog } from '../context/CatalogContext'
import { useLang } from '../context/LangContext'
import { useAlert } from '../context/AlertContext'
import { BATAS_DATE, bersihkanTanggal } from '../lib/dateInput'

const blankForm = (productId = '') => ({
  id: null, product_id: productId, supplier_id: '', qty: '1', unit_price: '',
  expected_date: '', note: '',
})

// Alur PO: Draf -> Disetujui -> Diterima (stok bertambah + opsi catat pengeluaran).
// Satu PO = satu produk (selaras aturan 1 transaksi = 1 produk).
export default function PurchaseOrders() {
  const { t } = useLang()
  const { showConfirm } = useAlert()
  const poT = t.po
  const poStatusLabel = (key) => ({ draft: poT.statusDraft, approved: poT.statusApproved, received: poT.statusReceived, cancelled: poT.statusCancelled }[key])
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
    if (!form.product_id) return setErr(poT.errPickProduct)
    const qty = Number(form.qty)
    if (!qty || qty <= 0) return setErr(poT.errQty)
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
        setMsg(poT.updatedMsg.replace('{num}', upd.po_number))
      } else {
        const po_number = nextDocNumber('PO', (list || []).map((x) => x.po_number))
        const created = await addPurchaseOrder({ ...payload, po_number, status: 'draft' })
        setList((prev) => [created, ...(prev || [])])
        setMsg(poT.draftSavedMsg.replace('{num}', created.po_number))
      }
      setForm(null)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const approve = async (po) => {
    setMsg(''); setErr('')
    try {
      const upd = await updatePurchaseOrder(po.id, { status: 'approved', approved_at: new Date().toISOString() })
      setList((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
      setMsg(poT.approvedMsg.replace('{num}', upd.po_number))
    } catch (e2) { setErr(e2.message) }
  }

  const cancel = async (po) => {
    if (!await showConfirm({ message: poT.confirmCancel.replace('{num}', po.po_number) })) return
    try {
      const upd = await updatePurchaseOrder(po.id, { status: 'cancelled' })
      setList((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
    } catch (e2) { setErr(e2.message) }
  }

  const remove = async (po) => {
    if (!await showConfirm({ message: poT.confirmDelete.replace('{num}', po.po_number), type: 'error' })) return
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
        poT.receivedMsg.replace('{num}', res.po.po_number).replace('{product}', s.name).replace('{before}', s.before).replace('{after}', s.after).replace('{unit}', s.unit)
        + (res.txn
          ? ' ' + (rcPayment === 'belum'
            ? poT.debtNote.replace('{amount}', rupiah(res.txn.amount))
            : poT.expenseNote.replace('{amount}', rupiah(res.txn.amount)))
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
          <button className="icon-btn" onClick={() => setMsg('')} aria-label={poT.close}>✕</button>
        </div>
      )}
      {err && <div className="alert alert-err">{err}</div>}

      <div className="toolbar">
        <p className="muted-sm" style={{ flex: 1, margin: 0 }}>
          {poT.flowHint} <b>{poT.flowDraft}</b> → <b>{poT.flowApproved}</b> → <b>{poT.flowReceived}</b> {poT.flowSuffix}
        </p>
        <button className="btn btn-primary" onClick={() => { setErr(''); setForm(blankForm()) }}>{poT.addPo}</button>
      </div>

      {rows.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee"><ClipboardList size={36} /></div>
          <h3>{poT.emptyTitle}</h3>
          <p>{poT.emptyDesc}</p>
          <button className="btn btn-primary" onClick={() => setForm(blankForm())}>{poT.addFirst}</button>
        </div></div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>{poT.thNumber}</th><th>{poT.thDate}</th><th>{poT.thProduct}</th><th>{poT.thQty}</th><th>{poT.thSupplier}</th><th>{poT.thTotal}</th><th>{poT.thStatus}</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map((po) => {
                const p = productOf(po.product_id)
                const st = PO_STATUS[po.status] || PO_STATUS.draft
                return (
                  <tr key={po.id}>
                    <td><b>{po.po_number}</b></td>
                    <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDate(po.created_at)}</td>
                    <td>{p?.name || poT.deletedProduct}{po.note && <div className="muted-sm">{po.note}</div>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{Number(po.qty)} {p?.unit || ''}</td>
                    <td className="muted-sm">{supplierOf(po.supplier_id)?.name || poT.noSupplier}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><b>{rupiah(Math.round(Number(po.qty) * Number(po.unit_price)))}</b></td>
                    <td><span className={`badge ${st.cls}`}>{poStatusLabel(po.status)}</span></td>
                    <td>
                      <div className="row-actions">
                        {po.status === 'draft' && (
                          <>
                            <button className="linklike" title={poT.approveTitle} onClick={() => approve(po)}>
                              <CheckCircle2 size={13} style={{ verticalAlign: '-2px' }} /> {poT.approve}
                            </button>
                            <button className="icon-btn" title={poT.editDraftTitle} aria-label={poT.editDraftTitle} onClick={() => {
                              setErr('')
                              setForm({
                                id: po.id, product_id: po.product_id, supplier_id: po.supplier_id || '',
                                qty: String(po.qty), unit_price: String(po.unit_price),
                                expected_date: po.expected_date || '', note: po.note || '',
                              })
                            }}><Pencil size={15} /></button>
                            <button className="icon-btn danger" title={poT.delDraftTitle} aria-label={poT.delDraftTitle} onClick={() => remove(po)}><Trash2 size={15} /></button>
                          </>
                        )}
                        {po.status === 'approved' && (
                          <>
                            <button className="linklike" title={poT.receiveTitle} onClick={() => openReceive(po)}>
                              <PackageCheck size={13} style={{ verticalAlign: '-2px' }} /> {poT.receive}
                            </button>
                            <button className="icon-btn danger" title={poT.cancelTitle} aria-label={poT.cancelTitle} onClick={() => cancel(po)}><XCircle size={15} /></button>
                          </>
                        )}
                        {po.status === 'received' && (
                          <span className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDate(po.received_at)}</span>
                        )}
                        {po.status === 'cancelled' && (
                          <button className="icon-btn danger" title={poT.del} aria-label={poT.del} onClick={() => remove(po)}><Trash2 size={15} /></button>
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
        <Modal onClose={() => setForm(null)} onSubmit={saveForm} labelledBy="poFormModalTitle">
            <div className="modal-head">
              <h3 id="poFormModalTitle">{form.id ? poT.editDraftModalTitle : poT.addModalTitle}</h3>
              <button type="button" className="icon-btn" onClick={() => setForm(null)} aria-label={poT.close}>✕</button>
            </div>
            <div className="modal-body">
              {err && <div className="alert alert-err">{err}</div>}
              <div className="field">
                <label htmlFor="po-product">{poT.lProduct} <span className="muted-sm">{poT.productHint}</span></label>
                <select id="po-product" className="input" value={form.product_id} onChange={(e) => pickFormProduct(e.target.value)}>
                  <option value="">{poT.pickProduct}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} · {poT.stockLabel} {Number(p.stock)} {p.unit}</option>
                  ))}
                </select>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="po-qty">{poT.lQty} {formProduct ? `(${formProduct.unit})` : ''}</label>
                  <input id="po-qty" className="input" type="number" min="0" step="any" value={form.qty}
                    onChange={(e) => setForm({ ...form, qty: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="po-unit-price">{poT.lUnitPrice}</label>
                  <input id="po-unit-price" className="input" type="number" min="0" step="any" value={form.unit_price}
                    onChange={(e) => setForm({ ...form, unit_price: e.target.value })} placeholder="0" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="po-supplier">{poT.lSupplier} <span className="muted-sm">{poT.optional}</span></label>
                <select id="po-supplier" className="input" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                  <option value="">{poT.noSupplierOpt}</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="po-expected-date">{poT.lExpectedDate} <span className="muted-sm">{poT.optional}</span></label>
                  <input id="po-expected-date" className="input" type="date" {...BATAS_DATE} value={form.expected_date}
                    onChange={(e) => setForm({ ...form, expected_date: bersihkanTanggal(e.target.value) })} />
                </div>
                <div className="field">
                  <label htmlFor="po-note">{poT.lNote} <span className="muted-sm">{poT.optional}</span></label>
                  <input id="po-note" className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                    placeholder={poT.notePh} />
                </div>
              </div>
              <p className="muted-sm" style={{ textAlign: 'right' }}>{poT.total} <b>{rupiah(formTotal)}</b></p>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost btn-block" onClick={() => setForm(null)}>{poT.cancel}</button>
                <button className="btn btn-primary btn-block" disabled={busy}>{busy ? poT.saving : poT.saveDraft}</button>
              </div>
            </div>
        </Modal>
      )}

      {/* ---- Modal terima PO (layar penutup yang jelas — HCI rule 4) ---- */}
      {receiveTarget && (
        <Modal onClose={() => setReceiveTarget(null)} labelledBy="poReceiveModalTitle">
            <div className="modal-head">
              <h3 id="poReceiveModalTitle">{poT.receiveModalTitle.replace('{num}', receiveTarget.po_number)}</h3>
              <button type="button" className="icon-btn" onClick={() => setReceiveTarget(null)} aria-label={poT.close}>✕</button>
            </div>
            <div className="modal-body">
              {err && <div className="alert alert-err">{err}</div>}
              <p style={{ marginTop: 0 }}>
                <b>{rcProduct?.name}</b> — {Number(receiveTarget.qty)} {rcProduct?.unit}.
                {' '}{poT.stockChangeNote} <b>{Number(rcProduct?.stock) || 0} → {(Number(rcProduct?.stock) || 0) + Number(receiveTarget.qty)} {rcProduct?.unit}</b>.
              </p>
              <label className="agree" style={{ margin: '0 0 12px' }}>
                <input type="checkbox" checked={rcExpense} onChange={(e) => setRcExpense(e.target.checked)} />
                <span>{poT.createExpenseLabel} <b>{rupiah(rcTotal)}</b> {poT.createExpenseSuffix}</span>
              </label>
              {rcExpense && (
                <>
                  <div className="field">
                    <label htmlFor="po-rc-category">{poT.lExpenseCategory}</label>
                    <select id="po-rc-category" className="input" value={rcCategory} onChange={(e) => setRcCategory(e.target.value)}>
                      {expenseCats.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label id="po-payment-label">{poT.lPaymentTo}</label>
                    <div className="seg" role="group" aria-labelledby="po-payment-label">
                      <button type="button" className={rcPayment === 'lunas' ? 'on-in' : ''}
                        aria-pressed={rcPayment === 'lunas'}
                        onClick={() => setRcPayment('lunas')}>{poT.paid}</button>
                      <button type="button" className={rcPayment === 'belum' ? 'on-out' : ''}
                        aria-pressed={rcPayment === 'belum'}
                        onClick={() => setRcPayment('belum')}>{poT.unpaid}</button>
                    </div>
                  </div>
                  {rcPayment === 'belum' && (
                    <div className="field">
                      <label htmlFor="po-rc-due-date">{poT.lDueDate} <span className="muted-sm">{poT.optional}</span></label>
                      <input id="po-rc-due-date" className="input" type="date" {...BATAS_DATE} value={rcDueDate} onChange={(e) => setRcDueDate(bersihkanTanggal(e.target.value))} />
                    </div>
                  )}
                </>
              )}
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost btn-block" onClick={() => setReceiveTarget(null)}>{poT.cancel}</button>
                <button className="btn btn-primary btn-block" disabled={busy || (rcExpense && !rcCategory)} onClick={doReceive}>
                  {busy ? poT.processing : poT.confirmReceive}
                </button>
              </div>
            </div>
        </Modal>
      )}
    </>
  )
}
