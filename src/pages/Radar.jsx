import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, TrendingDown, Minus, RefreshCw, ExternalLink, BadgeCheck } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import {
  fetchMacroSignals, fetchCommodityPrices, fetchExchangeRates,
  fetchMacroConfigLatest, fetchIngredients,
} from '../lib/api'
import { makroRefresh } from '../lib/ai'
import { rupiah, fmtDate } from '../lib/format'
import { COMMODITIES } from '../lib/hpp'
import AIDisclaimer from '../components/AIDisclaimer'

const DIR = {
  naik: { icon: TrendingUp, color: 'var(--red)', bg: 'var(--red-50)', label: 'NAIK' },
  turun: { icon: TrendingDown, color: 'var(--green)', bg: 'var(--green-50)', label: 'TURUN' },
  stabil: { icon: Minus, color: 'var(--accent-2)', bg: 'var(--indigo-50)', label: 'STABIL' },
}
const CONF = { rendah: 'var(--muted)', sedang: 'var(--warn-ink)', tinggi: 'var(--green)' }

// Urutan tampil mengikuti daftar komoditas standar; kurs paling akhir.
const ORDER = Object.fromEntries([...COMMODITIES.map((c, i) => [c.key, i]), ['kurs', 999]])

// Kunci "hari data" — batas hari pukul 06.00 WIB, HARUS sama dengan Edge
// Function makro-harian: sebelum jam 6 pagi, data terbaru = tarikan kemarin.
const expectedRunKey = () => new Date(Date.now() + (7 - 6) * 3600 * 1000).toISOString().slice(0, 10)

export default function Radar() {
  const [signals, setSignals] = useState([])
  const [runDate, setRunDate] = useState(null)
  const [prices, setPrices] = useState([])
  const [rates, setRates] = useState([])
  const [config, setConfig] = useState(null)
  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tried, setTried] = useState(false)
  const [onlyMine, setOnlyMine] = useState(false)
  const [err, setErr] = useState('')

  const load = async () => {
    const [sig, prc, rts, cfg, ing] = await Promise.allSettled([
      fetchMacroSignals(), fetchCommodityPrices(), fetchExchangeRates(90),
      fetchMacroConfigLatest(), fetchIngredients(),
    ])
    if (sig.status === 'fulfilled') { setSignals(sig.value.signals); setRunDate(sig.value.runDate) }
    if (prc.status === 'fulfilled') setPrices(prc.value.prices)
    if (rts.status === 'fulfilled') setRates(rts.value)
    if (cfg.status === 'fulfilled') setConfig(cfg.value)
    if (ing.status === 'fulfilled') setIngredients(ing.value)
    return sig.status === 'fulfilled' ? sig.value.runDate : null
  }

  // Pipeline dijadwalkan tiap 06.00 WIB (pg_cron). Pemicu dari sini hanya
  // CADANGAN bila jadwal terlewat; hasil di-cache untuk semua pengguna.
  const refresh = async () => {
    setRefreshing(true); setErr('')
    try {
      await makroRefresh()
      await load()
    } catch (e) {
      setErr('Gagal memperbarui data makro: ' + e.message)
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
  const shown = useMemo(() => {
    const list = onlyMine && relevantKeys.size > 0
      ? signals.filter((s) => relevantKeys.has(s.commodity_key) || s.commodity_key === 'kurs')
      : signals
    return [...list].sort((a, b) => (ORDER[a.commodity_key] ?? 500) - (ORDER[b.commodity_key] ?? 500))
  }, [signals, onlyMine, relevantKeys])

  // Harga resmi per kelompok: baris is_group = angka utama; sisanya varian.
  const pricesByKey = useMemo(() => {
    const map = {}
    for (const p of prices) {
      if (!map[p.commodity_key]) map[p.commodity_key] = { group: null, variants: [] }
      if (p.is_group) map[p.commodity_key].group = p
      else map[p.commodity_key].variants.push(p)
    }
    return map
  }, [prices])

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

  return (
    <div style={{ maxWidth: 1040 }}>
      <div className="alert alert-info" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span>
          <b>Radar Harga Bahan.</b> Harga dari sumber resmi &amp; media tepercaya, diperbarui otomatis <b>setiap pagi pukul 06.00 WIB</b>.
          {runDate ? ` Data: ${fmtDate(runDate)}.` : ' Belum ada data.'}
        </span>
        <button className="btn btn-ghost" onClick={refresh} disabled={refreshing}>
          <RefreshCw size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} className={refreshing ? 'spin' : ''} />
          {refreshing ? 'Menarik data (±30-60 dtk)...' : 'Perbarui'}
        </button>
      </div>
      {err && <div className="alert alert-err" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="two-col" style={{ marginBottom: 16 }}>
        {/* KURS */}
        <div className="card card-pad">
          <h3 className="card-title">Kurs USD/IDR</h3>
          <div className="card-sub">Pelemahan rupiah menaikkan biaya bahan impor (terigu, kedelai, susu, dll)</div>
          {!kurs ? <p className="muted-sm">Belum ada data kurs. Tekan Perbarui.</p> : (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 26, fontWeight: 700 }}>Rp {Math.round(Number(kurs.last.usd_idr)).toLocaleString('id-ID')}</span>
                <span style={{ color: kurs.pct30 > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>
                  {kurs.pct30 > 0 ? '+' : ''}{kurs.pct30.toFixed(1)}% / 30 hari {kurs.pct30 > 0 ? '(rupiah melemah)' : '(rupiah menguat)'}
                </span>
              </div>
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={kurs.chart} margin={{ left: -14, right: 6, top: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} minTickGap={30} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip formatter={(v) => 'Rp ' + Number(v).toLocaleString('id-ID')} contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }} />
                  <Area type="monotone" dataKey="kurs" stroke="#137be7" strokeWidth={2} fill="rgba(19, 123, 231, 0.12)" />
                </AreaChart>
              </ResponsiveContainer>
              <div className="sig-sources" style={{ marginTop: 4 }}>
                <a href="https://open.er-api.com/v6/latest/USD" target="_blank" rel="noreferrer noopener">
                  <ExternalLink size={11} /> Sumber: kurs pasar (ER-API, terbuka)
                </a>
              </div>
            </>
          )}
        </div>

        {/* INFLASI */}
        <div className="card card-pad">
          <h3 className="card-title">Inflasi (BPS)</h3>
          <div className="card-sub">Diisi manual tiap bulan dari rilis resmi BPS — stabil & akurat</div>
          {!config ? (
            <p className="muted-sm">Data inflasi bulan ini belum diisi admin. Setelah diisi, kenaikan biaya Anda akan dibandingkan dengan inflasi pangan nasional di sini.</p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 6 }}>
                <div><div className="muted-sm">Inflasi umum (YoY)</div><div style={{ fontSize: 24, fontWeight: 700 }}>{Number(config.inflation_yoy).toFixed(2)}%</div></div>
                <div><div className="muted-sm">Inflasi pangan (YoY)</div><div style={{ fontSize: 24, fontWeight: 700 }}>{config.inflation_food_yoy == null ? '-' : Number(config.inflation_food_yoy).toFixed(2) + '%'}</div></div>
                <div><div className="muted-sm">Periode</div><div style={{ fontSize: 24, fontWeight: 700 }}>{config.month}</div></div>
              </div>
              {config.note && <p className="muted-sm" style={{ marginTop: 8 }}>{config.note}</p>}
              <p className="muted-sm" style={{ marginTop: 8 }}>
                Arti praktis: bila laba Anda naik lebih kecil dari {Number(config.inflation_yoy).toFixed(1)}%, daya beli laba Anda sebenarnya turun. Cek juga menu <Link to="/app/hpp" className="linklike">Simulasi HPP</Link>.
              </p>
            </>
          )}
        </div>
      </div>

      {/* HARGA & SINYAL PER KOMODITAS */}
      <div className="card card-pad">
        <div className="flex between gap" style={{ flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
          <div>
            <h3 className="card-title">Harga Bahan Terkini & Perkiraan 30 Hari</h3>
            <div className="card-sub">
              Harga: sumber resmi (PIHPS Bank Indonesia) &amp; harga terpantau media tepercaya · Arah: berita sepekan terakhir
            </div>
          </div>
          {relevantKeys.size > 0 && (
            <label className="muted-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
              Hanya bahan usaha saya ({relevantKeys.size})
            </label>
          )}
        </div>
        <AIDisclaimer text="Sinyal arah dibuat AI dari berita — bisa keliru. Harga PIHPS adalah rata-rata nasional; harga di pasar Anda bisa berbeda." />

        {!shown.length ? (
          <p className="muted-sm" style={{ marginTop: 12 }}>
            {signals.length ? 'Tidak ada sinyal untuk bahan Anda. Matikan filter untuk melihat semua komoditas.' : 'Belum ada data. Tekan tombol Perbarui di atas.'}
          </p>
        ) : (
          <div className="sig-grid" style={{ marginTop: 12 }}>
            {shown.map((s) => {
              const d = DIR[s.direction] || DIR.stabil
              const Icon = d.icon
              const mine = relevantKeys.has(s.commodity_key)
              const pr = pricesByKey[s.commodity_key]
              const headline = pr?.group || pr?.variants?.[0] || null
              const delta = headline?.prev_price
                ? ((Number(headline.price) - Number(headline.prev_price)) / Number(headline.prev_price)) * 100
                : null
              const range = Number(s.est_pct_min) === 0 && Number(s.est_pct_max) === 0
                ? '±0%'
                : `${Number(s.est_pct_min) > 0 ? '+' : ''}${Number(s.est_pct_min)}% s.d. ${Number(s.est_pct_max) > 0 ? '+' : ''}${Number(s.est_pct_max)}%`
              const sources = Array.isArray(s.sources) ? s.sources.slice(0, 2) : []
              const drivers = Array.isArray(s.drivers) ? s.drivers : []
              return (
                <div className="sig-card" key={s.commodity_key}>
                  <div className="flex between" style={{ alignItems: 'flex-start' }}>
                    <b>{s.commodity_label}</b>
                    <span className="sig-dir" style={{ color: d.color, background: d.bg }}>
                      <Icon size={13} /> {d.label}
                    </span>
                  </div>

                  {/* HARGA TERKINI (resmi PIHPS atau terpantau media tepercaya) */}
                  {headline ? (() => {
                    const resmi = String(headline.source_name).includes('PIHPS')
                    // Harga resmi: arahkan ke halaman publik PIHPS yang ramah
                    // dibaca; harga dari media: langsung ke artikelnya.
                    const srcHref = resmi ? 'https://www.bi.go.id/hargapangan' : headline.source_url
                    return (
                      <div style={{ margin: '6px 0' }}>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>
                          {rupiah(headline.price)} <span className="muted-sm" style={{ fontWeight: 400 }}>/{String(headline.unit).replace('Rp/', '')}</span>
                          {delta !== null && Math.abs(delta) >= 0.05 && (
                            <span style={{ fontSize: 12.5, fontWeight: 600, marginLeft: 8, color: delta > 0 ? 'var(--red)' : 'var(--green)' }}>
                              {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
                            </span>
                          )}
                        </div>
                        <div className="muted-sm">
                          {resmi ? 'rata-rata nasional' : 'harga terpantau dari berita'}
                          {headline.price_date ? `, ${fmtDate(headline.price_date)}` : ''}
                        </div>
                        {pr.variants.length > 0 && (
                          <details className="sig-variants">
                            <summary>{pr.variants.length} varian harga</summary>
                            <ul>
                              {pr.variants.map((v) => (
                                <li key={v.variant_name}><span>{v.variant_name}</span><b>{rupiah(v.price)}</b></li>
                              ))}
                            </ul>
                          </details>
                        )}
                        <a className="sig-official" href={srcHref} target="_blank" rel="noreferrer noopener"
                          title="Buka sumber harga ini">
                          <BadgeCheck size={12} /> Sumber: {resmi ? 'PIHPS Bank Indonesia' : headline.source_name}
                        </a>
                      </div>
                    )
                  })() : s.commodity_key !== 'kurs' && (
                    <div className="muted-sm" style={{ margin: '6px 0' }}>
                      Harga belum tersedia dari sumber tepercaya — akan terisi otomatis begitu ada publikasi harga terbaru.
                    </div>
                  )}

                  {/* SINYAL 30 HARI */}
                  <div style={{ fontSize: 15, fontWeight: 600, margin: '4px 0 2px' }}>
                    Perkiraan 30 hari: {range}
                  </div>
                  <div className="muted-sm" style={{ marginBottom: 6 }}>
                    Keyakinan: <b style={{ color: CONF[s.confidence] || '#94a3b8' }}>{s.confidence}</b>
                    {mine && <span className="pill pill-cat" style={{ marginLeft: 8 }}>dipakai usaha Anda</span>}
                  </div>
                  {drivers.length > 0 && (
                    <ul className="sig-drivers">
                      {drivers.map((dr, i) => <li key={i}>{dr}</li>)}
                    </ul>
                  )}
                  {sources.length > 0 && (
                    <div className="sig-sources">
                      {sources.map((src, i) => (
                        <a key={i} href={src.link || '#'} target="_blank" rel="noreferrer noopener" title={src.title}>
                          <ExternalLink size={11} /> {String(src.title).slice(0, 60)}{String(src.title).length > 60 ? '…' : ''}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
