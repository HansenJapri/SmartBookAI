import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  TrendingUp, TrendingDown, Wallet, Percent, Sparkles, RefreshCw,
  Target as TargetIcon, Trash2, CalendarDays, AlertTriangle, ChevronRight,
  ArrowRight, CheckCircle2, Clock,
} from 'lucide-react'
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { fetchTransactions, fetchLowStock, fetchTxCount, fetchActiveTarget, addTarget, deactivateTarget, fetchProfile } from '../lib/api'
import { narasiAI } from '../lib/ai'
import { sampleTransactions } from '../lib/sampleData'
import { rupiah, rupiahShort, fmtDateTime, fmtDate } from '../lib/format'
import { summarize, trendForRange, channelMix, expenseByCategory } from '../lib/analytics'
import { useCatalog } from '../context/CatalogContext'
import { useLang } from '../context/LangContext'
import AIDisclaimer from '../components/AIDisclaimer'
import Reminders from '../components/Reminders'
import './dashboard.css'

const PRESET_KEYS = ['today', 'week', 'month', 'quarter', 'semester', 'year', 'all', 'custom']

function presetRange(preset, from, to) {
  const now = new Date()
  if (preset === 'all') return { start: null, end: null }
  if (preset === 'custom') {
    return {
      start: from ? new Date(from + 'T00:00:00') : null,
      end: to ? new Date(to + 'T23:59:59') : now,
    }
  }
  const start = new Date(now)
  if (preset === 'today') start.setHours(0, 0, 0, 0)
  else if (preset === 'week') { const day = (now.getDay() + 6) % 7; start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - day) }
  else if (preset === 'month') return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now }
  else if (preset === 'quarter') return { start: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1), end: now }
  else if (preset === 'semester') return { start: new Date(now.getFullYear(), now.getMonth() < 6 ? 0 : 6, 1), end: now }
  else if (preset === 'year') return { start: new Date(now.getFullYear(), 0, 1), end: now }
  return { start, end: now }
}

// Kelompok jam untuk "Peak Hour" — cari 2 jam berturut dengan jumlah transaksi tertinggi.
function computePeakHour(transactions) {
  if (!transactions.length) return '—'
  const buckets = new Array(24).fill(0)
  for (const t of transactions) {
    if (t.direction !== 'in') continue
    const h = new Date(t.occurred_at).getHours()
    buckets[h]++
  }
  let bestI = 0, best = -1
  for (let i = 0; i < 23; i++) {
    const s = buckets[i] + buckets[i + 1]
    if (s > best) { best = s; bestI = i }
  }
  if (best <= 0) return '—'
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(bestI)}:00 – ${pad(bestI + 2)}:00`
}

// Deskripsi transaksi paling sering muncul → proksi produk terlaris.
function computeTopProduct(transactions) {
  const map = new Map()
  for (const t of transactions) {
    if (t.direction !== 'in') continue
    const key = (t.description || '').trim().split(/[·\-·|,]/)[0].trim().slice(0, 40)
    if (!key) continue
    map.set(key, (map.get(key) || 0) + 1)
  }
  let top = '—', best = 0
  for (const [k, v] of map) if (v > best) { best = v; top = k }
  return top
}

export default function Dashboard() {
  const { channelLabel } = useCatalog()
  const { t } = useLang()
  const d = t.dash
  const [tx, setTx] = useState(null)
  const [lowStock, setLowStock] = useState([])
  const [demo, setDemo] = useState(false)
  const [txTotal, setTxTotal] = useState(0)
  const [preset, setPreset] = useState('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [ownerName, setOwnerName] = useState('')

  useEffect(() => {
    fetchTransactions().then(setTx).catch(() => setTx([]))
    fetchLowStock().then(setLowStock).catch(() => setLowStock([]))
    fetchTxCount().then(setTxTotal).catch(() => {})
    fetchProfile().then((p) => setOwnerName(p?.owner_name || p?.business_name || '')).catch(() => {})
  }, [])

  const range = useMemo(() => presetRange(preset, from, to), [preset, from, to])

  const scoped = useMemo(() => {
    if (!tx) return []
    if (!range.start && !range.end) return tx
    return tx.filter((t) => {
      const dt = new Date(t.occurred_at)
      if (range.start && dt < range.start) return false
      if (range.end && dt > range.end) return false
      return true
    })
  }, [tx, range])

  const data = useMemo(() => {
    if (!tx) return null
    const sum = summarize(scoped)
    const margin = sum.income > 0 ? Math.round((sum.profit / sum.income) * 100) : 0
    const mix = channelMix(scoped)
    const byCat = expenseByCategory(scoped).slice(0, 6)
    // Grafik tren mengikuti periode yang dipilih (hari ini → per jam; lainnya → per hari).
    const trend = trendForRange(tx, range.start, range.end)
    const unpaid = scoped.filter((t) => t.direction === 'in' && t.payment_status === 'belum')
    const unpaidTotal = unpaid.reduce((s, t) => s + Number(t.amount), 0)
    const topProduct = computeTopProduct(scoped)
    const peakHour = computePeakHour(scoped)
    return { sum, margin, mix, byCat, trend, recent: tx.slice(0, 6), unpaidCount: unpaid.length, unpaidTotal, topProduct, peakHour }
  }, [tx, scoped])

  // Reveal on scroll.
  const rootRef = useRef(null)
  useEffect(() => {
    if (!rootRef.current || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target) }
    }, { threshold: 0.12 })
    rootRef.current.querySelectorAll('.d2-rv').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [tx])

  if (!tx) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const periodLabel = d.presets[preset] || d.periodFallback
  const enterDemo = () => { setTx(sampleTransactions()); setDemo(true); setPreset('all') }
  const exitDemo = () => { setDemo(false); fetchTransactions().then(setTx).catch(() => setTx([])) }

  return (
    <div className="d2" ref={rootRef}>
      <Reminders />

      {/* Greeting + period selector */}
      <div className="d2-greet d2-rv">
        <div>
          <h2>Halo{ownerName ? `, ${ownerName}` : ''} <span className="d2-greet-wave" role="img" aria-label="melambai">👋</span></h2>
          <p>Berikut ringkasan performa usaha Anda pada periode {periodLabel.toLowerCase()}.</p>
        </div>
        <label className="d2-period" aria-label="Pilih rentang tanggal">
          <CalendarDays size={18} />
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            {PRESET_KEYS.map((k) => <option key={k} value={k}>{d.presets[k]}</option>)}
          </select>
          {preset === 'custom' && (
            <>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Dari tanggal" />
              <span style={{ fontSize: 12, color: 'var(--d2-on-surface-variant)' }}>{d.to}</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Sampai tanggal" />
            </>
          )}
        </label>
      </div>

      {/* Alert stok menipis */}
      {lowStock.length > 0 && (
        <div className="d2-alert d2-rv" role="alert">
          <div className="d2-alert-body">
            <div className="d2-alert-ic"><AlertTriangle size={20} aria-hidden="true" /></div>
            <div>
              <b>{d.lowStock1} {lowStock.length} {d.lowStock2a}</b>
              <p>{lowStock.slice(0, 4).map((p) => p.name).join(', ')}{lowStock.length > 4 ? `, ${d.andOthers}` : ''}.</p>
            </div>
          </div>
          <Link to="/app/stok" className="d2-alert-cta">Pesan Sekarang</Link>
        </div>
      )}

      {demo && (
        <div className="d2-info d2-rv">
          <span><b>{d.demoBold}</b> {d.demoText}</span>
          <button className="d2-btn-ghost" onClick={exitDemo}>{d.demoExit}</button>
        </div>
      )}

      {!demo && txTotal > tx.length && (
        <div className="d2-alert d2-rv" role="alert">
          <div className="d2-alert-body">
            <div className="d2-alert-ic"><AlertTriangle size={20} aria-hidden="true" /></div>
            <div>
              <b>{d.trunc1} {txTotal.toLocaleString('id-ID')} {d.trunc2} {tx.length.toLocaleString('id-ID')} {d.trunc3}</b>
            </div>
          </div>
        </div>
      )}

      {tx.length === 0 ? (
        <div className="d2-empty d2-rv">
          <h3>{d.emptyTitle}</h3>
          <p>{d.emptyDesc}</p>
          <div className="d2-empty-actions">
            <button className="d2-btn-primary" onClick={enterDemo}>{d.tryDemo}</button>
            <Link to="/app/transaksi" className="d2-btn-ghost">{d.addTx}</Link>
            <Link to="/app/import" className="d2-btn-ghost">{d.importCsv}</Link>
          </div>
        </div>
      ) : (
        <>
          {/* AI Insight + Target */}
          <div className="d2-hero">
            <InsightCard extras={{ topProduct: data.topProduct, peakHour: data.peakHour, txCount: data.sum.count }} />
            <TargetCard tx={tx} />
          </div>

          {/* 4 KPI */}
          <div className="d2-kpi-grid">
            <KpiCard variant="up" icon={<TrendingUp size={22} />} label={d.income} value={rupiahShort(data.sum.income)} sub={`${data.sum.count} ${d.txCount}`} />
            <KpiCard variant="down" icon={<TrendingDown size={22} />} label={d.expense} value={rupiahShort(data.sum.expense)} sub={`${d.periodWord} ${periodLabel.toLowerCase()}`} />
            <KpiCard variant="wallet" icon={<Wallet size={22} />} label={d.profit} value={rupiahShort(data.sum.profit)} sub={d.profitSub} />
            <KpiCard variant="pct" icon={<Percent size={22} />} label={d.margin} value={`${data.margin}%`}
              sub={data.unpaidCount > 0 ? `${data.unpaidCount} ${d.unpaidA} (${rupiahShort(data.unpaidTotal)})` : d.marginSub} />
          </div>

          {/* Chart tren + donut */}
          <div className="d2-charts">
            <div className="d2-panel d2-rv">
              <div className="d2-panel-head">
                <div>
                  <h4 className="d2-panel-title">{d.trend}</h4>
                  <div className="d2-panel-sub">{periodLabel}</div>
                </div>
                <div className="d2-legend">
                  <span className="d2-legend-item"><span className="d2-legend-dot" style={{ background: '#001ec1' }} />{d.legIncome}</span>
                  <span className="d2-legend-item"><span className="d2-legend-dot" style={{ background: '#3a90fe' }} />{d.legExpense}</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={data.trend} margin={{ left: -10, right: 6, top: 6 }}>
                  <defs>
                    <linearGradient id="d2gIn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#001ec1" stopOpacity={0.30} />
                      <stop offset="100%" stopColor="#001ec1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="d2gOut" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3a90fe" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#3a90fe" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--d2-outline-variant)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--d2-on-surface-variant)' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => rupiahShort(v).replace('Rp ', '')} tick={{ fontSize: 11, fill: 'var(--d2-on-surface-variant)' }} axisLine={false} tickLine={false} width={56} />
                  <Tooltip formatter={(v) => rupiah(v)} contentStyle={{ borderRadius: 10, border: '1px solid var(--d2-outline-variant)', fontSize: 13, background: 'var(--d2-surface-lowest)' }} />
                  <Area type="monotone" dataKey="omzet" name={d.legIncome} stroke="#001ec1" strokeWidth={2.5} fill="url(#d2gIn)" />
                  <Area type="monotone" dataKey="pengeluaran" name={d.legExpense} stroke="#3a90fe" strokeWidth={2} fill="url(#d2gOut)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="d2-panel d2-rv">
              <div className="d2-panel-head">
                <div>
                  <h4 className="d2-panel-title">{d.incomeSrc}</h4>
                  <div className="d2-panel-sub">{d.perChannel} {periodLabel.toLowerCase()}</div>
                </div>
              </div>
              {data.mix.length === 0 ? <p style={{ color: 'var(--d2-on-surface-variant)', fontSize: 14 }}>{d.noIncome}</p> : (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={data.mix} dataKey="value" innerRadius={48} outerRadius={78} paddingAngle={3}>
                        {data.mix.map((c) => <Cell key={c.name} fill={c.color} />)}
                      </Pie>
                      <Tooltip formatter={(v) => rupiah(v)} contentStyle={{ borderRadius: 10, border: '1px solid var(--d2-outline-variant)', fontSize: 13, background: 'var(--d2-surface-lowest)' }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {data.mix.map((c) => (
                      <div className="d2-mix-row" key={c.name}>
                        <span><span className="d2-legend-dot" style={{ background: c.color }} />{channelLabel ? channelLabel(c.name) || c.name : c.name}</span>
                        <b>{rupiahShort(c.value)}</b>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Recent transactions */}
          <div className="d2-panel d2-rv" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="d2-panel-head" style={{ padding: '20px 22px', marginBottom: 0, borderBottom: '1px solid var(--d2-outline-variant)' }}>
              <div>
                <h4 className="d2-panel-title">{d.recent}</h4>
                <div className="d2-panel-sub">{d.last6}</div>
              </div>
              <Link to="/app/transaksi" style={{ color: 'var(--d2-primary)', font: '600 13px Inter, sans-serif', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {d.seeAll} <ChevronRight size={16} />
              </Link>
            </div>
            <div className="d2-table-wrap" style={{ margin: 0, padding: 0 }}>
              <table className="d2-table">
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Keterangan</th>
                    <th>Kategori</th>
                    <th className="d2-num">Nominal</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((tr) => (
                    <tr key={tr.id}>
                      <td style={{ color: 'var(--d2-on-surface-variant)' }}>{fmtDateTime(tr.occurred_at)}</td>
                      <td style={{ fontWeight: 600 }}>{tr.description}</td>
                      <td>
                        <span className={`d2-tag ${tr.direction === 'in' ? 'd2-tag-in' : 'd2-tag-out'}`}>
                          {tr.direction === 'in' ? 'PEMASUKAN' : (tr.category || 'OPERASIONAL')}
                        </span>
                      </td>
                      <td className={`d2-amt ${tr.direction === 'in' ? 'd2-amt-in' : 'd2-amt-out'}`}>
                        {tr.direction === 'in' ? '+' : '-'}{rupiah(tr.amount)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {tr.payment_status === 'belum'
                          ? <Clock size={18} style={{ color: 'var(--d2-outline)' }} aria-label="Belum lunas" />
                          : <CheckCircle2 size={18} style={{ color: 'var(--d2-success)' }} aria-label="Lunas" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pengeluaran per kategori */}
          {data.byCat.length > 0 && (
            <div className="d2-panel d2-rv">
              <div className="d2-panel-head">
                <div>
                  <h4 className="d2-panel-title">{d.expCat}</h4>
                  <div className="d2-panel-sub">{d.top6} {periodLabel.toLowerCase()}</div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(() => {
                  const max = Math.max(...data.byCat.map((c) => c.value), 1)
                  return data.byCat.map((c) => (
                    <div key={c.name}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                        <span style={{ color: 'var(--d2-on-surface)', fontWeight: 500 }}>{c.name}</span>
                        <b style={{ color: 'var(--d2-on-surface)' }}>{rupiahShort(c.value)}</b>
                      </div>
                      <div className="d2-progress"><div style={{ width: `${(c.value / max) * 100}%` }} /></div>
                    </div>
                  ))
                })()}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function KpiCard({ variant, icon, label, value, sub }) {
  return (
    <div className="d2-kpi d2-rv">
      <div className={`d2-kpi-ic d2-kpi-ic-${variant}`}>{icon}</div>
      <div>
        <span className="d2-kpi-l">{label}</span>
        <div className={`d2-kpi-v d2-kpi-v-${variant}`}>{value}</div>
        {sub && <span className="d2-kpi-sub">{sub}</span>}
      </div>
    </div>
  )
}

function InsightCard({ extras }) {
  const { t, lang } = useLang()
  const di = t.dashboard
  const [st, setSt] = useState({ loading: true, content: '', err: '' })
  const load = (force) => {
    setSt((s) => ({ ...s, loading: true, err: '' }))
    narasiAI(force, lang)
      .then((d) => setSt({ loading: false, content: d.content, err: '' }))
      .catch((e) => setSt({ loading: false, content: '', err: e.message }))
  }
  useEffect(() => { load(false) }, [lang]) // eslint-disable-line

  const headline = useMemo(() => {
    if (!st.content) return di.defaultHeadline
    const firstDot = st.content.indexOf('.')
    return firstDot > 20 ? st.content.slice(0, firstDot + 1) : di.defaultHeadline
  }, [st.content, di.defaultHeadline])

  const body = useMemo(() => {
    if (!st.content) return ''
    const firstDot = st.content.indexOf('.')
    return firstDot > 20 ? st.content.slice(firstDot + 1).trim() : st.content
  }, [st.content])

  return (
    <div className="d2-insight d2-rv">
      <div className="d2-insight-blob" aria-hidden="true" />
      <div className="d2-insight-head">
        <div className="d2-insight-badges">
          <span className="d2-badge-ai"><Sparkles size={12} />{di.insightBadge}</span>
          <span className="d2-ts">{di.insightUpdated}</span>
        </div>
        <button className="d2-refresh" onClick={() => load(true)} disabled={st.loading} title={di.refreshTitle} aria-label={di.refreshAria}>
          <RefreshCw size={16} className={st.loading ? 'd2-spin' : ''} />
        </button>
      </div>
      {st.loading ? (
        <p style={{ color: 'var(--d2-on-surface-variant)', fontSize: 14 }}>{di.preparing}</p>
      ) : st.err ? (
        <p style={{ color: 'var(--d2-error)', fontSize: 14 }}>{st.err}</p>
      ) : (
        <>
          <h3>{headline}</h3>
          {body && <p className="d2-insight-body">{body}</p>}
          <Link to="/app/laporan" className="d2-insight-cta">{di.viewDetail} <ArrowRight size={16} /></Link>
        </>
      )}
      <div className="d2-insight-mini">
        <div>
          <p>{di.topProduct}</p>
          <p>{extras?.topProduct || '—'}</p>
        </div>
        <div>
          <p>{di.peakHour}</p>
          <p>{extras?.peakHour || '—'}</p>
        </div>
        <div>
          <p>{di.transactions}</p>
          <p>{extras?.txCount || 0}</p>
        </div>
      </div>
      <AIDisclaimer text={di.aiDisclaimer} />
    </div>
  )
}

// Progres target dihitung dari transaksi dalam RENTANG target sendiri
// (start_date..deadline) — sengaja TIDAK terpengaruh filter periode dashboard.
function computeTargetProgress(tx, target) {
  if (!target || !tx) return null
  const startStr = target.start_date || new Date().toISOString().slice(0, 10)
  const start = new Date(startStr + 'T00:00:00').getTime()
  const end = target.deadline ? new Date(target.deadline + 'T23:59:59').getTime() : null
  let income = 0, expense = 0
  for (const t of tx) {
    const ts = new Date(t.occurred_at).getTime()
    if (ts < start || (end && ts > end)) continue
    if (t.direction === 'in') income += Number(t.amount) || 0
    else expense += Number(t.amount) || 0
  }
  const profit = income - expense
  const rev = target.revenue_target != null ? Number(target.revenue_target) : null
  const prof = target.profit_target != null ? Number(target.profit_target) : null
  const now = Date.now()
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null)
  const totalDays = end ? Math.max(1, Math.ceil((end - start) / 86400000)) : null
  const remainingDays = end ? Math.max(0, Math.ceil((end - now) / 86400000)) : null
  const elapsedDays = Math.max(0, Math.floor((Math.min(now, end || now) - start) / 86400000))
  const timePct = totalDays ? Math.min(100, Math.round((elapsedDays / totalDays) * 100)) : null
  const pcts = [pct(income, rev), pct(profit, prof)].filter((x) => x != null)
  return {
    income, expense, profit, rev, prof,
    revPct: pct(income, rev), profPct: pct(profit, prof),
    minPct: pcts.length ? Math.min(...pcts) : 0,
    done: pcts.length > 0 && pcts.every((p) => p >= 100),
    totalDays, remainingDays, timePct,
    started: now >= start, ended: end ? now > end : false,
  }
}

// Satu baris progres (omset / profit) dengan bar & rasio capaian.
function TargetMetric({ label, achieved, target, pct }) {
  return (
    <div className="d2-tgt-metric">
      <div className="d2-tgt-metric-top">
        <span>{label}</span>
        <b>{pct != null ? `${Math.min(999, pct)}%` : '—'}</b>
      </div>
      <div className="d2-progress"><div style={{ width: `${Math.min(100, pct || 0)}%` }} /></div>
      <div className="d2-tgt-metric-sub">{rupiahShort(achieved)} <span>/ {rupiahShort(target)}</span></div>
    </div>
  )
}

function TargetCard({ tx }) {
  const [target, setTarget] = useState(undefined)
  const today = new Date().toISOString().slice(0, 10)
  const emptyForm = { name: '', start_date: today, end_date: '', revenue_target: '', profit_target: '' }
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { fetchActiveTarget().then(setTarget).catch(() => setTarget(null)) }, [])
  const prog = useMemo(() => (target && tx ? computeTargetProgress(tx, target) : null), [target, tx])

  const create = async (e) => {
    e.preventDefault()
    const rev = Number(form.revenue_target) || 0
    const prof = Number(form.profit_target) || 0
    if (rev <= 0 && prof <= 0) { setErr('Isi minimal salah satu: target omset atau target profit.'); return }
    if (form.end_date && form.end_date < form.start_date) { setErr('Tanggal akhir tidak boleh sebelum tanggal mulai.'); return }
    setBusy(true); setErr('')
    try {
      setTarget(await addTarget({
        name: form.name, start_date: form.start_date, deadline: form.end_date || null,
        revenue_target: rev > 0 ? rev : null, profit_target: prof > 0 ? prof : null,
      }))
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }
  const stop = async () => {
    if (!target) return
    setBusy(true)
    try { await deactivateTarget(target.id); setTarget(null); setForm(emptyForm) }
    catch { /* abaikan */ } finally { setBusy(false) }
  }

  const rangeLabel = target
    ? `${fmtDate(target.start_date)} → ${target.deadline ? fmtDate(target.deadline) : 'tanpa batas'}`
    : ''
  const pace = prog && prog.timePct != null && !prog.ended && !prog.done
    ? (prog.minPct >= prog.timePct ? 'ok' : 'behind') : null

  return (
    <div className="d2-target d2-rv">
      <div className="d2-target-head">
        <div style={{ minWidth: 0 }}>
          <h4><TargetIcon size={14} style={{ verticalAlign: '-2px', marginRight: 6, color: 'var(--d2-primary)' }} />Target Penjualan</h4>
          <div className="d2-tv" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {target ? (target.name || 'Target') : 'Rp —'}
          </div>
        </div>
        {target && (
          <>
            <span className="d2-target-pct">{prog?.minPct ?? 0}%</span>
            <button className="d2-refresh" onClick={stop} disabled={busy} title="Hapus target" aria-label="Hapus target" style={{ color: 'var(--d2-error)', background: 'color-mix(in srgb, var(--d2-error) 10%, transparent)' }}>
              <Trash2 size={15} />
            </button>
          </>
        )}
      </div>

      {err && <div className="d2-alert" style={{ padding: '10px 14px' }}><div className="d2-alert-body"><span style={{ fontSize: 13 }}>{err}</span></div></div>}

      {target === undefined ? (
        <p style={{ color: 'var(--d2-on-surface-variant)', fontSize: 14 }}>Memuat…</p>
      ) : !target ? (
        <form onSubmit={create}>
          <div>
            <label htmlFor="d2-target-name">Nama target</label>
            <input id="d2-target-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="cth: Target Kuartal 3" />
          </div>
          <div className="d2-tgt-row">
            <div>
              <label htmlFor="d2-target-start">Tanggal mulai</label>
              <input id="d2-target-start" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </div>
            <div>
              <label htmlFor="d2-target-end">Tanggal akhir</label>
              <input id="d2-target-end" type="date" value={form.end_date} min={form.start_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            </div>
          </div>
          <div className="d2-tgt-row">
            <div>
              <label htmlFor="d2-target-rev">Target omset (Rp)</label>
              <input id="d2-target-rev" type="number" min="0" inputMode="numeric" value={form.revenue_target} onChange={(e) => setForm({ ...form, revenue_target: e.target.value })} placeholder="cth: 50.000.000" />
            </div>
            <div>
              <label htmlFor="d2-target-prof">Target profit bersih (Rp)</label>
              <input id="d2-target-prof" type="number" min="0" inputMode="numeric" value={form.profit_target} onChange={(e) => setForm({ ...form, profit_target: e.target.value })} placeholder="cth: 15.000.000" />
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--d2-on-surface-variant)', margin: 0 }}>Isi salah satu atau keduanya. Progres dihitung dari transaksi dalam rentang tanggal ini saja.</p>
          <button className="d2-btn-primary" disabled={busy}>{busy ? '...' : 'Buat Target'}</button>
        </form>
      ) : (
        <>
          <div className="d2-tgt-range">{rangeLabel}</div>
          {prog?.rev != null && <TargetMetric label="Omset" achieved={prog.income} target={prog.rev} pct={prog.revPct} />}
          {prog?.prof != null && <TargetMetric label="Profit bersih" achieved={prog.profit} target={prog.prof} pct={prog.profPct} />}

          {prog?.done ? (
            <div className="d2-info" style={{ marginTop: 4 }}><CheckCircle2 size={15} /> Target tercapai! Mantap.</div>
          ) : (
            <div className="d2-tgt-foot">
              <span>
                {prog?.ended
                  ? 'Periode target selesai'
                  : prog?.remainingDays != null ? `${prog.remainingDays} hari tersisa` : 'Tanpa batas akhir'}
              </span>
              {pace && (
                <span className={pace === 'ok' ? 'd2-tgt-pace-ok' : 'd2-tgt-pace-behind'}>
                  {pace === 'ok' ? '✓ Sesuai jalur' : '⚡ Perlu dikebut'}
                </span>
              )}
            </div>
          )}
          <button className="d2-btn-outline" onClick={stop} disabled={busy}>Ganti Target</button>
        </>
      )}
    </div>
  )
}
