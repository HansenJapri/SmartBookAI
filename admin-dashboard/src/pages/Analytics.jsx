import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { listUsers, listTransactions, listFeedback, listEvents, getMetrics, subscribe } from '../lib/adminApi'
import { num, timeAgo } from '../lib/format'
import { Kpi, Stars, Spinner } from '../components/ui'

const EVENT_LABEL = {
  login: 'Login', transaction_added: 'Tambah transaksi', import_completed: 'Import data',
  report_generated: 'Buat laporan', feedback_submitted: 'Kirim feedback',
}
const RATING_COLORS = ['#e11d48', '#f59e0b', '#eab308', '#84cc16', '#16a34a']

export default function Analytics() {
  const [data, setData] = useState(null)

  const load = useCallback(async () => {
    const [users, tx, fb, events, metrics] = await Promise.all([
      listUsers(), listTransactions({ limit: 5000 }), listFeedback({ limit: 500 }),
      listEvents({ days: 30 }).catch(() => []), getMetrics(),
    ])
    setData({ users, tx, fb, events, metrics })
  }, [])

  useEffect(() => {
    load().catch((e) => { console.error(e); setData({ users: [], tx: [], fb: [], events: [], metrics: {} }) })
    const unsub = [subscribe('feedback', load), subscribe('app_events', load)]
    return () => unsub.forEach((fn) => fn())
  }, [load])

  const view = useMemo(() => {
    if (!data) return null
    const { users, fb, events, metrics } = data

    // Kepuasan
    const rated = fb.filter((f) => f.rating)
    const ratingDist = [1, 2, 3, 4, 5].map((n) => ({
      name: `${n}★`, value: rated.filter((f) => f.rating === n).length, n,
    }))
    const avg = rated.length ? rated.reduce((s, f) => s + f.rating, 0) / rated.length : 0
    const promoters = rated.filter((f) => f.rating >= 4).length
    const detractors = rated.filter((f) => f.rating <= 2).length
    const nps = rated.length ? Math.round(((promoters - detractors) / rated.length) * 100) : null

    const helpedYes = fb.filter((f) => f.helped === true).length
    const helpedNo = fb.filter((f) => f.helped === false).length
    const helpedPct = (helpedYes + helpedNo) ? Math.round((helpedYes / (helpedYes + helpedNo)) * 100) : null

    // Funnel adopsi (efektivitas: apakah benar-benar dipakai)
    const total = users.length
    const activated = users.filter((u) => u.tx_count >= 1).length
    const engaged = users.filter((u) => u.tx_count >= 5).length
    const power = users.filter((u) => u.tx_count >= 10).length
    const funnel = [
      { name: 'Mendaftar', value: total, pct: 100 },
      { name: 'Mulai mencatat (≥1 tx)', value: activated, pct: total ? Math.round(activated / total * 100) : 0 },
      { name: 'Rutin (≥5 tx)', value: engaged, pct: total ? Math.round(engaged / total * 100) : 0 },
      { name: 'Power user (≥10 tx)', value: power, pct: total ? Math.round(power / total * 100) : 0 },
    ]

    // Pemakaian fitur (dari app_events)
    const evCount = {}
    for (const e of events) evCount[e.type] = (evCount[e.type] || 0) + 1
    const features = Object.keys(EVENT_LABEL).map((k) => ({ name: EVENT_LABEL[k], value: evCount[k] || 0 }))
    const reportsGenerated = evCount['report_generated'] || 0

    // Kutipan
    const positives = rated.filter((f) => f.rating >= 4 && f.message).slice(0, 4)
    const critical = fb.filter((f) => (f.rating && f.rating <= 2) || f.helped === false).filter((f) => f.message).slice(0, 4)

    return { ratingDist, avg, nps, helpedYes, helpedNo, helpedPct, funnel, features, reportsGenerated, positives, critical, metrics, activatedPct: total ? Math.round(activated / total * 100) : 0 }
  }, [data])

  if (!view) return <Spinner />

  const helpedData = [
    { name: 'Terbantu', value: view.helpedYes, color: '#16a34a' },
    { name: 'Belum', value: view.helpedNo, color: '#e11d48' },
  ]

  return (
    <>
      {/* === DAMPAK & KEPUASAN === */}
      <h3 className="card-title" style={{ marginBottom: 4 }}>🎯 Dampak & Kepuasan Pengguna</h3>
      <p className="muted-sm" style={{ marginBottom: 14 }}>Apakah aplikasi ini benar-benar membantu menyelesaikan masalah pengguna?</p>
      <div className="kpi-grid">
        <Kpi icon="⭐" label="Kepuasan rata-rata" value={view.avg ? `${view.avg.toFixed(1)} / 5` : '-'} delta={`${num(view.metrics.rating_count)} penilaian`} />
        <Kpi icon="📊" label="Skor NPS (sederhana)" value={view.nps != null ? view.nps : '-'} delta="Promotor dikurangi Detraktor" deltaDir={view.nps >= 0 ? 'up' : 'down'} />
        <Kpi icon="✅" label="Merasa terbantu" value={view.helpedPct != null ? `${view.helpedPct}%` : '-'} delta={`${num(view.helpedYes)} ya · ${num(view.helpedNo)} belum`} deltaDir={view.helpedPct >= 50 ? 'up' : ''} />
        <Kpi icon="📑" label="Laporan dihasilkan" value={num(view.reportsGenerated)} delta="output nyata (KUR/pajak) · 30 hari" />
      </div>

      <div className="grid-2 mt">
        <div className="card">
          <div className="card-title">Distribusi Penilaian</div>
          <div className="card-sub">Sebaran bintang dari semua feedback</div>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={view.ratingDist} margin={{ left: -20, right: 8, top: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={30} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }} />
              <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={46}>
                {view.ratingDist.map((d) => <Cell key={d.n} fill={RATING_COLORS[d.n - 1]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-title">Apakah Membantu?</div>
          <div className="card-sub">Jawaban "apakah aplikasi membantu masalahmu"</div>
          {(view.helpedYes + view.helpedNo) === 0 ? (
            <div className="empty"><div className="ee">🤷</div><p>Belum ada jawaban.</p></div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie data={helpedData} dataKey="value" innerRadius={48} outerRadius={72} paddingAngle={3}>
                    {helpedData.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="legend">
                {helpedData.map((d) => (
                  <div className="row" key={d.name}><span className="sw" style={{ background: d.color }} />{d.name}<b>{num(d.value)}</b></div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* === EFEKTIVITAS / ADOPSI === */}
      <h3 className="card-title" style={{ margin: '24px 0 4px' }}>⚙️ Efektivitas & Adopsi</h3>
      <p className="muted-sm" style={{ marginBottom: 14 }}>Seberapa dalam pengguna benar-benar memakai aplikasi untuk pembukuan nyata.</p>
      <div className="grid-2">
        <div className="card">
          <div className="card-title">Funnel Adopsi</div>
          <div className="card-sub">Dari mendaftar → jadi pengguna aktif</div>
          <div style={{ marginTop: 12 }}>
            {view.funnel.map((s, i) => (
              <div key={s.name} style={{ marginBottom: 12 }}>
                <div className="flex between" style={{ fontSize: 13, marginBottom: 5 }}>
                  <span>{s.name}</span><b>{num(s.value)} · {s.pct}%</b>
                </div>
                <div style={{ height: 10, background: '#f1f5f9', borderRadius: 999 }}>
                  <div style={{ width: `${s.pct}%`, height: '100%', borderRadius: 999, background: ['#4f46e5', '#6366f1', '#0ea5e9', '#16a34a'][i] }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title">Pemakaian Fitur</div>
          <div className="card-sub">Jumlah aksi tercatat (30 hari terakhir)</div>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={view.features} layout="vertical" margin={{ left: 30, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={108} tick={{ fontSize: 11.5, fill: '#475569' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }} />
              <Bar dataKey="value" fill="#4f46e5" radius={[0, 5, 5, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
          {view.features.every((f) => f.value === 0) && (
            <p className="muted-sm" style={{ marginTop: 8 }}>Belum ada event tercatat. Data akan muncul setelah pengguna beraktivitas.</p>
          )}
        </div>
      </div>

      {/* === SUARA PENGGUNA === */}
      <h3 className="card-title" style={{ margin: '24px 0 4px' }}>🗣️ Suara Pengguna</h3>
      <p className="muted-sm" style={{ marginBottom: 14 }}>Bukti kualitatif: apa kata mereka secara langsung.</p>
      <div className="grid-2">
        <div className="card">
          <div className="card-title" style={{ color: 'var(--green)' }}>👍 Yang Terbantu</div>
          {view.positives.length === 0 ? <p className="muted-sm" style={{ marginTop: 8 }}>Belum ada.</p> :
            view.positives.map((f) => (
              <div key={f.id} style={{ padding: '10px 0', borderTop: '1px solid #f1f5f9' }}>
                <div className="flex gap center wrap"><b style={{ fontSize: 13 }}>{f.author_name || 'Pengguna'}</b><Stars value={f.rating} /><span className="muted-sm">{timeAgo(f.created_at)}</span></div>
                <p style={{ fontSize: 13.5, color: 'var(--slate)', marginTop: 5 }}>"{f.message}"</p>
              </div>
            ))}
        </div>
        <div className="card">
          <div className="card-title" style={{ color: 'var(--red)' }}>🛠️ Perlu Perbaikan</div>
          {view.critical.length === 0 ? <p className="muted-sm" style={{ marginTop: 8 }}>Tidak ada keluhan. 🎉</p> :
            view.critical.map((f) => (
              <div key={f.id} style={{ padding: '10px 0', borderTop: '1px solid #f1f5f9' }}>
                <div className="flex gap center wrap"><b style={{ fontSize: 13 }}>{f.author_name || 'Pengguna'}</b>{f.rating ? <Stars value={f.rating} /> : null}{f.helped === false && <span className="badge badge-amber">Belum terbantu</span>}<span className="muted-sm">{timeAgo(f.created_at)}</span></div>
                <p style={{ fontSize: 13.5, color: 'var(--slate)', marginTop: 5 }}>"{f.message}"</p>
              </div>
            ))}
        </div>
      </div>
    </>
  )
}
