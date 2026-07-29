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
import { useLang } from '../context/LangContext'

const blankRow = () => ({
  ingredient_id: '', name: '', type: 'bahan', unit: 'gram',
  price_per_unit: '', commodity_key: '', import_exposure: 'rendah',
  qty_per_unit: '', is_ai_estimated: false, simPct: '',
})

export default function Hpp() {
  const { t } = useLang()
  const hp = t.hpp
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
            name: ing?.name || hp.deletedIngredient,
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
      if (!comps.length) { setErr(hp.errNoAiDraft); return }
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
    if (!productId || !validRows.length) { setErr(hp.errNoComponents); return }
    setSaving(true); setErr(''); setMsg('')
    try {
      await saveBom(productId, validRows.map((r) => ({ ...r, is_ai_estimated: false }))) // dikonfirmasi user -> bukan estimasi lagi
      await updateProduct(productId, { cost_price: Math.round(hppBase) })
      setMsg(hp.savedMsg.replace('{name}', product.name).replace('{hpp}', rupiah(hppBase)))
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
    } catch (e) { setErr(hp.saveFailed.replace('{msg}', e.message)) } finally { setSaving(false) }
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
        <h3 className="card-title">{hp.step1Title}</h3>
        <div className="card-sub">{hp.step1Sub}</div>
        {products.length === 0 ? (
          <p className="muted-sm">{hp.emptyProducts} <Link to="/app/stok" className="linklike">{hp.stockLink}</Link>.</p>
        ) : (
          <div className="grid-2">
            <div className="field">
              <label htmlFor="hpp-product">{hp.lProduct}</label>
              <select id="hpp-product" className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">{hp.pickProduct}</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
              </select>
            </div>
            {product && (
              <div className="field">
                <label>{hp.lCurrentPrice}</label>
                <div className="input" style={{ display: 'flex', alignItems: 'center', background: 'var(--bg)' }}>
                  {price > 0 ? rupiah(price) : hp.priceNotSet}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Komposisi */}
      {product && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h3 className="card-title">{hp.step2Title.replace('{unit}', product.unit)}</h3>
          <div className="card-sub">{hp.step2Sub.replace('{unit}', product.unit).replace('{name}', product.name)}</div>

          {loadingBom ? <div className="spinner" style={{ margin: '16px auto' }} /> : (
            <>
              {rows.length === 0 && (
                <div className="alert alert-info" style={{ margin: '10px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <b>{hp.emptyCompTitle}</b> {hp.emptyCompDesc}
                    <div className="field" style={{ marginTop: 8 }}>
                      <label htmlFor="hpp-business-type">{hp.lBusinessType}</label>
                      <input id="hpp-business-type" className="input" value={businessType} onChange={(e) => setBusinessType(e.target.value)} placeholder={hp.businessTypePh} />
                    </div>
                  </div>
                  <div className="flex gap" style={{ flexDirection: 'column' }}>
                    <button className="btn btn-primary" onClick={makeDraft} disabled={drafting}>
                      <Sparkles size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                      {drafting ? hp.drafting : hp.makeAiDraft}
                    </button>
                    <button className="btn btn-ghost" onClick={addRow}>{hp.fillManual}</button>
                  </div>
                </div>
              )}

              {hasAiRows && (
                <div className="alert alert-err" style={{ margin: '10px 0' }}>
                  {hp.aiRowsWarn}
                </div>
              )}
              {note && <p className="muted-sm" style={{ margin: '6px 0' }}>{hp.aiNoteLabel} {note}</p>}

              {rows.length > 0 && (
                <>
                  <div className="table-wrap" style={{ margin: '10px 0' }}>
                    <table className="tbl tbl-hpp">
                      <thead><tr>
                        <th style={{ minWidth: 150 }}>{hp.thComponent}</th>
                        <th style={{ minWidth: 120 }}>{hp.thCostType}</th>
                        <th style={{ textAlign: 'right', minWidth: 90 }}>{hp.thQty}</th>
                        <th style={{ minWidth: 80 }}>{hp.thUnit}</th>
                        <th style={{ textAlign: 'right', minWidth: 120 }}>{hp.thPricePerUnit}</th>
                        <th style={{ minWidth: 160 }}>{hp.thCommodity}</th>
                        <th style={{ minWidth: 140 }}>{hp.thImportDep}</th>
                        <th style={{ textAlign: 'right', minWidth: 110 }}>{hp.thSimPct}</th>
                        <th style={{ width: 40 }}></th>
                      </tr></thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className={r.is_ai_estimated ? 'row-ai' : ''}>
                            <td><input className="input" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder={hp.namePh} style={{ minWidth: 140 }} /></td>
                            <td>
                              <select className="input" value={r.type} onChange={(e) => setRow(i, { type: e.target.value })} style={{ minWidth: 112 }}>
                                <option value="bahan">{hp.typeBahan}</option>
                                <option value="kemasan">{hp.typeKemasan}</option>
                                <option value="energi">{hp.typeEnergi}</option>
                                <option value="tenaga">{hp.typeTenaga}</option>
                                <option value="lainnya">{hp.typeLainnya}</option>
                              </select>
                            </td>
                            <td><input className="input" type="number" min="0" step="any" value={r.qty_per_unit} onChange={(e) => setRow(i, { qty_per_unit: e.target.value })} style={{ width: 84, textAlign: 'right' }} /></td>
                            <td><input className="input" value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })} style={{ width: 74 }} /></td>
                            <td><input className="input" type="number" min="0" step="any" value={r.price_per_unit} onChange={(e) => setRow(i, { price_per_unit: e.target.value })} style={{ width: 112, textAlign: 'right' }} /></td>
                            <td>
                              <select className="input" value={r.commodity_key} onChange={(e) => setRow(i, { commodity_key: e.target.value })} style={{ minWidth: 150 }}>
                                <option value="">{hp.notRelated}</option>
                                {COMMODITIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                              </select>
                            </td>
                            <td>
                              <select className="input" value={r.import_exposure} onChange={(e) => setRow(i, { import_exposure: e.target.value })} style={{ minWidth: 128 }}>
                                <option value="rendah">{hp.expLow}</option>
                                <option value="sedang">{hp.expMed}</option>
                                <option value="tinggi">{hp.expHigh}</option>
                              </select>
                            </td>
                            <td><input className="input" type="number" step="any" value={r.simPct} onChange={(e) => setRow(i, { simPct: e.target.value })} placeholder="auto" style={{ width: 92, textAlign: 'right' }} title={hp.simPctTitle} /></td>
                            <td><button type="button" className="icon-btn danger" onClick={() => removeRow(i)} title={hp.delTitle}><Trash2 size={15} /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted-sm" style={{ marginTop: -4 }}>{hp.scrollHint}</p>
                  <div className="flex between gap" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                    <div className="flex gap">
                      <button type="button" className="btn btn-ghost" onClick={addRow}><Plus size={15} style={{ verticalAlign: '-2px', marginRight: 5 }} />{hp.addComponent}</button>
                      <button type="button" className="btn btn-ghost" onClick={makeDraft} disabled={drafting}>
                        <Sparkles size={15} style={{ verticalAlign: '-2px', marginRight: 5 }} />{drafting ? hp.redrafting : hp.redraftAI}
                      </button>
                    </div>
                    <div style={{ fontSize: 16 }}>{hp.hppLabel} <b>{rupiah(hppBase)}</b> / {product.unit}</div>
                  </div>
                  <AIDisclaimer text={hp.aiDisclaimer} />
                  <button className="btn btn-primary btn-block btn-lg" style={{ marginTop: 10 }} onClick={save} disabled={saving || !validRows.length}>
                    {saving ? hp.saving : `${hp.saveComposition} ${rupiah(hppBase)}`}
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
          <h3 className="card-title"><Calculator size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />{hp.step3Title}</h3>
          <div className="card-sub">
            {hp.step3SubPre} <Link to="/app/radar" className="linklike">{hp.radarLink}</Link>{runDate ? ` (${runDate})` : ''} {hp.step3SubPost}
          </div>

          <div className="scen-grid" style={{ marginTop: 12 }}>
            <div className="scen-card">
              <div className="muted-sm">{hp.hppNow}</div>
              <div className="scen-v">{rupiah(hppBase)}</div>
              <div className="muted-sm">{price > 0 ? hp.marginWord.replace('{v}', mNow.toFixed(0)) : hp.priceNotSetShort}</div>
            </div>
            <div className="scen-card">
              <div className="muted-sm">{hp.hppScenario}</div>
              <div className="scen-v" style={{ color: hppChanged ? 'var(--red)' : 'inherit' }}>
                {hppChanged ? `${rupiah(scenario.min)} – ${rupiah(scenario.max)}` : rupiah(hppBase)}
              </div>
              <div className="muted-sm">
                {hppChanged
                  ? `${(((scenario.min - hppBase) / (hppBase || 1)) * 100).toFixed(1)}% s.d. +${(((scenario.max - hppBase) / (hppBase || 1)) * 100).toFixed(1)}%`
                  : hp.noMappedSignal}
              </div>
            </div>
            <div className="scen-card">
              <div className="muted-sm">{hp.marginScenario}</div>
              <div className="scen-v" style={{ color: price > 0 && mMin < mNow - 0.5 ? 'var(--red)' : 'inherit' }}>
                {price > 0 ? `${mMin.toFixed(0)}% – ${mMax.toFixed(0)}%` : '-'}
              </div>
              <div className="muted-sm">{hp.atFixedPrice.replace('{price}', price > 0 ? rupiah(price) : '')}</div>
            </div>
          </div>

          <div className="grid-2" style={{ marginTop: 14 }}>
            <div className="field">
              <label htmlFor="hpp-target-margin">{hp.lMaintainMargin}</label>
              <div className="flex gap" style={{ alignItems: 'center' }}>
                <input id="hpp-target-margin" className="input" type="number" min="0" max="95" value={targetMargin === '' ? tm : targetMargin}
                  onChange={(e) => setTargetMargin(e.target.value)} style={{ width: 90 }} />
                <span style={{ fontSize: 15 }}>
                  {hp.priceNeeds} <b>{rupiah(priceForMargin(scenario.max, tm))}</b>
                  {price > 0 && priceForMargin(scenario.max, tm) > price && (
                    <span className="muted-sm"> {hp.priceUp.replace('{v}', rupiah(priceForMargin(scenario.max, tm) - price))}</span>
                  )}
                </span>
              </div>
            </div>
            <div className="field">
              <label htmlFor="hpp-kurs-pct">{hp.lKursPct}</label>
              <div className="flex gap" style={{ alignItems: 'center' }}>
                <input id="hpp-kurs-pct" className="input" type="number" step="any" value={kursPct} onChange={(e) => setKursPct(e.target.value)} style={{ width: 90 }} placeholder={hp.kursPh} />
                {scenario.kurs && (
                  <span style={{ fontSize: 15 }}>
                    {hp.hppBecomes} <b>{rupiah(scenario.kurs.next)}</b>
                    <span className="muted-sm"> {hp.kursSpread.replace('{v}', (((scenario.kurs.next - hppBase) / (hppBase || 1)) * 100).toFixed(1))}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <p className="muted-sm" style={{ marginTop: 10 }}>
            {hp.footerHint}
          </p>
        </div>
      )}
    </div>
  )
}
