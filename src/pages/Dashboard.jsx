import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, TrendingDown, Wallet, Percent } from 'lucide-react'
import {
  AreaChart, Area, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { fetchTransactions, fetchLowStock, fetchTxCount } from '../lib/api'
import { sampleTransactions } from '../lib/sampleData'
import { rupiah, rupiahShort, fmtDateTime } from '../lib/format'
import { summarize, trendDaily, channelMix, expenseByCategory, findDuplicateGroups } from '../lib/analytics'
import { useCatalog } from '../context/CatalogContext'
import { useLang } from '../context/LangContext'

const PRESET_KEYS = ['today', 'week', 'month', 'quarter', 'semester', 'year', 'all', 'custom']

// Menghitung rentang tanggal {start, end} dari preset terpilih.
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

  useEffect(() => {
    fetchTransactions().then(setTx).catch(() => setTx([]))
    fetchLowStock().then(setLowStock).catch(() => setLowStock([]))
    fetchTxCount().then(setTxTotal).catch(() => {})
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
    const trend = trendDaily(tx, 14)
    const dups = findDuplicateGroups(scoped)
    const unpaid = scoped.filter((t) => t.direction === 'in' && t.payment_status === 'belum')
    const unpaidTotal = unpaid.reduce((s, t) => s + Number(t.amount), 0)
    return { sum, margin, mix, byCat, trend, dups, recent: tx.slice(0, 6), unpaidCount: unpaid.length, unpaidTotal }
  }, [tx, scoped])

  if (!tx) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const periodLabel = d.presets[preset] || d.periodFallback

  const enterDemo = () => { setTx(sampleTransactions()); setDemo(true); setPreset('all') }
  const exitDemo = () => { setDemo(false); fetchTransactions().then(setTx).catch(() => setTx([])) }

  return (
    <>
      {lowStock.length > 0 && (
        <div className="alert alert-err" style={{ marginBottom: 16 }}>
          <b>{d.lowStock1}</b> {lowStock.length} {d.lowStock2a}
          {' '}({lowStock.slice(0, 4).map((p) => p.name).join(', ')}{lowStock.length > 4 ? ', ' + d.andOthers : ''}).{' '}
          <Link to="/app/stok" className="linklike">{d.seeStock}</Link>
        </div>
      )}

      {demo && (
        <div className="alert alert-info" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span><b>{d.demoBold}</b> {d.demoText}</span>
          <button className="btn btn-ghost" onClick={exitDemo}>{d.demoExit}</button>
        </div>
      )}

      {!demo && txTotal > tx.length && (
        <div className="alert alert-err" style={{ marginBottom: 16 }}>
          {d.trunc1} {txTotal.toLocaleString('id-ID')} {d.trunc2} {tx.length.toLocaleString('id-ID')} {d.trunc3}
        </div>
      )}

      {/* FILTER RENTANG TANGGAL */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="flex between gap" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <h3 className="card-title">{d.summary}</h3>
            <div className="card-sub">{d.periodLbl} {periodLabel}</div>
          </div>
          <div className="flex gap" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="input" style={{ width: 'auto' }} value={preset} onChange={(e) => setPreset(e.target.value)}>
              {PRESET_KEYS.map((k) => <option key={k} value={k}>{d.presets[k]}</option>)}
            </select>
            {preset === 'custom' && (
              <>
                <input className="input" type="date" style={{ width: 'auto' }} value={from} onChange={(e) => setFrom(e.target.value)} />
                <span className="muted-sm">{d.to}</span>
                <input className="input" type="date" style={{ width: 'auto' }} value={to} onChange={(e) => setTo(e.target.value)} />
              </>
            )}
          </div>
        </div>
      </div>

      {tx.length === 0 ? (
        <div className="card"><div className="empty">
          <h3>{d.emptyTitle}</h3>
          <p>{d.emptyDesc}</p>
          <div className="flex gap" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={enterDemo}>{d.tryDemo}</button>
            <Link to="/app/transaksi" className="btn btn-ghost">{d.addTx}</Link>
            <Link to="/app/import" className="btn btn-ghost">{d.importCsv}</Link>
          </div>
          <p className="muted-sm" style={{ marginTop: 12 }}>{d.demoNote}</p>
        </div></div>
      ) : (
        <>
          <div className="grid-kpi">
            <div className="card">
              <div className="kpi-head"><span className="kpi-l">{d.income}</span><span className="kpi-ic" style={{ background: '#dcfce7', color: '#16a34a' }}><TrendingUp size={16} /></span></div>
              <div className="kpi-v" style={{ color: 'var(--green)' }}>{rupiahShort(data.sum.income)}</div>
              <div className="kpi-d muted-sm" style={{ color: 'var(--muted)' }}>{data.sum.count} {d.txCount}</div>
            </div>
            <div className="card">
              <div className="kpi-head"><span className="kpi-l">{d.expense}</span><span className="kpi-ic" style={{ background: '#fee2e2', color: '#dc2626' }}><TrendingDown size={16} /></span></div>
              <div className="kpi-v" style={{ color: 'var(--red)' }}>{rupiahShort(data.sum.expense)}</div>
              <div className="kpi-d muted-sm" style={{ color: 'var(--muted)' }}>{d.periodWord} {periodLabel.toLowerCase()}</div>
            </div>
            <div className="card">
              <div className="kpi-head"><span className="kpi-l">{d.profit}</span><span className="kpi-ic" style={{ background: '#eef2ff', color: '#4f46e5' }}><Wallet size={16} /></span></div>
              <div className="kpi-v" style={{ color: data.sum.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{rupiahShort(data.sum.profit)}</div>
              <div className={`kpi-d ${data.sum.profit >= 0 ? 'up' : 'down'}`}>{d.profitSub}</div>
            </div>
            <div className="card">
              <div className="kpi-head"><span className="kpi-l">{d.margin}</span><span className="kpi-ic" style={{ background: '#fef3c7', color: '#b45309' }}><Percent size={16} /></span></div>
              <div className="kpi-v" style={{ color: data.margin >= 0 ? 'var(--green)' : 'var(--red)' }}>{data.margin}%</div>
              <div className="kpi-d muted-sm" style={{ color: 'var(--muted)' }}>
                {data.unpaidCount > 0 ? `${data.unpaidCount} ${d.unpaidA} (${rupiahShort(data.unpaidTotal)})` : d.marginSub}
              </div>
            </div>
          </div>

          <div className="two-col mt">
            <div className="card card-pad">
              <h3 className="card-title">{d.trend}</h3>
              <div className="card-sub">{d.trend14}</div>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={data.trend} margin={{ left: -10, right: 6, top: 6 }}>
                  <defs>
                    <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => rupiahShort(v).replace('Rp ', '')} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={56} />
                  <Tooltip formatter={(v) => rupiah(v)} contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }} />
                  <Area type="monotone" dataKey="omzet" name={d.legIncome} stroke="#4f46e5" strokeWidth={2.5} fill="url(#gIn)" />
                  <Area type="monotone" dataKey="pengeluaran" name={d.legExpense} stroke="#f43f5e" strokeWidth={2} fill="url(#gOut)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="card card-pad">
              <h3 className="card-title">{d.incomeSrc}</h3>
              <div className="card-sub">{d.perChannel} {periodLabel.toLowerCase()}</div>
              {data.mix.length === 0 ? <p className="muted-sm">{d.noIncome}</p> : (
                <>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={data.mix} dataKey="value" innerRadius={42} outerRadius={66} paddingAngle={3}>
                        {data.mix.map((c) => <Cell key={c.name} fill={c.color} />)}
                      </Pie>
                      <Tooltip formatter={(v) => rupiah(v)} contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="legend" style={{ marginTop: 10 }}>
                    {data.mix.map((c) => (
                      <div className="lrow" key={c.name}>
                        <span className="sw" style={{ background: c.color }} />
                        {c.name} <b>{rupiahShort(c.value)}</b>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="two-col mt">
            <div className="card card-pad">
              <h3 className="card-title">{d.recent}</h3>
              <div className="card-sub">{d.last6}</div>
              {data.recent.map((t) => (
                <div className="tx" key={t.id}>
                  <div className="txmain">
                    <div className="txt">{t.description}</div>
                    <div className="txm">
                      <span className="pill pill-ch">{channelLabel(t.channel)}</span>
                      <span className="pill pill-cat">{t.category}</span>
                      <span>{fmtDateTime(t.occurred_at)}</span>
                    </div>
                  </div>
                  <div className={t.direction === 'in' ? 'amt-in' : 'amt-out'}>
                    {t.direction === 'in' ? '+' : '-'}{rupiah(t.amount)}
                  </div>
                </div>
              ))}
              <Link to="/app/transaksi" className="btn btn-ghost mt" style={{ width: '100%', justifyContent: 'center' }}>{d.seeAll}</Link>
            </div>

            <div className="card card-pad">
              <h3 className="card-title">{d.expCat}</h3>
              <div className="card-sub">{d.top6} {periodLabel.toLowerCase()}</div>
              {data.byCat.length === 0 ? <p className="muted-sm">{d.noExpense}</p> : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={data.byCat} layout="vertical" margin={{ left: 8, right: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => rupiahShort(v).replace('Rp ', '')} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => rupiah(v)} contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }} />
                    <Bar dataKey="value" fill="#4f46e5" radius={[0, 6, 6, 0]} barSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
