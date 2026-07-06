import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Plus, Trash2, Calculator } from 'lucide-react'
import {
  fetchProducts, updateProduct, fetchProfile,
  fetchIngredients, fetchBom, saveBom, fetchMacroSignals,
} from '../lib/api'
import { hppDraftAI } from '../lib/ai'
import { rupiah } from '../lib/format'
import {
  COMMODITIES, computeHpp, marginPct, priceForMargin, applyAdjustments, applyKursScenario,
} from '../lib/hpp'
import AIDisclaimer from '../components/AIDisclaimer'

const blankRow = () => ({
  ingredient_id: '', name: '', type: 'bahan', unit: 'gram',
  price_per_unit: '', commodity_key: '', import_exposure: 'rendah',
  qty_per_unit: '', is_ai_estimated: false, simPct: '',
})

export default function Hpp() {
  const [products, setProducts] = useState([])
  const [productId, setProductId] = useState('')
  const [rows, setRows] = useState([])
  const [note, setNote] = useState('')
  const [businessType, setBusinessType] = useState('')
  const [signalsByKey, setSignalsByKey] = useState({})
  const [runDate, setRunDate] = useState(null)
  const [kursPct, setKursPct] = useState('')
  const [targetMargin, setTargetMargin] = useState('')
  const [loadingBom, setLoadingBom] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    fetchProducts().then(setProducts).catch(() => {})
    fetchProfile().then((p) => setBusinessType(p?.business_name || '')).catch(() => {})
    fetchMacroSignals().then(({ runDate: rd, signals }) => {
      setRunDate(rd)
      const map = {}
      for (const s of signals) map[s.commodity_key] = s
      setSignalsByKey(map)
      const kurs = map['kurs']
      if (kurs && Number(kurs.est_pct_max) > 0) setKursPct(String(Number(kurs.est_pct_max)))
    }).catch(() => {})
  }, [])

  const product = products.find((p) => p.id === productId)

  // Muat komposisi tersimpan saat produk dipilih.
  useEffect(() => {
    if (!productId) { setRows([]); return }
    setLoadingBom(true); setMsg(''); setErr(''); setNote('')
    Promise.all([fetchBom(productId), fetchIngredients()])
      .then(([boms, ings]) => {
        const byId = new Map(ings.map((i) => [i.id, i]))
        const loaded = boms.map((b) => {
          const ing = byId.get(b.ingredient_id)
          return {
            ingredient_id: b.ingredient_id,
            name: ing?.name || '(bahan terhapus)',
            type: ing?.type || 'bahan',
            unit: ing?.unit || 'pcs',
            price_per_unit: String(ing?.price_per_unit ?? ''),
            commodity_key: ing?.commodity_key || '',
            import_exposure: ing?.import_exposure || 'rendah',
            qty_per_unit: String(b.qty_per_unit),
            is_ai_estimated: b.is_ai_estimated,
            simPct: '',
          }
        })
        setRows(loaded)
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoadingBom(false))
  }, [productId])

  const setRow = (i, patch) => setRows((a) => a.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const addRow = () => setRows((a) => [...a, blankRow()])
  const removeRow = (i) => setRows((a) => a.filter((_, idx) => idx !== i))

  // Draf AI (hybrid): AI mengusulkan komposisi, pengguna WAJIB meninjau.
  const makeDraft = async () => {
    if (!product) return
    setDrafting(true); setErr(''); setMsg('')
    try {
      const res = await hppDraftAI({
        productName: product.name,
        businessType: businessType || 'UMKM umum',
        unit: product.unit,
        sellPrice: product.price,
      })
      const comps = (res?.components || []).map((c) => ({
        ingredient_id: '',
        name: c.name, type: c.type, unit: c.unit,
        price_per_unit: String(c.est_price_per_unit),
        commodity_key: c.commodity_key || '',
        import_exposure: c.import_exposure || 'rendah',
        qty_per_unit: String(c.qty),
        is_ai_estimated: true,
        simPct: '',
      }))
      if (!comps.length) { setErr('AI tidak menghasilkan draf. Isi komposisi manual saja.'); return }
      setRows(comps)
      setNote(res?.note || '')
    } catch (e) { setErr(e.message) } finally { setDrafting(false) }
  }

  const validRows = rows.filter((r) => r.name.trim() && Number(r.qty_per_unit) > 0)
  const hppBase = useMemo(() => computeHpp(validRows.map((r) => ({ qty: r.qty_per_unit, price_per_unit: r.price_per_unit }))), [rows]) // eslint-disable-line

  // Skenario: tiap baris pakai input manual (Simulasi %) bila diisi; bila tidak,
  // pakai rentang sinyal makro untuk komoditas ter-mapping. Semuanya deterministik.
  const scenario = useMemo(() => {
    const rr = validRows.map((r) => ({
      qty: r.qty_per_unit, price_per_unit: r.price_per_unit,
      commodity_key: r.commodity_key, import_exposure: r.import_exposure, simPct: r.simPct,
    }))
    const pctMin = (r) => (r.simPct !== '' ? Number(r.simPct) : Number(signalsByKey[r.commodity_key]?.est_pct_min ?? 0))
    const pctMax = (r) => (r.simPct !== '' ? Number(r.simPct) : Number(signalsByKey[r.commodity_key]?.est_pct_max ?? 0))
    const lo = applyAdjustments(rr, pctMin)
    const hi = applyAdjustments(rr, pctMax)
    const kurs = kursPct !== '' ? applyKursScenario(rr, Number(kursPct)) : null
    return { min: Math.min(lo, hi), max: Math.max(lo, hi), kurs }
  }, [rows, signalsByKey, kursPct]) // eslint-disable-line

  const save = async () => {
    if (!productId || !validRows.length) { setErr('Isi minimal 1 komponen dengan nama & jumlah.'); return }
    setSaving(true); setErr(''); setMsg('')
    try {
      await saveBom(productId, validRows.map((r) => ({ ...r, is_ai_estimated: false }))) // dikonfirmasi user -> bukan estimasi lagi
      await updateProduct(productId, { cost_price: Math.round(hppBase) })
      setMsg(`Komposisi tersimpan. HPP "${product.name}" = ${rupiah(hppBase)} (tercatat juga sebagai harga modal produk).`)
      const boms = await fetchBom(productId)
      const ings = await fetchIngredients()
      const byId = new Map(ings.map((i) => [i.id, i]))
      setRows(boms.map((b) => {
        const ing = byId.get(b.ingredient_id)
        return {
          ingredient_id: b.ingredient_id, name: ing?.name || '', type: ing?.type || 'bahan',
          unit: ing?.unit || 'pcs', price_per_unit: String(ing?.price_per_unit ?? ''),
          commodity_key: ing?.commodity_key || '', import_exposure: ing?.import_exposure || 'rendah',
          qty_per_unit: String(b.qty_per_unit), is_ai_estimated: b.is_ai_estimated, simPct: '',
        }
      }))
    } catch (e) { setErr('Gagal menyimpan: ' + e.message) } finally { setSaving(false) }
  }

  const price = Number(product?.price) || 0
  const mNow = marginPct(price, hppBase)
  const mMin = marginPct(price, scenario.max) // HPP tertinggi -> margin terendah
  const mMax = marginPct(price, scenario.min)
  const tm = targetMargin === '' ? Math.max(0, Math.round(mNow)) : Number(targetMargin)
  const hasAiRows = rows.some((r) => r.is_ai_estimated)
  const hppChanged = Math.abs(scenario.max - hppBase) > 0.5 || Math.abs(scenario.min - hppBase) > 0.5

  return (
    <div style={{ maxWidth: 1040 }}>
      {msg && <div className="alert alert-ok" style={{ marginBottom: 16 }}>{msg}</div>}
      {err && <div className="alert alert-err" style={{ marginBottom: 16 }}>{err}</div>}

      {/* 1. Pilih produk */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h3 className="card-title">1. Pilih Produk</h3>
        <div className="card-sub">HPP dihitung dari komposisi bahan per 1 satuan jual produk</div>
        {products.length === 0 ? (
          <p className="muted-sm">Belum ada produk. Tambahkan dulu di menu <Link to="/app/stok" className="linklike">Stok Produk</Link>.</p>
        ) : (
          <div className="grid-2">
            <div className="field">
              <label>Produk</label>
              <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">-- pilih produk --</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
              </select>
            </div>
            {product && (
              <div className="field">
                <label>Harga jual saat ini</label>
                <div className="input" style={{ display: 'flex', alignItems: 'center', background: '#f8fafc' }}>
                  {price > 0 ? rupiah(price) : 'belum diisi (atur di Stok Produk)'}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Komposisi */}
      {product && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h3 className="card-title">2. Komposisi Biaya per 1 {product.unit}</h3>
          <div className="card-sub">Bahan, kemasan, energi, dan tenaga untuk membuat 1 {product.unit} {product.name}</div>

          {loadingBom ? <div className="spinner" style={{ margin: '16px auto' }} /> : (
            <>
              {rows.length === 0 && (
                <div className="alert alert-info" style={{ margin: '10px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <b>Belum ada komposisi.</b> Biarkan AI membuat draf awal (Anda koreksi setelahnya), atau isi manual.
                    <div className="field" style={{ marginTop: 8 }}>
                      <label>Jenis usaha (membantu akurasi draf)</label>
                      <input className="input" value={businessType} onChange={(e) => setBusinessType(e.target.value)} placeholder="cth: toko kue, warung makan, laundry" />
                    </div>
                  </div>
                  <div className="flex gap" style={{ flexDirection: 'column' }}>
                    <button className="btn btn-primary" onClick={makeDraft} disabled={drafting}>
                      <Sparkles size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                      {drafting ? 'Membuat draf...' : 'Buat Draf AI'}
                    </button>
                    <button className="btn btn-ghost" onClick={addRow}>Isi manual</button>
                  </div>
                </div>
              )}

              {hasAiRows && (
                <div className="alert alert-err" style={{ margin: '10px 0' }}>
                  Komposisi di bawah masih <b>perkiraan AI</b> — harga & takaran WAJIB Anda periksa dan koreksi sebelum disimpan.
                </div>
              )}
              {note && <p className="muted-sm" style={{ margin: '6px 0' }}>Catatan AI: {note}</p>}

              {rows.length > 0 && (
                <>
                  <div className="table-wrap" style={{ margin: '10px 0' }}>
                    <table className="tbl">
                      <thead><tr>
                        <th>Komponen</th><th>Tipe</th><th style={{ textAlign: 'right' }}>Jumlah</th><th>Satuan</th>
                        <th style={{ textAlign: 'right' }}>Harga/satuan (Rp)</th><th>Komoditas (Radar)</th><th>Impor</th>
                        <th style={{ textAlign: 'right' }}>Simulasi naik %</th><th></th>
                      </tr></thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className={r.is_ai_estimated ? 'row-ai' : ''}>
                            <td><input className="input" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder="cth: Tepung terigu" style={{ minWidth: 120 }} /></td>
                            <td>
                              <select className="input" value={r.type} onChange={(e) => setRow(i, { type: e.target.value })}>
                                {['bahan', 'kemasan', 'energi', 'tenaga', 'lainnya'].map((t) => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </td>
                            <td><input className="input" type="number" min="0" step="any" value={r.qty_per_unit} onChange={(e) => setRow(i, { qty_per_unit: e.target.value })} style={{ width: 76, textAlign: 'right' }} /></td>
                            <td><input className="input" value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })} style={{ width: 70 }} /></td>
                            <td><input className="input" type="number" min="0" step="any" value={r.price_per_unit} onChange={(e) => setRow(i, { price_per_unit: e.target.value })} style={{ width: 100, textAlign: 'right' }} /></td>
                            <td>
                              <select className="input" value={r.commodity_key} onChange={(e) => setRow(i, { commodity_key: e.target.value })} style={{ minWidth: 130 }}>
                                <option value="">(tidak terkait)</option>
                                {COMMODITIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                              </select>
                            </td>
                            <td>
                              <select className="input" value={r.import_exposure} onChange={(e) => setRow(i, { import_exposure: e.target.value })}>
                                {['rendah', 'sedang', 'tinggi'].map((x) => <option key={x} value={x}>{x}</option>)}
                              </select>
                            </td>
                            <td><input className="input" type="number" step="any" value={r.simPct} onChange={(e) => setRow(i, { simPct: e.target.value })} placeholder="auto" style={{ width: 76, textAlign: 'right' }} title="Kosongkan untuk memakai sinyal Radar otomatis" /></td>
                            <td><button type="button" className="icon-btn danger" onClick={() => removeRow(i)} title="Hapus"><Trash2 size={15} /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex between gap" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                    <div className="flex gap">
                      <button type="button" className="btn btn-ghost" onClick={addRow}><Plus size={15} style={{ verticalAlign: '-2px', marginRight: 5 }} />Tambah komponen</button>
                      <button type="button" className="btn btn-ghost" onClick={makeDraft} disabled={drafting}>
                        <Sparkles size={15} style={{ verticalAlign: '-2px', marginRight: 5 }} />{drafting ? 'Membuat...' : 'Draf ulang AI'}
                      </button>
                    </div>
                    <div style={{ fontSize: 16 }}>HPP: <b>{rupiah(hppBase)}</b> / {product.unit}</div>
                  </div>
                  <AIDisclaimer text="Draf & harga dari AI hanya perkiraan — koreksi sesuai harga belanja Anda. Harga bahan ikut diperbarui otomatis saat Anda scan struk belanja." />
                  <button className="btn btn-primary btn-block btn-lg" style={{ marginTop: 10 }} onClick={save} disabled={saving || !validRows.length}>
                    {saving ? 'Menyimpan...' : `Simpan Komposisi · HPP ${rupiah(hppBase)}`}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* 3. Simulasi */}
      {product && validRows.length > 0 && (
        <div className="card card-pad">
          <h3 className="card-title"><Calculator size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />3. Simulasi Efek Kenaikan Bahan</h3>
          <div className="card-sub">
            Otomatis memakai sinyal <Link to="/app/radar" className="linklike">Radar Harga</Link>{runDate ? ` (${runDate})` : ''} untuk komoditas yang ter-mapping; isi kolom "Simulasi naik %" untuk skenario manual per bahan.
          </div>

          <div className="scen-grid" style={{ marginTop: 12 }}>
            <div className="scen-card">
              <div className="muted-sm">HPP sekarang</div>
              <div className="scen-v">{rupiah(hppBase)}</div>
              <div className="muted-sm">{price > 0 ? `margin ${mNow.toFixed(0)}%` : 'harga jual belum diisi'}</div>
            </div>
            <div className="scen-card">
              <div className="muted-sm">HPP skenario (30 hari)</div>
              <div className="scen-v" style={{ color: hppChanged ? '#dc2626' : 'inherit' }}>
                {hppChanged ? `${rupiah(scenario.min)} – ${rupiah(scenario.max)}` : rupiah(hppBase)}
              </div>
              <div className="muted-sm">
                {hppChanged
                  ? `${(((scenario.min - hppBase) / (hppBase || 1)) * 100).toFixed(1)}% s.d. +${(((scenario.max - hppBase) / (hppBase || 1)) * 100).toFixed(1)}%`
                  : 'tidak ada sinyal kenaikan ter-mapping'}
              </div>
            </div>
            <div className="scen-card">
              <div className="muted-sm">Margin skenario</div>
              <div className="scen-v" style={{ color: price > 0 && mMin < mNow - 0.5 ? '#dc2626' : 'inherit' }}>
                {price > 0 ? `${mMin.toFixed(0)}% – ${mMax.toFixed(0)}%` : '-'}
              </div>
              <div className="muted-sm">pada harga jual tetap {price > 0 ? rupiah(price) : ''}</div>
            </div>
          </div>

          <div className="grid-2" style={{ marginTop: 14 }}>
            <div className="field">
              <label>Untuk mempertahankan margin (%)</label>
              <div className="flex gap" style={{ alignItems: 'center' }}>
                <input className="input" type="number" min="0" max="95" value={targetMargin === '' ? tm : targetMargin}
                  onChange={(e) => setTargetMargin(e.target.value)} style={{ width: 90 }} />
                <span style={{ fontSize: 15 }}>
                  harga jual perlu <b>{rupiah(priceForMargin(scenario.max, tm))}</b>
                  {price > 0 && priceForMargin(scenario.max, tm) > price && (
                    <span className="muted-sm"> (naik {rupiah(priceForMargin(scenario.max, tm) - price)})</span>
                  )}
                </span>
              </div>
            </div>
            <div className="field">
              <label>Jika rupiah melemah ... % (efek bahan impor)</label>
              <div className="flex gap" style={{ alignItems: 'center' }}>
                <input className="input" type="number" step="any" value={kursPct} onChange={(e) => setKursPct(e.target.value)} style={{ width: 90 }} placeholder="cth: 4" />
                {scenario.kurs && (
                  <span style={{ fontSize: 15 }}>
                    HPP menjadi <b>{rupiah(scenario.kurs.next)}</b>
                    <span className="muted-sm"> (+{(((scenario.kurs.next - hppBase) / (hppBase || 1)) * 100).toFixed(1)}%, rambatan 1-2 bulan)</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <p className="muted-sm" style={{ marginTop: 10 }}>
            Semua angka simulasi dihitung matematis dari komposisi Anda (bukan tebakan AI). Alternatif selain menaikkan harga: cari pemasok lain untuk bahan yang naik, atau sesuaikan takaran/porsi secara wajar.
          </p>
        </div>
      )}
    </div>
  )
}
