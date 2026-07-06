import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, TrendingDown, Minus, RefreshCw, ExternalLink } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { fetchMacroSignals, fetchExchangeRates, fetchMacroConfigLatest, fetchIngredients } from '../lib/api'
import { makroRefresh } from '../lib/ai'
import { fmtDate } from '../lib/format'
import AIDisclaimer from '../components/AIDisclaimer'

const DIR = {
  naik: { icon: TrendingUp, color: '#dc2626', bg: '#fee2e2', label: 'NAIK' },
  turun: { icon: TrendingDown, color: '#16a34a', bg: '#dcfce7', label: 'TURUN' },
  stabil: { icon: Minus, color: '#64748b', bg: '#f1f5f9', label: 'STABIL' },
}
const CONF = { rendah: '#94a3b8', sedang: '#f59e0b', tinggi: '#16a34a' }

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function Radar() {
  const [signals, setSignals] = useState([])
  const [runDate, setRunDate] = useState(null)
  const [rates, setRates] = useState([])
  const [config, setConfig] = useState(null)
  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tried, setTried] = useState(false)
  const [onlyMine, setOnlyMine] = useState(true)
  const [err, setErr] = useState('')

  const load = async () => {
    const [sig, rts, cfg, ing] = await Promise.allSettled([
      fetchMacroSignals(), fetchExchangeRates(90), fetchMacroConfigLatest(), fetchIngredients(),
    ])
    if (sig.status === 'fulfilled') { setSignals(sig.value.signals); setRunDate(sig.value.runDate) }
    if (rts.status === 'fulfilled') setRates(rts.value)
    if (cfg.status === 'fulfilled') setConfig(cfg.value)
    if (ing.status === 'fulfilled') setIngredients(ing.value)
    return sig.status === 'fulfilled' ? sig.value.runDate : null
  }

  // Pemicu "lazy": pengguna pertama hari ini menjalankan pipeline untuk SEMUA
  // pengguna; selanjutnya semua orang membaca cache (nol biaya AI tambahan).
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
      if (rd !== todayStr() && !tried) {
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
    if (!onlyMine || relevantKeys.size === 0) return signals
    return signals.filter((s) => relevantKeys.has(s.commodity_key) || s.commodity_key === 'kurs')
  }, [signals, onlyMine, relevantKeys])

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
          <b>Radar Harga Bahan.</b> Sinyal arah harga dari berita ekonomi & geopolitik (Bing News), diperbarui 1x/hari untuk semua pengguna.
          {runDate ? ` Data: ${fmtDate(runDate)}.` : ' Belum ada data.'}
        </span>
        <button className="btn btn-ghost" onClick={refresh} disabled={refreshing}>
          <RefreshCw size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} className={refreshing ? 'spin' : ''} />
          {refreshing ? 'Memuat berita hari ini (±30-60 dtk)...' : 'Perbarui'}
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
                <span style={{ color: kurs.pct30 > 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
                  {kurs.pct30 > 0 ? '+' : ''}{kurs.pct30.toFixed(1)}% / 30 hari {kurs.pct30 > 0 ? '(rupiah melemah)' : '(rupiah menguat)'}
                </span>
              </div>
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={kurs.chart} margin={{ left: -14, right: 6, top: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} minTickGap={30} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip formatter={(v) => 'Rp ' + Number(v).toLocaleString('id-ID')} contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }} />
                  <Area type="monotone" dataKey="kurs" stroke="#4f46e5" strokeWidth={2} fill="#eef2ff" />
                </AreaChart>
              </ResponsiveContainer>
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

      {/* SINYAL KOMODITAS */}
      <div className="card card-pad">
        <div className="flex between gap" style={{ flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
          <div>
            <h3 className="card-title">Sinyal Harga Bahan Pokok (30 hari ke depan)</h3>
            <div className="card-sub">Berdasarkan sentimen judul berita 7 hari terakhir — bukan kepastian harga</div>
          </div>
          {relevantKeys.size > 0 && (
            <label className="muted-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
              Hanya bahan usaha saya ({relevantKeys.size})
            </label>
          )}
        </div>
        <AIDisclaimer text="Prediksi AI dari berita — bisa keliru. Verifikasi harga aktual di pasar/supplier Anda sebelum mengambil keputusan." />

        {!shown.length ? (
          <p className="muted-sm" style={{ marginTop: 12 }}>
            {signals.length ? 'Tidak ada sinyal untuk bahan Anda. Matikan filter untuk melihat semua komoditas.' : 'Belum ada sinyal. Tekan tombol Perbarui di atas.'}
          </p>
        ) : (
          <div className="sig-grid" style={{ marginTop: 12 }}>
            {shown.map((s) => {
              const d = DIR[s.direction] || DIR.stabil
              const Icon = d.icon
              const mine = relevantKeys.has(s.commodity_key)
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
                  <div style={{ fontSize: 18, fontWeight: 700, margin: '4px 0' }}>{range} <span className="muted-sm" style={{ fontWeight: 400 }}>/ 30 hari</span></div>
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
