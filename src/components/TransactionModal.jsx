import { useState, useEffect } from 'react'
import { Plus, Minus, Trash2, PackagePlus } from 'lucide-react'
import Modal from './Modal'
import { categorize } from '../lib/categorize'
import { toDateInput, rupiah } from '../lib/format'
import { fetchProducts } from '../lib/api'
import { useCatalog } from '../context/CatalogContext'

// Stepper jumlah: tombol - dan +, plus input manual (boleh desimal).
function QtyStepper({ value, onChange }) {
  const v = Number(value) || 0
  return (
    <div className="qty-stepper">
      <button type="button" onClick={() => onChange(String(Math.max(0, +(v - 1).toFixed(4))))} aria-label="Kurangi"><Minus size={14} /></button>
      <input type="number" min="0" step="any" value={value}
        onChange={(e) => onChange(e.target.value)} />
      <button type="button" onClick={() => onChange(String(+(v + 1).toFixed(4)))} aria-label="Tambah"><Plus size={14} /></button>
    </div>
  )
}

const blankLine = () => ({
  key: Math.random().toString(36).slice(2), productId: '', unit: '', qty: '1',
  unitPrice: '', total: '', priceEdited: false,
})

export default function TransactionModal({ initial, rules = [], onClose, onSave }) {
  const { channels, catNames } = useCatalog()
  const editing = Boolean(initial?.id)
  const [direction, setDirection] = useState(initial?.direction || 'in')
  const [description, setDescription] = useState(initial?.description || '')
  const [amount, setAmount] = useState(initial?.amount || '')
  const [category, setCategory] = useState(initial?.category || '')
  const [channel, setChannel] = useState(initial?.channel || 'manual')
  const [occurredAt, setOccurredAt] = useState(toDateInput(initial?.occurred_at))
  const [touchedCat, setTouchedCat] = useState(editing)
  const [paymentStatus, setPaymentStatus] = useState(initial?.payment_status || 'lunas')
  const [dueDate, setDueDate] = useState(initial?.due_date || '')
  const [customerName, setCustomerName] = useState(initial?.customer_name || '')
  const [customerContact, setCustomerContact] = useState(initial?.customer_contact || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Produk & baris item. Baris produk hanya untuk transaksi BARU (saat edit,
  // stok tidak diubah agar tidak dobel; pengguna atur stok manual di menu Stok).
  const [products, setProducts] = useState([])
  const [lines, setLines] = useState([])
  const showProductLines = !editing

  const cats = catNames(direction)

  useEffect(() => { if (!editing) fetchProducts().then(setProducts).catch(() => {}) }, [editing])

  // Harga acuan produk sesuai arah: jual pakai harga jual, beli pakai harga modal.
  const defaultPrice = (p) => {
    if (!p) return 0
    return direction === 'in'
      ? (Number(p.price) || 0)
      : (Number(p.cost_price) || Number(p.price) || 0)
  }

  const recalcLine = (line, patch) => {
    const next = { ...line, ...patch }
    // Jika qty atau harga satuan berubah dan total belum diedit manual -> hitung ulang total.
    if (('qty' in patch || 'unitPrice' in patch) && !next.priceEdited) {
      next.total = String(Math.round((Number(next.qty) || 0) * (Number(next.unitPrice) || 0)))
    }
    return next
  }

  const setLine = (key, patch) => setLines((arr) => arr.map((l) => (l.key === key ? recalcLine(l, patch) : l)))
  const addLine = () => setLines((arr) => [...arr, blankLine()])
  const removeLine = (key) => setLines((arr) => arr.filter((l) => l.key !== key))

  const pickProduct = (key, productId) => {
    const p = products.find((x) => x.id === productId)
    setLines((arr) => arr.map((l) => {
      if (l.key !== key) return l
      const up = defaultPrice(p)
      const qty = Number(l.qty) || 1
      return { ...l, productId, unit: p?.unit || '', unitPrice: String(up), priceEdited: false, total: String(Math.round(qty * up)) }
    }))
  }

  const linkedLines = lines.filter((l) => l.productId && Number(l.qty) > 0)
  const linesTotal = linkedLines.reduce((s, l) => s + (Number(l.total) || 0), 0)

  // Total produk otomatis menjadi Nominal transaksi (tetap bisa diubah manual di bawah).
  useEffect(() => {
    if (lines.some((l) => l.productId)) setAmount(String(Math.round(linesTotal)))
  }, [linesTotal]) // eslint-disable-line

  // Saat arah berubah, harga satuan acuan produk ikut menyesuaikan (jual vs beli).
  useEffect(() => {
    setLines((arr) => arr.map((l) => {
      if (!l.productId || l.priceEdited) return l
      const p = products.find((x) => x.id === l.productId)
      const up = defaultPrice(p)
      return { ...l, unitPrice: String(up), total: String(Math.round((Number(l.qty) || 0) * up)) }
    }))
  }, [direction]) // eslint-disable-line

  // Auto-saran kategori saat ketik deskripsi
  useEffect(() => {
    if (touchedCat) return
    if (description.trim().length < 3) return
    const suggested = categorize(description, direction, rules)
    setCategory(cats.includes(suggested) ? suggested : (cats[0] || ''))
  }, [description, direction, touchedCat, rules]) // eslint-disable-line

  useEffect(() => {
    if (!cats.includes(category)) setCategory(cats[0] || '')
  }, [direction]) // eslint-disable-line

  // Kelompokkan produk per kategori produk untuk dropdown yang rapi.
  const productGroups = products.reduce((acc, p) => {
    const g = p.category || 'Lainnya'
    ;(acc[g] = acc[g] || []).push(p)
    return acc
  }, {})

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    // Deskripsi otomatis dari produk bila kosong.
    let desc = description.trim()
    if (!desc && linkedLines.length) {
      const names = linkedLines.map((l) => {
        const p = products.find((x) => x.id === l.productId)
        return `${l.qty} ${l.unit} ${p?.name || ''}`.trim()
      })
      desc = (direction === 'in' ? 'Penjualan: ' : 'Pembelian: ') + names.slice(0, 3).join(', ') + (names.length > 3 ? ', dll' : '')
    }
    const amt = Number(amount)
    if (!desc) return setErr('Deskripsi wajib diisi (atau pilih produk).')
    if (!amt || amt <= 0) return setErr('Nominal harus lebih dari 0.')
    if (!category) return setErr('Pilih kategori dulu.')
    setBusy(true)
    try {
      // Simpan product_id & qty bila tepat satu baris produk (untuk analitik granular).
      const single = linkedLines.length === 1 ? linkedLines[0] : null
      await onSave(
        {
          description: desc.slice(0, 200),
          amount: amt,
          direction,
          category,
          channel,
          occurred_at: new Date(occurredAt).toISOString(),
          // 'belum' pada pemasukan = PIUTANG; pada pengeluaran = UTANG.
          payment_status: paymentStatus,
          due_date: paymentStatus === 'belum' && dueDate ? dueDate : null,
          customer_name: customerName.trim() || null,
          customer_contact: customerContact.trim() || null,
          product_id: single ? single.productId : null,
          qty: single ? Number(single.qty) : null,
        },
        { lines: linkedLines, direction, isNew: !editing },
      )
      onClose()
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <Modal onClose={onClose} onSubmit={submit} className="modal-lg" labelledBy="txModalTitle">
        <div className="modal-head">
          <h3 id="txModalTitle">{editing ? 'Edit Transaksi' : 'Tambah Transaksi'}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Tutup">✕</button>
        </div>
        <div className="modal-body">
          {err && <div className="alert alert-err">{err}</div>}
          <div className="field">
            {/* Pilihan berupa tombol, bukan satu kontrol tunggal — jadi diberi
                semantik grup + status tertekan, bukan label-for. */}
            <label id="tx-direction-label">Jenis</label>
            <div className="seg" role="group" aria-labelledby="tx-direction-label">
              <button type="button" className={direction === 'in' ? 'on-in' : ''}
                aria-pressed={direction === 'in'}
                onClick={() => { setDirection('in'); setTouchedCat(true) }}>↓ Pemasukan</button>
              <button type="button" className={direction === 'out' ? 'on-out' : ''}
                aria-pressed={direction === 'out'}
                onClick={() => { setDirection('out'); setTouchedCat(true) }}>↑ Pengeluaran</button>
            </div>
          </div>

          {/* BARIS PRODUK: pilih produk, jumlah (stepper/manual), harga auto-kali & editable.
              Tersambung ke stok saat disimpan. Aturan: SATU produk per transaksi —
              penjualan beberapa produk dicatat sebagai beberapa transaksi terpisah. */}
          {showProductLines && (
            <div className="field">
              <label>
                {direction === 'in' ? 'Produk yang terjual' : 'Produk yang dibeli (stok masuk)'}
                <span className="muted-sm"> — opsional, satu produk per transaksi, otomatis mengurangi/menambah stok</span>
              </label>

              {products.length === 0 ? (
                <p className="muted-sm">Belum ada produk. Tambahkan di menu Stok Produk untuk memakai fitur ini.</p>
              ) : lines.length === 0 ? (
                <button type="button" className="btn btn-ghost btn-block" onClick={addLine}>
                  <PackagePlus size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
                  Pilih produk dari stok
                </button>
              ) : (
                <div className="prod-lines">
                  {lines.map((l) => {
                    const p = products.find((x) => x.id === l.productId)
                    return (
                      <div className="prod-line" key={l.key}>
                        <div className="pl-row">
                          <select className="input" value={l.productId} onChange={(e) => pickProduct(l.key, e.target.value)}>
                            <option value="">— pilih produk —</option>
                            {Object.entries(productGroups).map(([g, list]) => (
                              <optgroup key={g} label={g}>
                                {list.map((pr) => (
                                  <option key={pr.id} value={pr.id}>
                                    {pr.name} · stok {Number(pr.stock)} {pr.unit}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                          <button type="button" className="icon-btn danger" onClick={() => removeLine(l.key)} aria-label="Hapus produk"><Trash2 size={15} /></button>
                        </div>
                        {p && (
                          <div className="pl-grid">
                            <div className="pl-cell">
                              <span className="pl-lbl">Jumlah ({p.unit})</span>
                              <QtyStepper value={l.qty} onChange={(v) => setLine(l.key, { qty: v })} />
                            </div>
                            <div className="pl-cell">
                              <span className="pl-lbl">Harga satuan (Rp)</span>
                              <input className="input" type="number" min="0" step="any" value={l.unitPrice}
                                onChange={(e) => setLine(l.key, { unitPrice: e.target.value, priceEdited: false })} />
                            </div>
                            <div className="pl-cell">
                              <span className="pl-lbl">Total (Rp) — bisa diubah</span>
                              <input className="input" type="number" min="0" step="any" value={l.total}
                                onChange={(e) => setLine(l.key, { total: e.target.value, priceEdited: true })} />
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {linkedLines.length > 0 && (
                    <div className="pl-total">Total produk: <b>{rupiah(linesTotal)}</b></div>
                  )}
                  <p className="muted-sm" style={{ margin: 0 }}>
                    Menjual lebih dari satu produk? Simpan transaksi ini dulu, lalu catat produk berikutnya sebagai transaksi baru.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="field">
            <label htmlFor="tx-description">Deskripsi</label>
            <input id="tx-description" className="input" value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={linkedLines.length ? '(otomatis dari produk bila dikosongkan)' : 'cth: Transfer masuk dari Bu Sari / Belanja stok di pasar'} />
          </div>
          <div className="field">
            <label htmlFor="tx-amount">
              Nominal (Rp)
              {linkedLines.length > 0 && <span className="muted-sm"> — otomatis dari produk, bisa diubah</span>}
            </label>
            <input id="tx-amount" className="input" type="number" min="0" step="any" value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="150000" />
          </div>
          <div className="field">
            <label htmlFor="tx-category">Kategori</label>
            <select id="tx-category" className="input" value={category}
              onChange={(e) => { setCategory(e.target.value); setTouchedCat(true) }}>
              {cats.length === 0 && <option value="">(belum ada kategori)</option>}
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tx-channel">Sumber / Channel</label>
            <select id="tx-channel" className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
              {channels.length === 0 && <option value="manual">Manual</option>}
              {channels.map((c) => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tx-occurred-at">Tanggal &amp; waktu</label>
            <input id="tx-occurred-at" className="input" type="datetime-local" value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)} />
          </div>

          <div className="field">
            <label id="tx-payment-label">Status pembayaran</label>
            <div className="seg" role="group" aria-labelledby="tx-payment-label">
              <button type="button" className={paymentStatus === 'lunas' ? 'on-in' : ''}
                aria-pressed={paymentStatus === 'lunas'}
                onClick={() => setPaymentStatus('lunas')}>Lunas</button>
              <button type="button" className={paymentStatus === 'belum' ? 'on-out' : ''}
                aria-pressed={paymentStatus === 'belum'}
                onClick={() => setPaymentStatus('belum')}>Belum Lunas</button>
            </div>
            {paymentStatus === 'belum' && (
              <p className="muted-sm" style={{ margin: '6px 0 0' }}>
                {direction === 'in'
                  ? 'Tercatat sebagai PIUTANG di menu Piutang & Utang.'
                  : 'Tercatat sebagai UTANG di menu Piutang & Utang.'}
              </p>
            )}
          </div>
          {paymentStatus === 'belum' && (
            <div className="field">
              <label htmlFor="tx-due-date">Jatuh tempo <span className="muted-sm">(opsional, untuk pengingat)</span></label>
              <input id="tx-due-date" className="input" type="date" value={dueDate}
                onChange={(e) => setDueDate(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="tx-customer-name">{direction === 'in' ? 'Nama pelanggan' : 'Nama pemasok/pihak'} <span className="muted-sm">(opsional{direction === 'in' ? ', untuk invoice' : ''})</span></label>
            <input id="tx-customer-name" className="input" value={customerName}
              onChange={(e) => setCustomerName(e.target.value)} placeholder={direction === 'in' ? 'cth: Bu Sari' : 'cth: Toko Grosir Jaya'} />
          </div>
          <div className="field">
            <label htmlFor="tx-customer-contact">{direction === 'in' ? 'Kontak pelanggan / WhatsApp' : 'Kontak pemasok / WhatsApp'} <span className="muted-sm">(opsional)</span></label>
            <input id="tx-customer-contact" className="input" value={customerContact}
              onChange={(e) => setCustomerContact(e.target.value)} placeholder="08xxxxxxxxxx" />
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost btn-block" onClick={onClose}>Batal</button>
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
    </Modal>
  )
}
