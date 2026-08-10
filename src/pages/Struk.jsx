import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, FolderOpen, ScanLine, FileText, Sparkles, Plus, Trash2, X } from 'lucide-react'
import { useCatalog } from '../context/CatalogContext'
import { uploadReceipt, addTransactionWithStock, fetchProducts } from '../lib/api'
import { readReceipt } from '../lib/ai'
import { compressImage } from '../lib/imageCompress'
import { toDateInput, rupiah } from '../lib/format'
import AIDisclaimer from '../components/AIDisclaimer'
import Modal from '../components/Modal'
import { useLang } from '../context/LangContext'
import { BATAS_DATETIME, bersihkanTanggal } from '../lib/dateInput'

const ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.pdf,image/*,application/pdf'
const blankItem = () => ({ name: '', qty: 1, unit: 'pcs', total: '', productId: '', conv: 1 })

export default function Struk() {
  const { t } = useLang()
  const sk = t.struk
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
  // Nama toko hasil baca AI, terpisah dari keterangan supaya bisa ditautkan ke
  // Daftar Pemasok — dan tetap bisa dikoreksi pengguna sebelum disimpan.
  const [namaToko, setNamaToko] = useState('')
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
    if (!okType) { setErr(sk.errFormat); return }
    if (f.size > 10 * 1024 * 1024) { setErr(sk.errMaxSize); return }
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
    if (!file) { setErr(sk.errUploadFirst); return }
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
      setKeterangan(res.merchant ? sk.shoppingAt.replace('{merchant}', res.merchant) : '')
      setNamaToko(res.merchant || '')
      setDirection('out')
      setAiMeta({ total: Number(res.total) || 0, legibility: res.legibility || 'cetak_jelas' })
      if (res.date) { try { setOccurredAt(toDateInput(res.date + 'T12:00')) } catch { /* abaikan */ } }
      if (!mapped.length) setErr(sk.errNoItemsAI)
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
    if (!items.length) return setErr(sk.errNoItems)
    if (grandTotal <= 0) return setErr(sk.errTotalZero)
    if (!category) return setErr(sk.errPickCategory)
    setConfirming(true)
  }

  const doSave = async () => {
    setConfirming(false); setBusy(true); setErr('')
    try {
      let receipt_url = null
      if (file) { try { receipt_url = await uploadReceipt(file) } catch { /* lampiran opsional */ } }
      const desc = keterangan.trim()
        || (items.length ? sk.shoppingDesc.replace('{items}', items.slice(0, 3).map((it) => `${it.qty} ${it.unit} ${it.name}`).join(', ')) + (items.length > 3 ? sk.shoppingMore : '') : sk.shoppingFallback)

      // Baris struk yang sudah ditautkan ke produk. Dikirim sebagai `lines`
      // supaya transaksi dan penyesuaian stok tersimpan dalam SATU transaksi
      // database.
      //
      // Versi sebelumnya menyimpan transaksinya dulu, lalu memperbarui stok satu
      // per satu lewat updateProduct(). Bila salah satu pembaruan gagal di
      // tengah jalan, transaksinya SUDAH tersimpan tapi layar menampilkan pesan
      // galat — pengguna wajar menyimpan ulang, dan struk yang sama tercatat
      // dua kali dengan stok yang tetap salah. Jalur atomik menutup itu:
      // semuanya berhasil, atau tidak ada yang tersimpan sama sekali.
      const lines = items
        .filter((it) => it.productId && stockQty(it) > 0)
        .map((it) => ({ productId: it.productId, qty: stockQty(it) }))
      const single = lines.length === 1 ? lines[0] : null

      const { changes } = await addTransactionWithStock(
        {
          description: desc.slice(0, 200),
          amount: grandTotal,
          direction, category,
          channel: 'struk',
          occurred_at: new Date(occurredAt).toISOString(),
          receipt_url,
          source_ref: file ? file.name : null,
          product_id: single ? single.productId : null,
          qty: single ? single.qty : null,
          // Struk belanja = pembelian dari pemasok. Namanya (bila terbaca AI)
          // ditautkan ke Daftar Pemasok oleh tautkanPihakTransaksi().
          supplier_name: direction === 'out' ? (namaToko.trim() || null) : null,
        },
        lines,
      )
      setDoneMsg(
        sk.savedMsg.replace('{n}', items.length)
        + (changes?.length ? sk.savedStockMsg.replace('{n}', changes.length) : '.'),
      )
      setFile(null); if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null)
      setItems([]); setKeterangan(''); setNamaToko(''); setAiMeta(null)
      fetchProducts().then(setProducts).catch(() => {})
    } catch (e) {
      setErr(e.message?.toLowerCase().includes('bucket')
        ? sk.storageNotReady
        : sk.saveFailed.replace('{msg}', e.message))
    } finally { setBusy(false) }
  }

  return (
    <div style={{ maxWidth: 1040 }}>
      {doneMsg && (
        <div className="alert alert-ok" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span>{doneMsg}</span>
          <button className="btn btn-primary" onClick={() => nav('/app/transaksi')}>{sk.viewTransactions}</button>
        </div>
      )}
      {err && <div className="alert alert-err">{err}</div>}

      {/* 1. Unggah & baca struk */}
      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <h3 className="card-title">{sk.step1Title}</h3>
        <div className="card-sub">{sk.step1Sub}</div>
        <div className="grid-2">
          <div>
            <div className="drop" onClick={() => fileRef.current.click()} onDragOver={(e) => e.preventDefault()} onDrop={onDrop} style={{ minHeight: 180 }}>
              {previewUrl ? (
                <img src={previewUrl} alt="pratinjau struk" style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 10 }} />
              ) : file ? (
                <><div className="di"><FileText size={30} /></div><h3>{file.name}</h3><p>{sk.dropReady}</p></>
              ) : (
                <><div className="di"><ScanLine size={30} /></div><h3>{sk.dropTitle}</h3><p>{sk.dropDesc}</p></>
              )}
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pickFile(e.target.files[0])} />
            <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => pickFile(e.target.files[0])} />
            <div className="flex gap mt" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ghost" onClick={() => cameraRef.current.click()}><Camera size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />{sk.takePhoto}</button>
              <button type="button" className="btn btn-ghost" onClick={() => fileRef.current.click()}><FolderOpen size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />{sk.pickFile}</button>
            </div>
          </div>
          <div className="flex" style={{ flexDirection: 'column', justifyContent: 'center', gap: 12 }}>
            <button type="button" className="btn btn-primary btn-lg" onClick={runAI} disabled={aiBusy || !file} style={{ justifyContent: 'center' }}>
              <Sparkles size={18} style={{ verticalAlign: '-4px', marginRight: 8 }} />
              {aiBusy ? sk.readingAI : sk.readWithAI}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { if (!items.length) setItems([blankItem()]) }} style={{ justifyContent: 'center' }}>
              {sk.orManual}
            </button>
            <p className="muted-sm" style={{ margin: 0 }}>{sk.unitHint}</p>
          </div>
        </div>
      </div>

      {/* 2. Tinjau item & simpan */}
      {items.length > 0 && (
        <form className="card card-pad" onSubmit={submit}>
          <h3 className="card-title">{sk.step2Title}</h3>
          <div className="card-sub">{sk.step2Sub}</div>

          {aiMeta?.legibility === 'tulisan_tangan' && (
            <div className="alert alert-err" style={{ margin: '10px 0 0' }}>
              {sk.handwrittenWarn}
            </div>
          )}
          {aiMeta?.legibility === 'buram' && (
            <div className="alert alert-err" style={{ margin: '10px 0 0' }}>
              {sk.blurryWarn}
            </div>
          )}
          {aiTotalMismatch && (
            <div className="alert alert-err" style={{ margin: '10px 0 0' }}>
              {sk.totalMismatchWarn.replace('{sum}', rupiah(grandTotal)).replace('{total}', rupiah(aiMeta.total))}
            </div>
          )}
          {aiMeta && <AIDisclaimer text={sk.aiDisclaimer} />}

          <div className="grid-2" style={{ marginBottom: 6, marginTop: 10 }}>
            <div className="field">
              <label id="struk-direction-label">{sk.lSaveAs}</label>
              <div className="seg" role="group" aria-labelledby="struk-direction-label">
                <button type="button" className={direction === 'in' ? 'on-in' : ''} aria-pressed={direction === 'in'} onClick={() => setDirection('in')}>{sk.dirIn}</button>
                <button type="button" className={direction === 'out' ? 'on-out' : ''} aria-pressed={direction === 'out'} onClick={() => setDirection('out')}>{sk.dirOut}</button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="struk-category">{sk.lCategory}</label>
              <select id="struk-category" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {cats.length === 0 && <option value="">{sk.noCategoryOpt}</option>}
                {cats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="struk-occurred-at">{sk.lDateTime}</label>
              <input id="struk-occurred-at" className="input" type="datetime-local" {...BATAS_DATETIME} value={occurredAt} onChange={(e) => setOccurredAt(bersihkanTanggal(e.target.value))} />
            </div>
            <div className="field">
              <label htmlFor="struk-note">{sk.lNote}</label>
              <input id="struk-note" className="input" value={keterangan} onChange={(e) => setKeterangan(e.target.value)} placeholder={sk.notePh} />
            </div>
            <div className="field">
              {/* Nama toko dibaca AI dan tetap bisa dikoreksi sebelum disimpan —
                  hasilnya jadi baris di Daftar Pemasok, jadi salah ketik di sini
                  akan membuat pemasok kembar. */}
              <label htmlFor="struk-merchant">{sk.lMerchant}</label>
              <input id="struk-merchant" className="input" value={namaToko}
                onChange={(e) => setNamaToko(e.target.value)} placeholder={sk.merchantPh} />
            </div>
          </div>

          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table className="tbl">
              <thead><tr>
                <th>{sk.thItem}</th><th style={{ textAlign: 'right' }}>{sk.thQty}</th><th>{sk.thUnit}</th>
                <th style={{ textAlign: 'right' }}>{sk.thPrice}</th><th>{sk.thLinkStock}</th><th>{sk.thConversion}</th><th></th>
              </tr></thead>
              <tbody>
                {items.map((it, i) => {
                  const p = productById(it.productId)
                  const mismatch = p && p.unit !== it.unit
                  return (
                    <tr key={i}>
                      <td><input className="input" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder={sk.namePh} style={{ minWidth: 130 }} /></td>
                      <td style={{ textAlign: 'right' }}><input className="input" type="number" min="0" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} style={{ width: 64, textAlign: 'right' }} /></td>
                      <td><input className="input" value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} style={{ width: 64 }} /></td>
                      <td style={{ textAlign: 'right' }}><input className="input" type="number" min="0" value={it.total} onChange={(e) => setItem(i, { total: e.target.value })} style={{ width: 96, textAlign: 'right' }} placeholder="0" /></td>
                      <td>
                        <select className="input" value={it.productId} onChange={(e) => { const np = productById(e.target.value); setItem(i, { productId: e.target.value, conv: np ? (np.unit === it.unit ? 1 : '') : 1 }) }} style={{ minWidth: 130 }}>
                          <option value="">{sk.notLinked}</option>
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
                      <td><button type="button" className="icon-btn danger" title={sk.delItemTitle} onClick={() => removeItem(i)}><Trash2 size={15} /></button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex between gap" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn btn-ghost" onClick={addItem}><Plus size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />{sk.addItem}</button>
            <div style={{ fontSize: 16 }}>{sk.total} <b>{rupiah(grandTotal)}</b></div>
          </div>

          {mismatchCount > 0 && (
            <div className="alert alert-err" style={{ marginTop: 12 }}>
              {sk.mismatchWarn.replace('{n}', mismatchCount)}
            </div>
          )}

          <button className="btn btn-primary btn-block btn-lg" style={{ marginTop: 16 }} disabled={busy}>
            {busy ? sk.saving : `${sk.saveTransaction} ${rupiah(grandTotal)}`}
          </button>
        </form>
      )}

      {/* Konfirmasi */}
      {confirming && (
        <Modal onClose={() => setConfirming(false)} labelledBy="strukConfirmModalTitle">
            <div className="modal-head"><h3 id="strukConfirmModalTitle">{sk.confirmTitle}</h3><button className="icon-btn" onClick={() => setConfirming(false)} aria-label={sk.close}><X size={16} /></button></div>
            <div className="modal-body">
              {mismatchCount > 0 ? (
                <div className="alert alert-err">{sk.confirmMismatch.replace('{n}', mismatchCount)}</div>
              ) : (
                <>
                  <p style={{ marginBottom: 10 }}>
                    {sk.confirmSave.replace('{n}', items.length).replace('{dir}', direction === 'in' ? sk.dirIn.split(' (')[0] : sk.dirOut.split(' (')[0]).replace('{total}', rupiah(grandTotal))}
                  </p>
                  {linkedCount > 0 && (
                    <>
                      <p className="muted-sm" style={{ marginBottom: 6 }}>{sk.confirmStockNote.replace('{change}', direction === 'out' ? sk.stockUp : sk.stockDown)}</p>
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
                <button className="btn btn-ghost btn-block" onClick={() => setConfirming(false)}>{sk.recheck}</button>
                <button className="btn btn-primary btn-block" disabled={mismatchCount > 0 || busy} onClick={doSave}>{sk.yesSave}</button>
              </div>
            </div>
        </Modal>
      )}
    </div>
  )
}
