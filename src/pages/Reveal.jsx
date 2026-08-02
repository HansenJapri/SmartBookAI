import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { fetchTransactions, fetchProfile } from '../lib/api'
import { rupiah, rupiahShort, monthKey } from '../lib/format'
import { Search, FileDown } from 'lucide-react'
import { revealLeak } from '../lib/reveal'
import { downloadLeakReport } from '../lib/leakReport'
import { useLang } from '../context/LangContext'

// `demoTx` dipakai rute publik /demo: bila diisi, transaksi datang langsung
// dari state dan fetchTransactions() TIDAK PERNAH dipanggil — mode demo tidak
// menyentuh database sama sekali, baik baca maupun tulis.
export default function Reveal({ demoTx = null }) {
  const { t } = useLang()
  const rev = t.reveal
  const [tx, setTx] = useState(null)
  const [period, setPeriod] = useState('all')
  const [copied, setCopied] = useState(false)
  const [profile, setProfile] = useState(null)
  const [unduh, setUnduh] = useState(false)
  const demo = demoTx !== null

  useEffect(() => {
    if (demoTx) { setTx(demoTx); return }
    fetchTransactions().then(setTx).catch(() => setTx([]))
  }, [demoTx])

  // Profil hanya diambil di mode ter-login. Mode demo memakai nama usaha fiktif
  // supaya rute publik /demo tetap nol query ke database.
  useEffect(() => {
    if (demoTx) return
    fetchProfile().then(setProfile).catch(() => {})
  }, [demoTx])

  const ml = (k) => { const [y, m] = k.split('-'); return `${t.common.months[Number(m) - 1]} ${y}` }

  const months = useMemo(() => {
    if (!tx) return []
    return [...new Set(tx.map((x) => monthKey(x.occurred_at)))].sort().reverse()
  }, [tx])

  const r = useMemo(() => (tx ? revealLeak(tx, period) : null), [tx, period])

  if (!tx) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const marginAsliPct = Math.round(r.marginAsli * 1000) / 10
  const marginDikiraPct = Math.round(r.marginDikira * 1000) / 10
  const insight = r.grossOmzet
    ? rev.insightTpl.replace('{gross}', rupiah(r.grossOmzet)).replace('{net}', rupiah(r.netReceived))
        .replace('{leak}', rupiah(r.leak)).replace('{a}', marginAsliPct).replace('{d}', marginDikiraPct)
    : rev.insightEmpty
  const chartData = r.perChannel.filter((c) => c.fee > 0).map((c) => ({ name: c.name, value: Math.round(c.fee) }))
  const leakPct = r.grossOmzet ? Math.round((r.leak / r.grossOmzet) * 100) : 0

  const copy = async () => {
    try { await navigator.clipboard.writeText(insight); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* abaikan */ }
  }

  const bizName = demo ? t.demo.bizName : (profile?.business_name || t.app.business)

  const unduhPdf = async () => {
    setUnduh(true)
    try {
      await downloadLeakReport({
        reveal: r,
        bizName,
        periodLabel: period === 'all' ? t.common.allPeriods : ml(period),
        periodeFile: period,
      })
    } finally { setUnduh(false) }
  }

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="flex between gap" style={{ flexWrap: 'wrap' }}>
          <div>
            <h3 className="card-title">{rev.title}</h3>
            <div className="card-sub">{rev.sub}</div>
          </div>
          <div className="flex gap" style={{ alignItems: 'center' }}>
            <label className="muted-sm">{rev.period}</label>
            <select className="input" style={{ width: 'auto' }} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Pilih periode analisis">
              <option value="all">{t.common.allPeriods}</option>
              {months.map((m) => <option key={m} value={m}>{ml(m)}</option>)}
            </select>
          </div>
        </div>
      </div>

      {r.grossOmzet === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee"><Search size={36} /></div>
          <h3>{rev.emptyTitle}</h3>
          <p>{rev.emptyDesc}</p>
          <Link to="/app/import" className="btn btn-primary">{rev.importBtn}</Link>
        </div></div>
      ) : (
        <>
          <div className="grid-kpi">
            <div className="card">
              <div className="kpi-l">{rev.kGross}</div>
              <div className="kpi-v">{rupiahShort(r.grossOmzet)}</div>
              <div className="kpi-d muted-sm" style={{ color: 'var(--muted)' }}>{rev.kGrossSub}</div>
            </div>
            <div className="card">
              <div className="kpi-l">{rev.kLeak}</div>
              <div className="kpi-v" style={{ color: 'var(--red)' }}>{rupiahShort(r.leak)}</div>
              <div className="kpi-d down">{leakPct}% {rev.leakPctSuffix}</div>
            </div>
            <div className="card">
              <div className="kpi-l">{rev.kNet}</div>
              <div className="kpi-v" style={{ color: 'var(--green)' }}>{rupiahShort(r.netReceived)}</div>
              <div className="kpi-d muted-sm" style={{ color: 'var(--muted)' }}>{rev.kNetSub}</div>
            </div>
            <div className="card">
              <div className="kpi-l">{rev.kMargin}</div>
              <div className="kpi-v">{marginAsliPct}%</div>
              <div className="kpi-d down">{rev.marginDikira} {marginDikiraPct}%</div>
            </div>
          </div>

          <div className="card card-pad mt" style={{ background: 'var(--amber-50)', border: '1px solid rgba(245, 158, 11, 0.45)' }}>
            <div className="flex between gap" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div className="card-title" style={{ marginBottom: 6 }}>{rev.summaryTitle}</div>
                <div style={{ fontSize: 15, lineHeight: 1.55 }}>{insight}</div>
              </div>
              <div className="flex gap" style={{ flexWrap: 'wrap' }}>
                <button className="btn btn-ghost" onClick={copy}>{copied ? rev.copied : rev.copy}</button>
                <button className="btn btn-primary" onClick={unduhPdf} disabled={unduh}>
                  <FileDown size={16} aria-hidden="true" /> {unduh ? rev.pdfBusy : rev.pdfBtn}
                </button>
              </div>
            </div>
          </div>

          <div className="two-col mt">
            <div className="card card-pad">
              <h3 className="card-title">{rev.perChTitle}</h3>
              <div className="card-sub">{rev.perChSub}</div>
              {chartData.length === 0 ? <p className="muted-sm">{rev.noChFee}</p> : (
                <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 46)}>
                  <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => rupiahShort(v).replace('Rp ', '')} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => rupiah(v)} contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }} />
                    <Bar dataKey="value" fill="#f43f5e" radius={[0, 6, 6, 0]} barSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="card card-pad">
              <h3 className="card-title">{rev.detailTitle}</h3>
              <div className="card-sub">{rev.detailSub}</div>
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{rev.thChannel}</th>
                      <th style={{ textAlign: 'right' }}>{rev.thOmzet}</th>
                      <th style={{ textAlign: 'right' }}>{rev.thPotongan}</th>
                      <th style={{ textAlign: 'right' }}>{rev.thBersih}</th>
                      <th style={{ textAlign: 'right' }}>{rev.thPct}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.perChannel.map((c) => (
                      <tr key={c.channel}>
                        <td>{c.name}</td>
                        <td style={{ textAlign: 'right' }}>{rupiah(c.gross)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--red)' }}>{c.fee ? '-' + rupiah(c.fee) : '-'}</td>
                        <td style={{ textAlign: 'right' }}>{rupiah(c.net)}</td>
                        <td style={{ textAlign: 'right' }}>{Math.round(c.pct * 100)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card card-pad mt">
            <h3 className="card-title">{rev.breakdownTitle}</h3>
            <div className="flex gap mt" style={{ flexWrap: 'wrap' }}>
              <span className="badge badge-amber">{rev.bAdmin} {rupiah(r.feeAdmin)}</span>
              <span className="badge badge-amber">{rev.bOngkir} {rupiah(r.feeOngkir)}</span>
              <span className="badge badge-amber">{rev.bIklan} {rupiah(r.feeIklan)}</span>
              <span className="badge badge-indigo">{rev.bOpex} {rupiah(r.opex)}</span>
            </div>
            <div className="flex gap mt" style={{ flexWrap: 'wrap' }}>
              <span className="badge badge-green">{rev.bLabaAsli} {rupiah(r.labaAsli)}</span>
              <span className="badge">{rev.bLabaDikira} {rupiah(r.labaDikira)}</span>
            </div>
            <p className="muted-sm mt">
              {/* Di mode demo pengunjung belum punya akun, jadi tautan ke halaman
                  terlindungi diganti teks biasa agar tidak memantul ke /masuk. */}
              {rev.footA} {demo ? rev.footRecon : <Link to="/app/rekonsiliasi">{rev.footRecon}</Link>} {rev.footB}
            </p>
          </div>
        </>
      )}
    </>
  )
}
