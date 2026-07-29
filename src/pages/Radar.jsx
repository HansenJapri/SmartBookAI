import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, TrendingDown, Minus, RefreshCw } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import {
  fetchMacroSignals, fetchExchangeRates,
  fetchMacroConfigLatest, fetchIngredients,
} from '../lib/api'
import { makroRefresh, hargaDaerah } from '../lib/ai'
import { rupiah, fmtDate } from '../lib/format'
import { signalKeyOf } from '../lib/sp2kp'
import { PROVINCES, PROVINCE_NAME } from '../lib/provinces'
import { useLang } from '../context/LangContext'
import AIDisclaimer from '../components/AIDisclaimer'

const DIR = {
  naik: { icon: TrendingUp, color: 'var(--red)', bg: 'var(--red-50)', label: 'NAIK' },
  turun: { icon: TrendingDown, color: 'var(--green)', bg: 'var(--green-50)', label: 'TURUN' },
  stabil: { icon: Minus, color: 'var(--accent-2)', bg: 'var(--indigo-50)', label: 'STABIL' },
}

// Kunci "hari data" — batas hari pukul 06.00 WIB, HARUS sama dengan Edge
// Function makro-harian: sebelum jam 6 pagi, data terbaru = tarikan kemarin.
const expectedRunKey = () => new Date(Date.now() + (7 - 6) * 3600 * 1000).toISOString().slice(0, 10)

// Blok perkiraan 30 hari (sinyal RAG). Sengaja minimal: hanya rentang perkiraan.
// Keyakinan, daftar sumber, dan driver/berita tidak ditampilkan di frontend
// (data itu tetap dipakai internal untuk menyusun sinyal).
function SignalBlock({ s }) {
  const { t } = useLang()
  const range = Number(s.est_pct_min) === 0 && Number(s.est_pct_max) === 0
    ? '±0%'
    : `${Number(s.est_pct_min) > 0 ? '+' : ''}${Number(s.est_pct_min)}% s.d. ${Number(s.est_pct_max) > 0 ? '+' : ''}${Number(s.est_pct_max)}%`
  return (
    <div className="sig-forecast">{t.radar.forecast30} {range}</div>
  )
}

export default function Radar() {
  const { t } = useLang()
  const r = t.radar
  const [signals, setSignals] = useState([])
  const [runDate, setRunDate] = useState(null)
  const [prices, setPrices] = useState([])       // harga bapok nasional SP2KP
  const [rates, setRates] = useState([])
  const [config, setConfig] = useState(null)
  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tried, setTried] = useState(false)
  const [onlyMine, setOnlyMine] = useState(false)
  const [err, setErr] = useState('')
  const [provId, setProvId] = useState(0)          // 0 = nasional
  const [provPrices, setProvPrices] = useState([]) // harga SP2KP provinsi terpilih
  const [provLoading, setProvLoading] = useState(false)
  const provReq = useRef(0) // penjaga urutan: hanya respons terakhir yang dipakai

  // Ganti provinsi: ambil harga SP2KP provinsi tsb (server meng-cache per
  // provinsi per hari). Bahan yang tak tercakup provinsi tetap memakai nasional.
  const changeProvince = async (id) => {
    const token = ++provReq.current
    setProvId(id)
    setProvPrices([])
    if (id === 0) return
    setProvLoading(true); setErr('')
    try {
      const res = await hargaDaerah(id)
      if (token !== provReq.current) return // pengguna sudah pindah provinsi lain
      setProvPrices(res?.prices || [])
      if (!(res?.prices || []).length) setErr(r.provNotReady.replace('{prov}', PROVINCE_NAME[id]))
    } catch (e) {
      if (token === provReq.current) setErr(e.message)
    } finally {
      if (token === provReq.current) setProvLoading(false)
    }
  }

  const load = async () => {
    const [sig, prc, rts, cfg, ing] = await Promise.allSettled([
      fetchMacroSignals(), hargaDaerah(0), fetchExchangeRates(90),
      fetchMacroConfigLatest(), fetchIngredients(),
    ])
    if (sig.status === 'fulfilled') setSignals(sig.value.signals)
    let rd = null
    if (prc.status === 'fulfilled') { setPrices(prc.value.prices || []); rd = prc.value.runDate }
    if (!rd && sig.status === 'fulfilled') rd = sig.value.runDate
    setRunDate(rd)
    if (rts.status === 'fulfilled') setRates(rts.value)
    if (cfg.status === 'fulfilled') setConfig(cfg.value)
    if (ing.status === 'fulfilled') setIngredients(ing.value)
    return rd
  }

  // Pipeline dijadwalkan tiap 06.00 WIB (pg_cron). Pemicu dari sini hanya
  // CADANGAN bila jadwal terlewat; hasil di-cache untuk semua pengguna.
  const refresh = async () => {
    setRefreshing(true); setErr('')
    try {
      await makroRefresh()
      await load()
    } catch (e) {
      setErr(r.errRefresh + e.message)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    (async () => {
      const rd = await load()
      setLoading(false)
      if (rd !== expectedRunKey() && !tried) {
        setTried(true)
        refresh()
      }
    })()
  }, []) // eslint-disable-line

  const relevantKeys = useMemo(
    () => new Set(ingredients.map((i) => i.commodity_key).filter(Boolean)),
    [ingredients],
  )
  const signalByKey = useMemo(
    () => Object.fromEntries((signals || []).map((s) => [s.commodity_key, s])),
    [signals],
  )

  // Baris harga efektif: saat provinsi dipilih, baris SP2KP provinsi
  // menggantikan baris nasional untuk komoditas yang tercakup; sisanya nasional.
  const effectivePrices = useMemo(() => {
    const provKeys = new Set(provPrices.map((p) => p.commodity_key))
    return provId !== 0 && provPrices.length
      ? [...provPrices, ...prices.filter((p) => !provKeys.has(p.commodity_key))]
      : prices
  }, [prices, provPrices, provId])

  // DAFTAR UTAMA = semua bapok SP2KP. Sinyal RAG (perkiraan) jadi overlay opsional.
  const bapokItems = useMemo(() => {
    let list = effectivePrices.map((p) => {
      const sigKey = signalKeyOf(p.variant_name)
      return { price: p, sigKey, signal: sigKey ? signalByKey[sigKey] : null }
    })
    if (onlyMine && relevantKeys.size > 0) {
      list = list.filter((it) => it.sigKey && relevantKeys.has(it.sigKey))
    }
    return list
  }, [effectivePrices, signalByKey, onlyMine, relevantKeys])

  // Sinyal komoditas NON-bapok (CPO/gandum global, LPG, BBM, dll) — tak punya
  // harga SP2KP; ditampilkan sebagai kartu sinyal-saja agar fitur perkiraan tetap ada.
  const otherSignals = useMemo(() => {
    const matched = new Set(bapokItems.map((i) => i.sigKey).filter(Boolean))
    if (onlyMine && relevantKeys.size > 0) return []
    return (signals || []).filter((s) => s.commodity_key !== 'kurs' && !matched.has(s.commodity_key))
  }, [signals, bapokItems, onlyMine, relevantKeys])

  const kurs = useMemo(() => {
    if (!rates.length) return null
    const last = rates[rates.length - 1]
    const t30 = new Date(Date.now() - 30 * 86400000)
    let past = rates[0]
    for (const r of rates) { if (new Date(r.rate_date) <= t30) past = r }
    const pct30 = Number(past.usd_idr) > 0 ? ((Number(last.usd_idr) - Number(past.usd_idr)) / Number(past.usd_idr)) * 100 : 0
    return { last, pct30, chart: rates.map((r) => ({ label: r.rate_date.slice(5), kurs: Math.round(Number(r.usd_idr)) })) }
  }, [rates])

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const provLabel = provId !== 0 ? (PROVINCE_NAME[provId] || 'provinsi') : 'nasional'

  return (
    <div style={{ maxWidth: 1040 }}>
      <div className="alert alert-info" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span>
          <b>{r.bannerTitle}</b> {r.bannerA} <b>{r.bannerSrc}</b>{r.bannerB} <b>{r.bannerC}</b>.
          {runDate ? ` ${r.bannerData} ${fmtDate(runDate)}.` : ` ${r.bannerNoData}`}
        </span>
        <button className="btn btn-ghost" onClick={refresh} disabled={refreshing}>
          <RefreshCw size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} className={refreshing ? 'spin' : ''} />
          {refreshing ? r.refreshing : r.refresh}
        </button>
      </div>
      {err && <div className="alert alert-err" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="two-col" style={{ marginBottom: 16 }}>
        {/* KURS */}
        <div className="card card-pad">
          <h3 className="card-title">{r.kursTitle}</h3>
          <div className="card-sub">{r.kursSub}</div>
          {!kurs ? <p className="muted-sm">{r.kursEmpty}</p> : (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 26, fontWeight: 700 }}>Rp {Math.round(Number(kurs.last.usd_idr)).toLocaleString('id-ID')}</span>
                <span style={{ color: kurs.pct30 > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>
                  {kurs.pct30 > 0 ? '+' : ''}{kurs.pct30.toFixed(1)}% {r.kurs30d} {kurs.pct30 > 0 ? r.kursWeaken : r.kursStrengthen}
                </span>
              </div>
              <div className="muted-sm">{r.kursNote.replace('{date}', fmtDate(kurs.last.rate_date))}</div>
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={kurs.chart} margin={{ left: -14, right: 6, top: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} minTickGap={30} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip formatter={(v) => 'Rp ' + Number(v).toLocaleString('id-ID')} contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }} />
                  <Area type="monotone" dataKey="kurs" stroke="#137be7" strokeWidth={2} fill="rgba(19, 123, 231, 0.12)" />
                </AreaChart>
              </ResponsiveContainer>
            </>
          )}
        </div>

        {/* INFLASI */}
        <div className="card card-pad">
          <h3 className="card-title">{r.inflTitle}</h3>
          <div className="card-sub">{r.inflSub}</div>
          {!config ? (
            <p className="muted-sm">{r.inflEmpty}</p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 6 }}>
                <div><div className="muted-sm">{r.inflGeneral}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{Number(config.inflation_yoy).toFixed(2)}%</div></div>
                <div><div className="muted-sm">{r.inflFood}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{config.inflation_food_yoy == null ? '-' : Number(config.inflation_food_yoy).toFixed(2) + '%'}</div></div>
                <div><div className="muted-sm">{r.inflPeriod}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{config.month}</div></div>
              </div>
              {config.note && <p className="muted-sm" style={{ marginTop: 8 }}>{config.note}</p>}
              <p className="muted-sm" style={{ marginTop: 8 }}>
                {r.inflHintA.replace('{x}', Number(config.inflation_yoy).toFixed(1))} <Link to="/app/hpp" className="linklike">{r.inflHintLink}</Link>.
              </p>
            </>
          )}
        </div>
      </div>

      {/* HARGA BAPOK SP2KP + SINYAL */}
      <div className="card card-pad">
        <div className="flex between gap" style={{ flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
          <div>
            <h3 className="card-title">{r.bapokTitle}</h3>
            <div className="card-sub">
              {r.bapokSubA} <b>SP2KP Kementerian Perdagangan</b> {r.bapokSubB}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <label className="muted-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {r.province}
              <select className="input" style={{ maxWidth: 210 }} value={provId}
                disabled={provLoading}
                onChange={(e) => changeProvince(Number(e.target.value))}>
                {PROVINCES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {provLoading && <span className="spinner" style={{ width: 16, height: 16 }} />}
            </label>
            {relevantKeys.size > 0 && (
              <label className="muted-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
                {r.onlyMine.replace('{n}', relevantKeys.size)}
              </label>
            )}
          </div>
        </div>
        <AIDisclaimer text={r.disclaimer} />

        {!bapokItems.length ? (
          <p className="muted-sm" style={{ marginTop: 12 }}>
            {prices.length ? r.noMatch : r.noPrice}
          </p>
        ) : (
          <div className="sig-grid" style={{ marginTop: 12 }}>
            {bapokItems.map(({ price: p, sigKey, signal: s }) => {
              const d = s ? (DIR[s.direction] || DIR.stabil) : null
              const Icon = d ? d.icon : null
              const delta = p.prev_price
                ? ((Number(p.price) - Number(p.prev_price)) / Number(p.prev_price)) * 100
                : null
              return (
                <div className="sig-card" key={p.commodity_key}>
                  <div className="flex between" style={{ alignItems: 'flex-start' }}>
                    <b>{p.variant_name}</b>
                    {d && (
                      <span className="sig-dir" style={{ color: d.color, background: d.bg }}>
                        <Icon size={13} /> {r.dir[s.direction] || r.dir.stabil}
                      </span>
                    )}
                  </div>

                  {/* HARGA TERKINI (SP2KP) + PERBANDINGAN VS HARGA SEBELUMNYA */}
                  <div style={{ margin: '6px 0' }}>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>
                      {rupiah(p.price)} <span className="muted-sm" style={{ fontWeight: 400 }}>/{String(p.unit).replace('Rp/', '')}</span>
                    </div>
                    <div className="muted-sm">
                      {Number(p.province_id) > 0 ? r.avgProv.replace('{prov}', PROVINCE_NAME[p.province_id] || r.provinceWord) : r.avgNational}
                      {p.price_date ? `, ${fmtDate(p.price_date)}` : ''}
                    </div>
                    {delta === null ? (
                      <div className="sig-delta sig-delta-flat">{r.noPrev}</div>
                    ) : Math.abs(delta) < 0.05 ? (
                      <div className="sig-delta sig-delta-flat"><Minus size={13} /> {r.stable}</div>
                    ) : (
                      <div className="sig-delta" style={{ color: delta > 0 ? 'var(--red)' : 'var(--green)' }}>
                        {delta > 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                        {delta > 0 ? r.up : r.down} {Math.abs(delta).toFixed(1)}% {r.vsPrev}
                      </div>
                    )}
                  </div>

                  {/* SINYAL 30 HARI (opsional) */}
                  {s
                    ? <SignalBlock s={s} />
                    : <div className="muted-sm" style={{ margin: '2px 0 0' }}>{r.noForecast}</div>}
                </div>
              )
            })}
          </div>
        )}

        {/* KOMODITAS LAIN (tanpa harga SP2KP) — sinyal perkiraan saja */}
        {otherSignals.length > 0 && (
          <>
            <h4 className="card-title" style={{ fontSize: 15, marginTop: 22 }}>{r.otherTitle}</h4>
            <div className="card-sub" style={{ marginBottom: 8 }}>{r.otherSub}</div>
            <div className="sig-grid">
              {otherSignals.map((s) => {
                const d = DIR[s.direction] || DIR.stabil
                const Icon = d.icon
                return (
                  <div className="sig-card" key={s.commodity_key}>
                    <div className="flex between" style={{ alignItems: 'flex-start' }}>
                      <b>{s.commodity_label}</b>
                      <span className="sig-dir" style={{ color: d.color, background: d.bg }}>
                        <Icon size={13} /> {r.dir[s.direction] || r.dir.stabil}
                      </span>
                    </div>
                    <SignalBlock s={s} />
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
