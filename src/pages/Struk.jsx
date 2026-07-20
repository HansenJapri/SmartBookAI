import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, FolderOpen, ScanLine, FileText, Sparkles, Plus, Trash2, X } from 'lucide-react'
import { useCatalog } from '../context/CatalogContext'
import { uploadReceipt, addTransaction, fetchProducts, updateProduct } from '../lib/api'
import { readReceipt } from '../lib/ai'
import { compressImage } from '../lib/imageCompress'
import { toDateInput, rupiah } from '../lib/format'
import AIDisclaimer from '../components/AIDisclaimer'
import Modal from '../components/Modal'

const ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.pdf,image/*,application/pdf'
const blankItem = () => ({ name: '', qty: 1, unit: 'pcs', total: '', productId: '', conv: 1 })

export default function Struk() {
  const nav = useNavigate()
  const fileRef = useRef()
  const cameraRef = useRef()
  const { catNames, ready } = useCatalog()

  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [direction, setDirection] = useState('out')
  const [category, setCategory] = useState('')
  const [occurredAt, setOccurredAt] = useState(toDateInput())
  const [keterangan, setKeterangan] = useState('')
  const [items, setItems] = useState([])
  const [products, setProducts] = useState([])
  const [aiBusy, setAiBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [doneMsg, setDoneMsg] = useState('')
  const [confirming, setConfirming] = useState(false)
  // Metadata hasil baca AI: total versi struk & tingkat keterbacaan (cetak/buram/tulisan tangan).
  const [aiMeta, setAiMeta] = useState(null)

  const cats = catNames(direction)
  useEffect(() => { if (!cats.includes(category)) setCategory(cats[0] || '') }, [direction, ready]) // eslint-disable-line
  useEffect(() => { fetchProducts().then(setProducts).catch(() => {}) }, [])

  const pickFile = (f) => {
    if (!f) return
    const okType = f.type.startsWith('image/') || f.type === 'application/pdf' || /\.(jpe?g|png|webp|heic|pdf)$/i.test(f.name)
    if (!okType) { setErr('Format harus foto (JPG/PNG) atau PDF.'); return }
    if (f.size > 10 * 1024 * 1024) { setErr('Ukuran file maksimal 10 MB.'); return }
    setErr(''); setFile(f)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(f.type.startsWith('image/') ? URL.createObjectURL(f) : null)
  }
  const onDrop = (e) => { e.preventDefault(); pickFile(e.dataTransfer.files[0]) }

  const matchProduct = (name) => {
    const n = (name || '').toLowerCase()
    return products.find((p) => n && (n.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(n)))
  }

  const runAI = async () => {
    if (!file) { setErr('Unggah foto atau PDF struk dulu.'); return }
    setErr(''); setAiBusy(true); setAiMeta(null)
    try {
      // Kompres di sisi klien: hemat biaya AI vision + kuota data seluler.
      const toSend = await compressImage(file)
      const res = await readReceipt(toSend)
      const mapped = (res.items || []).map((it) => {
        const p = matchProduct(it.name)
        return {
          name: it.name || '', qty: Number(it.qty) || 1, unit: it.unit || 'pcs',
          total: String(Math.round(it.total || (it.unit_price * it.qty) || 0)),
          productId: p ? p.id : '', conv: p ? (p.unit === it.unit ? 1 : '') : 1,
        }
      })
      setItems(mapped.length ? mapped : [blankItem()])
      setKeterangan(res.merchant ? `Belanja di ${res.merchant}` : '')
      setDirection('out')
      setAiMeta({ total: Number(res.total) || 0, legibility: res.legibility || 'cetak_jelas' })
      if (res.date) { try { setOccurredAt(toDateInput(res.date + 'T12:00')) } catch { /* abaikan */ } }
      if (!mapped.length) setErr('AI tidak menemukan item. Anda bisa menambah item manual di bawah.')
    } catch (e) { setErr(e.message) } finally { setAiBusy(false) }
  }

  const addItem = () => setItems((a) => [...a, blankItem()])
  const setItem = (i, patch) => setItems((a) => a.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  const removeItem = (i) => setItems((a) => a.filter((_, idx) => idx !== i))

  const productById = (id) => products.find((p) => p.id === id)
  const grandTotal = items.reduce((s, it) => s + (Number(it.total) || 0), 0)
  // Jumlah yang ditambahkan/dikurangi ke stok (dalam satuan stok) untuk item yang dicocokkan.
  const stockQty = (it) => (it.productId ? (Number(it.qty) || 0) * (Number(it.conv) || 0) : 0)
  const mismatchCount = items.filter((it) => it.productId && (!it.conv || Number(it.conv) <= 0)).length
  const linkedCount = items.filter((it) => it.productId && stockQty(it) > 0).length
  // Silang-periksa DETERMINISTIK: jumlah rincian item vs total yang terbaca
  // di struk (toleransi 2%) — menangkap salah baca OCR tanpa panggilan AI baru.
  const aiTotalMismatch = Boolean(aiMeta && aiMeta.total > 0 && grandTotal > 0
    && Math.abs(grandTotal - aiMeta.total) / aiMeta.total > 0.02)

  const submit = (e) => {
    e.preventDefault(); setErr(''); setDoneMsg('')
    if (!items.length) return setErr('Belum ada item. Baca struk dengan AI atau tambah item manual.')
    if (grandTotal <= 0) return setErr('Total harus lebih dari 0. Isi harga tiap item.')
    if (!category) return setErr('Pilih kategori dulu.')
    setConfirming(true)
  }

  const doSave = async () => {
    setConfirming(false); setBusy(true); setErr('')
    try {
      let receipt_url = null
      if (file) { try { receipt_url = await uploadReceipt(file) } catch { /* lampiran opsional */ } }
      const desc = keterangan.trim()
        || (items.length ? `Belanja: ${items.slice(0, 3).map((it) => `${it.qty} ${it.unit} ${it.name}`).join(', ')}${items.length > 3 ? ', dll' : ''}` : 'Belanja')
      await addTransaction({
        description: desc.slice(0, 200),
        amount: grandTotal,
        direction, category,
        channel: 'struk',
        occurred_at: new Date(occurredAt).toISOString(),
        receipt_url,
        source_ref: file ? file.name : null,
      })
      // Perbarui stok: pengeluaran (beli) menambah stok, pemasukan (jual) mengurangi.
      for (const it of items) {
        const q = stockQty(it)
        if (it.productId && q > 0) {
          const p = productById(it.productId)
          if (p) {
            const next = Number(p.stock) + (direction === 'out' ? q : -q)
            await updateProduct(p.id, { stock: next < 0 ? 0 : next })
          }
        }
      }
      setDoneMsg(`Transaksi tersimpan (${items.length} item)` + (linkedCount ? ` dan stok ${linkedCount} produk diperbarui.` : '.'))
      setFile(null); if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null)
      setItems([]); setKeterangan(''); setAiMeta(null)
      fetchProducts().then(setProducts).catch(() => {})
    } catch (e) {
      setErr(e.message?.toLowerCase().includes('bucket')
        ? 'Penyimpanan struk belum disiapkan. Jalankan migration_v2.sql (membuat bucket "receipts").'
        : 'Gagal menyimpan: ' + e.message)
    } finally { setBusy(false) }
  }

  return (
    <div style={{ maxWidth: 1040 }}>
      {doneMsg && (
        <div className="alert alert-ok" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span>{doneMsg}</span>
          <button className="btn btn-primary" onClick={() => nav('/app/transaksi')}>Lihat Transaksi</button>
        </div>
      )}
      {err && <div className="alert alert-err">{err}</div>}

      {/* 1. Unggah & baca struk */}
      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <h3 className="card-title">1. Unggah Struk lalu Baca dengan AI</h3>
        <div className="card-sub">AI akan memindai struk dan mendeteksi item belanja. Anda tinjau dan perbaiki sebelum disimpan.</div>
        <div className="grid-2">
          <div>
            <div className="drop" onClick={() => fileRef.current.click()} onDragOver={(e) => e.preventDefault()} onDrop={onDrop} style={{ minHeight: 180 }}>
              {previewUrl ? (
                <img src={previewUrl} alt="pratinjau struk" style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 10 }} />
              ) : file ? (
                <><div className="di"><FileText size={30} /></div><h3>{file.name}</h3><p>Siap dibaca</p></>
              ) : (
                <><div className="di"><ScanLine size={30} /></div><h3>Ambil foto atau pilih file</h3><p>JPG, PNG, atau PDF, maks. 10 MB. Paling akurat: struk cetak kasir — bon tulisan tangan belum didukung penuh.</p></>
              )}
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pickFile(e.target.files[0])} />
            <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => pickFile(e.target.files[0])} />
            <div className="flex gap mt" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ghost" onClick={() => cameraRef.current.click()}><Camera size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />Ambil Foto</button>
              <button type="button" className="btn btn-ghost" onClick={() => fileRef.current.click()}><FolderOpen size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />Pilih File</button>
            </div>
          </div>
          <div className="flex" style={{ flexDirection: 'column', justifyContent: 'center', gap: 12 }}>
            <button type="button" className="btn btn-primary btn-lg" onClick={runAI} disabled={aiBusy || !file} style={{ justifyContent: 'center' }}>
              <Sparkles size={18} style={{ verticalAlign: '-4px', marginRight: 8 }} />
              {aiBusy ? 'Membaca struk...' : 'Baca Struk dengan AI'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { if (!items.length) setItems([blankItem()]) }} style={{ justifyContent: 'center' }}>
              Atau isi item manual
            </button>
            <p className="muted-sm" style={{ margin: 0 }}>Jika satuan di struk berbeda dengan satuan stok (mis. "dus" vs "pcs"), Anda akan diminta mengisi konversinya agar stok tetap akurat.</p>
          </div>
        </div>
      </div>

      {/* 2. Tinjau item & simpan */}
      {items.length > 0 && (
        <form className="card card-pad" onSubmit={submit}>
          <h3 className="card-title">2. Tinjau Item dan Simpan</h3>
          <div className="card-sub">Periksa item hasil pindaian. Anda bisa tambah, ubah, atau hapus item sebelum menyimpan.</div>

          {aiMeta?.legibility === 'tulisan_tangan' && (
            <div className="alert alert-err" style={{ margin: '10px 0 0' }}>
              Struk ini terdeteksi <b>tulisan tangan</b>. Dukungan penuh hanya untuk struk cetak kasir — hasil baca kemungkinan banyak salah, mohon periksa setiap baris.
            </div>
          )}
          {aiMeta?.legibility === 'buram' && (
            <div className="alert alert-err" style={{ margin: '10px 0 0' }}>
              Foto terdeteksi <b>buram/kurang jelas</b>. Bila banyak yang salah, foto ulang dengan cahaya cukup dan posisi tegak lurus.
            </div>
          )}
          {aiTotalMismatch && (
            <div className="alert alert-err" style={{ margin: '10px 0 0' }}>
              Jumlah rincian item ({rupiah(grandTotal)}) <b>tidak cocok</b> dengan total di struk ({rupiah(aiMeta.total)}). Periksa kembali harga tiap baris.
            </div>
          )}
          {aiMeta && <AIDisclaimer text="Hasil baca AI bisa keliru — periksa nama item, jumlah, dan harga sebelum simpan." />}

          <div className="grid-2" style={{ marginBottom: 6, marginTop: 10 }}>
            <div className="field">
              <label>Simpan sebagai</label>
              <div className="seg">
                <button type="button" className={direction === 'in' ? 'on-in' : ''} onClick={() => setDirection('in')}>Pemasukan (penjualan)</button>
                <button type="button" className={direction === 'out' ? 'on-out' : ''} onClick={() => setDirection('out')}>Pengeluaran (belanja)</button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="struk-category">Kategori</label>
              <select id="struk-category" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {cats.length === 0 && <option value="">(belum ada kategori)</option>}
                {cats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="struk-occurred-at">Tanggal & waktu</label>
              <input id="struk-occurred-at" className="input" type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="struk-note">Keterangan</label>
              <input id="struk-note" className="input" value={keterangan} onChange={(e) => setKeterangan(e.target.value)} placeholder="cth: Belanja stok di Pasar Induk" />
            </div>
          </div>

          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table className="tbl">
              <thead><tr>
                <th>Item</th><th style={{ textAlign: 'right' }}>Qty</th><th>Satuan</th>
                <th style={{ textAlign: 'right' }}>Harga (Rp)</th><th>Kaitkan ke stok</th><th>Konversi</th><th></th>
              </tr></thead>
              <tbody>
                {items.map((it, i) => {
                  const p = productById(it.productId)
                  const mismatch = p && p.unit !== it.unit
                  return (
                    <tr key={i}>
                      <td><input className="input" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder="Nama barang" style={{ minWidth: 130 }} /></td>
                      <td style={{ textAlign: 'right' }}><input className="input" type="number" min="0" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} style={{ width: 64, textAlign: 'right' }} /></td>
                      <td><input className="input" value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} style={{ width: 64 }} /></td>
                      <td style={{ textAlign: 'right' }}><input className="input" type="number" min="0" value={it.total} onChange={(e) => setItem(i, { total: e.target.value })} style={{ width: 96, textAlign: 'right' }} placeholder="0" /></td>
                      <td>
                        <select className="input" value={it.productId} onChange={(e) => { const np = productById(e.target.value); setItem(i, { productId: e.target.value, conv: np ? (np.unit === it.unit ? 1 : '') : 1 }) }} style={{ minWidth: 130 }}>
                          <option value="">(tidak ke stok)</option>
                          {products.map((pr) => <option key={pr.id} value={pr.id}>{pr.name} ({pr.unit})</option>)}
                        </select>
                      </td>
                      <td>
                        {p ? (mismatch ? (
                          <span style={{ whiteSpace: 'nowrap', fontSize: 13 }}>
                            1 {it.unit} =
                            <input className="input" type="number" min="0" value={it.conv} onChange={(e) => setItem(i, { conv: e.target.value })} style={{ width: 56, textAlign: 'right', display: 'inline-block', margin: '0 4px' }} placeholder="?" />
                            {p.unit}
                          </span>
                        ) : <span className="muted-sm">{stockQty(it)} {p.unit}</span>) : <span className="muted-sm">-</span>}
                      </td>
                      <td><button type="button" className="icon-btn danger" title="Hapus item" onClick={() => removeItem(i)}><Trash2 size={15} /></button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex between gap" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn btn-ghost" onClick={addItem}><Plus size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />Tambah item</button>
            <div style={{ fontSize: 16 }}>Total: <b>{rupiah(grandTotal)}</b></div>
          </div>

          {mismatchCount > 0 && (
            <div className="alert alert-err" style={{ marginTop: 12 }}>
              {mismatchCount} item dikaitkan ke stok tapi konversi satuannya belum diisi. Isi dulu (mis. 1 dus = 40 pcs) agar stok benar.
            </div>
          )}

          <button className="btn btn-primary btn-block btn-lg" style={{ marginTop: 16 }} disabled={busy}>
            {busy ? 'Menyimpan...' : `Simpan Transaksi · ${rupiah(grandTotal)}`}
          </button>
        </form>
      )}

      {/* Konfirmasi */}
      {confirming && (
        <Modal onClose={() => setConfirming(false)} labelledBy="strukConfirmModalTitle">
            <div className="modal-head"><h3 id="strukConfirmModalTitle">Konfirmasi</h3><button className="icon-btn" onClick={() => setConfirming(false)} aria-label="Tutup"><X size={16} /></button></div>
            <div className="modal-body">
              {mismatchCount > 0 ? (
                <div className="alert alert-err">Masih ada {mismatchCount} item yang konversi satuannya kosong. Tutup, lalu isi dulu.</div>
              ) : (
                <>
                  <p style={{ marginBottom: 10 }}>
                    Yakin simpan <b>{items.length} item</b> sebagai <b>{direction === 'in' ? 'Pemasukan' : 'Pengeluaran'}</b> sejumlah <b>{rupiah(grandTotal)}</b>?
                  </p>
                  {linkedCount > 0 && (
                    <>
                      <p className="muted-sm" style={{ marginBottom: 6 }}>Stok produk berikut akan {direction === 'out' ? 'bertambah' : 'berkurang'}:</p>
                      <ul style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {items.filter((it) => it.productId && stockQty(it) > 0).map((it, i) => {
                          const p = productById(it.productId)
                          const next = Number(p?.stock) + (direction === 'out' ? stockQty(it) : -stockQty(it))
                          return <li key={i}>{p?.name}: {Number(p?.stock)} → <b>{next < 0 ? 0 : next} {p?.unit}</b></li>
                        })}
                      </ul>
                    </>
                  )}
                </>
              )}
              <div className="modal-foot">
                <button className="btn btn-ghost btn-block" onClick={() => setConfirming(false)}>Periksa lagi</button>
                <button className="btn btn-primary btn-block" disabled={mismatchCount > 0 || busy} onClick={doSave}>Ya, simpan</button>
              </div>
            </div>
        </Modal>
      )}
    </div>
  )
}
