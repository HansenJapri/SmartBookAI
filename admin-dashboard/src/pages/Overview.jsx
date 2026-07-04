import { useEffect, useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { getMetrics, listUsers, listTransactions, listFeedback, subscribe } from '../lib/adminApi'
import { rupiahShort, rupiah, num, timeAgo, dayKey } from '../lib/format'
import { Kpi, Stars, StatusBadge, Spinner } from '../components/ui'

function bucketByDay(rows, dateField, days = 30) {
  const map = {}
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000)
    map[dayKey(d)] = 0
  }
  for (const r of rows) {
    const k = dayKey(r[dateField])
    if (k in map) map[k] += 1
  }
  return Object.entries(map).map(([k, v]) => ({ day: k.slice(5), value: v }))
}

export default function Overview() {
  const [m, setM] = useState(null)
  const [users, setUsers] = useState([])
  const [tx, setTx] = useState([])
  const [fb, setFb] = useState([])

  const load = useCallback(async () => {
    const [metrics, u, t, f] = await Promise.all([
      getMetrics(), listUsers(), listTransactions({ limit: 4000 }), listFeedback({ limit: 300 }),
    ])
    setM(metrics); setUsers(u); setTx(t); setFb(f)
  }, [])

  useEffect(() => {
    load().catch((e) => { console.error(e); setM({}) })
    const unsub = [
      subscribe('feedback', load), subscribe('transactions', load), subscribe('profiles', load),
    ]
    return () => unsub.forEach((fn) => fn())
  }, [load])

  const signupTrend = useMemo(() => bucketByDay(users, 'created_at', 30), [users])
  const txTrend = useMemo(() => bucketByDay(tx, 'occurred_at', 30), [tx])

  if (!m) return <Spinner />

  const helpedTot = (m.helped_yes || 0) + (m.helped_no || 0)
  const helpedPct = helpedTot ? Math.round((m.helped_yes / helpedTot) * 100) : null
  const adoption = m.total_users ? Math.round((m.active_users_30d / m.total_users) * 100) : 0

  return (
    <>
      <div className="kpi-grid">
        <Kpi icon="👥" label="Total Pengguna" value={num(m.total_users)}
          delta={`+${num(m.new_users_7d)} dalam 7 hari`} deltaDir={m.new_users_7d ? 'up' : ''} />
        <Kpi icon="⚡" label="Aktif (30 hari)" value={num(m.active_users_30d)}
          delta={`${adoption}% dari total · adopsi`} />
        <Kpi icon="🧾" label="Total Transaksi" value={num(m.total_transactions)}
          delta={`${num(m.power_users)} power user (≥10 tx)`} />
        <Kpi icon="💰" label="Total Nilai Dicatat" value={rupiahShort(m.total_volume)}
          delta={`${rupiahShort(m.volume_30d)} dalam 30 hari`} />
        <Kpi icon="⭐" label="Kepuasan Rata-rata" value={m.avg_rating ? `${m.avg_rating} / 5` : '-'}
          delta={`${num(m.rating_count)} penilaian`} />
        <Kpi icon="✅" label="Merasa Terbantu" value={helpedPct != null ? `${helpedPct}%` : '-'}
          delta={`${num(m.helped_yes)} ya · ${num(m.helped_no)} belum`} deltaDir={helpedPct >= 50 ? 'up' : ''} />
      </div>

      <div className="grid-2 mt">
        <div className="card">
          <div className="card-title">Pendaftaran Pengguna</div>
          <div className="card-sub">30 hari terakhir · {num(m.new_users_30d)} pengguna baru</div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={signupTrend} margin={{ left: -18, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="gU" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }} interval={4} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={32} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }} />
              <Area type="monotone" dataKey="value" name="Pengguna baru" stroke="#4f46e5" strokeWidth={2.5} fill="url(#gU)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-title">Aktivitas Transaksi</div>
          <div className="card-sub">Transaksi dicatat per hari (30 hari)</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={txTrend} margin={{ left: -18, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }} interval={4} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={32} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }} />
              <Bar dataKey="value" name="Transaksi" fill="#0ea5e9" radius={[5, 5, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card mt">
        <div className="flex between center">
          <div>
            <div className="card-title">Masukan Terbaru</div>
            <div className="card-sub">{num(m.feedback_open)} menunggu ditanggapi</div>
          </div>
          <Link to="/feedback" className="btn btn-ghost btn-sm">Lihat semua →</Link>
        </div>
        {fb.length === 0 ? (
          <div className="empty"><div className="ee">💬</div><p>Belum ada feedback.</p></div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {fb.slice(0, 5).map((f) => (
              <div key={f.id} className="flex between center" style={{ padding: '10px 0', borderTop: '1px solid #f1f5f9', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="flex gap center wrap">
                    <b style={{ fontSize: 13.5 }}>{f.author_name || 'Pengguna'}</b>
                    {f.rating ? <Stars value={f.rating} /> : null}
                    <StatusBadge status={f.status} />
                  </div>
                  <div className="muted-sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 520 }}>{f.message}</div>
                </div>
                <span className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{timeAgo(f.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
