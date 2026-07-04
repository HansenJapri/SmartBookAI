import { useState, useEffect } from 'react'
import { categorize } from '../lib/categorize'
import { toDateInput } from '../lib/format'
import { useCatalog } from '../context/CatalogContext'

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
  const [customerName, setCustomerName] = useState(initial?.customer_name || '')
  const [customerContact, setCustomerContact] = useState(initial?.customer_contact || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const cats = catNames(direction)

  // Auto-saran kategori saat ketik deskripsi
  useEffect(() => {
    if (touchedCat) return
    if (description.trim().length < 3) return
    const suggested = categorize(description, direction, rules)
    setCategory(cats.includes(suggested) ? suggested : (cats[0] || ''))
  }, [description, direction, touchedCat, rules]) // eslint-disable-line

  // Pastikan kategori valid saat ganti arah
  useEffect(() => {
    if (!cats.includes(category)) setCategory(cats[0] || '')
  }, [direction]) // eslint-disable-line

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    const amt = Number(amount)
    if (!description.trim()) return setErr('Deskripsi wajib diisi.')
    if (!amt || amt <= 0) return setErr('Nominal harus lebih dari 0.')
    if (!category) return setErr('Pilih kategori dulu.')
    setBusy(true)
    try {
      await onSave({
        description: description.trim(),
        amount: amt,
        direction,
        category,
        channel,
        occurred_at: new Date(occurredAt).toISOString(),
        payment_status: direction === 'in' ? paymentStatus : 'lunas',
        customer_name: direction === 'in' ? (customerName.trim() || null) : null,
        customer_contact: direction === 'in' ? (customerContact.trim() || null) : null,
      })
      onClose()
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h3>{editing ? 'Edit Transaksi' : 'Tambah Transaksi'}</h3>
          <button type="button" className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {err && <div className="alert alert-err">{err}</div>}
          <div className="field">
            <label>Jenis</label>
            <div className="seg">
              <button type="button" className={direction === 'in' ? 'on-in' : ''}
                onClick={() => { setDirection('in'); setTouchedCat(true) }}>↓ Pemasukan</button>
              <button type="button" className={direction === 'out' ? 'on-out' : ''}
                onClick={() => { setDirection('out'); setTouchedCat(true) }}>↑ Pengeluaran</button>
            </div>
          </div>
          <div className="field">
            <label>Deskripsi</label>
            <input className="input" value={description} autoFocus
              onChange={(e) => setDescription(e.target.value)}
              placeholder="cth: Transfer masuk dari Bu Sari / Belanja stok di pasar" />
          </div>
          <div className="field">
            <label>Nominal (Rp)</label>
            <input className="input" type="number" min="0" step="any" value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="150000" />
          </div>
          <div className="field">
            <label>Kategori</label>
            <select className="input" value={category}
              onChange={(e) => { setCategory(e.target.value); setTouchedCat(true) }}>
              {cats.length === 0 && <option value="">(belum ada kategori)</option>}
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Sumber / Channel</label>
            <select className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
              {channels.length === 0 && <option value="manual">Manual</option>}
              {channels.map((c) => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Tanggal & waktu</label>
            <input className="input" type="datetime-local" value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)} />
          </div>

          {direction === 'in' && (
            <>
              <div className="field">
                <label>Status pembayaran</label>
                <div className="seg">
                  <button type="button" className={paymentStatus === 'lunas' ? 'on-in' : ''}
                    onClick={() => setPaymentStatus('lunas')}>Lunas</button>
                  <button type="button" className={paymentStatus === 'belum' ? 'on-out' : ''}
                    onClick={() => setPaymentStatus('belum')}>Belum Lunas</button>
                </div>
              </div>
              <div className="field">
                <label>Nama pelanggan <span className="muted-sm">(opsional, untuk invoice)</span></label>
                <input className="input" value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)} placeholder="cth: Bu Sari" />
              </div>
              <div className="field">
                <label>Kontak pelanggan / WhatsApp <span className="muted-sm">(opsional)</span></label>
                <input className="input" value={customerContact}
                  onChange={(e) => setCustomerContact(e.target.value)} placeholder="08xxxxxxxxxx" />
              </div>
            </>
          )}

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost btn-block" onClick={onClose}>Batal</button>
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
