import { useEffect, useMemo, useState } from 'react'
import { HandCoins, MessageCircle, CheckCircle2 } from 'lucide-react'
import { fetchUnpaid, updateTransaction, fetchProfile } from '../lib/api'
import GagalMuat from '../components/GagalMuat'
import { useAsyncData } from '../lib/useAsyncData'
import {
  daysOutstanding, isOverdue, agingBucketKey, buildAgingSummary, AGING_BUCKETS, waReminderLink,
} from '../lib/aging'
import { rupiah, rupiahShort, fmtDate } from '../lib/format'
import { useLang } from '../context/LangContext'
import { useAlert } from '../context/AlertContext'

// Piutang & Utang: semua transaksi berstatus "belum lunas".
//   Piutang = pemasukan yang uangnya belum diterima (tagihan ke pelanggan)
//   Utang   = pengeluaran yang belum dibayar (kewajiban ke pemasok/pihak lain)
// Umur tagihan dihitung deterministik dari tanggal transaksi; jatuh tempo dari due_date.
export default function Receivables() {
  const { t } = useLang()
  const { showConfirm } = useAlert()
  const rc = t.receivables
  const [profile, setProfile] = useState(null)
  const [tab, setTab] = useState('in') // 'in' = piutang, 'out' = utang
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [menandai, setMenandai] = useState('')

  // Diambil TERFILTER dari server (fetchUnpaid), bukan seluruh transaksi lalu
  // disaring di sini: plafon 5.000 baris memotong dari yang terbaru ke belakang,
  // jadi cara lama membuat tagihan paling lama justru yang pertama hilang.
  const { data: tx, galat, muatUlang, setData: setTx } = useAsyncData(fetchUnpaid, [])

  useEffect(() => { fetchProfile().then(setProfile).catch(() => {}) }, [])

  const unpaid = useMemo(() => tx || [], [tx])
  const piutang = useMemo(() => unpaid.filter((t) => t.direction === 'in'), [unpaid])
  const utang = useMemo(() => unpaid.filter((t) => t.direction === 'out'), [unpaid])
  const rows = tab === 'in' ? piutang : utang

  const today = new Date()
  const sumIn = useMemo(() => buildAgingSummary(piutang, today), [piutang]) // eslint-disable-line
  const sumOut = useMemo(() => buildAgingSummary(utang, today), [utang]) // eslint-disable-line
  const active = tab === 'in' ? sumIn : sumOut

  const markPaid = async (t) => {
    if (menandai) return // penjaga ketukan ganda di layar sentuh
    const who = t.customer_name ? rc.fromWho.replace('{name}', t.customer_name) : ''
    if (!await showConfirm({ message: rc.confirmMarkPaid.replace('{amount}', rupiah(t.amount)).replace('{who}', who).replace('{desc}', t.description) })) return
    setErr(''); setMenandai(t.id)
    try {
      const upd = await updateTransaction(t.id, { payment_status: 'lunas' })
      // Baris yang sudah lunas keluar dari daftar ini menurut definisinya.
      setTx((prev) => (prev || []).filter((x) => x.id !== upd.id))
      setMsg(rc.paidMsg.replace('{amount}', rupiah(t.amount)).replace('{desc}', t.description))
    } catch (e) { setErr(e.message) }
    finally { setMenandai('') }
  }

  // Gagal memuat TIDAK boleh tampil sebagai "tidak ada tagihan": pemilik usaha
  // yang menyimpulkan piutangnya nol berhenti menagih.
  if (galat && !tx) return <GagalMuat galat={galat} onRetry={muatUlang} />
  if (!tx) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <>
      {msg && (
        <div className="alert alert-ok" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{msg}</span>
          <button className="icon-btn" onClick={() => setMsg('')} aria-label={rc.close}>✕</button>
        </div>
      )}
      {err && <div className="alert alert-err">{err}</div>}

      {/* KPI ringkas: posisi piutang, utang, dan yang lewat jatuh tempo */}
      <div className="grid-kpi" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="card">
          <div className="kpi-l">{rc.kpiReceivable}</div>
          <div className="kpi-v amt-in">{rupiahShort(sumIn.total)}</div>
          <div className="kpi-d muted-sm">{rc.kpiReceivableSub.replace('{n}', sumIn.count)}</div>
        </div>
        <div className="card">
          <div className="kpi-l">{rc.kpiPayable}</div>
          <div className="kpi-v amt-out">{rupiahShort(sumOut.total)}</div>
          <div className="kpi-d muted-sm">{rc.kpiPayableSub.replace('{n}', sumOut.count)}</div>
        </div>
        <div className="card">
          <div className="kpi-l">{rc.kpiOverdue}</div>
          <div className="kpi-v" style={{ color: (sumIn.overdueCount + sumOut.overdueCount) > 0 ? 'var(--red)' : 'inherit' }}>
            {sumIn.overdueCount + sumOut.overdueCount}
          </div>
          <div className="kpi-d muted-sm">{rc.kpiOverdueSub.replace('{v}', rupiahShort(sumIn.overdueTotal + sumOut.overdueTotal))}</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="seg" style={{ maxWidth: 360, flex: 1 }}>
          <button type="button" className={tab === 'in' ? 'on-in' : ''} onClick={() => setTab('in')}>
            {rc.tabReceivable} ({sumIn.count})
          </button>
          <button type="button" className={tab === 'out' ? 'on-out' : ''} onClick={() => setTab('out')}>
            {rc.tabPayable} ({sumOut.count})
          </button>
        </div>
      </div>

      {/* Umur tagihan per bucket (deterministik dari tanggal transaksi) */}
      {rows.length > 0 && (
        <div className="scn-chips" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
          {AGING_BUCKETS.map((b) => {
            const cell = active.buckets[b.key]
            return (
              <div className="scn-chip" key={b.key}
                style={cell.count > 0 && (b.key === 'b90' || b.key === 'b90p') ? { borderColor: 'rgba(220,38,38,.45)' } : {}}>
                <span>{rc.agingBuckets[b.key]}</span>
                <b>{cell.count > 0 ? rupiahShort(cell.total) : '-'}</b>
                <span>{cell.count} {rc.billsUnit}</span>
              </div>
            )
          })}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee">{tab === 'in' ? <HandCoins size={36} /> : <CheckCircle2 size={36} />}</div>
          <h3>{tab === 'in' ? rc.emptyReceivableTitle : rc.emptyPayableTitle}</h3>
          <p>
            {tab === 'in' ? rc.emptyReceivableDesc : rc.emptyPayableDesc}
          </p>
        </div></div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>{rc.thDate}</th><th>{rc.thDesc}</th><th>{tab === 'in' ? rc.thCustomer : rc.thSupplier}</th>
              <th>{rc.thAge}</th><th>{rc.thDue}</th><th>{rc.thAmount}</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map((t) => {
                const days = daysOutstanding(t, today)
                const late = isOverdue(t, today)
                const bucket = AGING_BUCKETS.find((b) => b.key === agingBucketKey(days))
                const wa = tab === 'in' ? waReminderLink(t, profile?.business_name || '', rupiah) : ''
                return (
                  <tr key={t.id}>
                    <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDate(t.occurred_at)}</td>
                    <td><b>{t.description}</b></td>
                    <td className="muted-sm">{t.customer_name || '-'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {rc.ageDays.replace('{n}', days)} <span className="pill pill-cat" style={{ marginLeft: 4 }}>{rc.agingBuckets[bucket.key]}</span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {t.due_date
                        ? late
                          ? <span className="badge badge-red">{rc.overdue} · {fmtDate(t.due_date)}</span>
                          : fmtDate(t.due_date)
                        : <span className="muted-sm">-</span>}
                    </td>
                    <td className={tab === 'in' ? 'amt-in' : 'amt-out'}>{rupiah(t.amount)}</td>
                    <td>
                      <div className="row-actions">
                        {wa && (
                          <a className="linklike" href={wa} target="_blank" rel="noreferrer"
                            title={rc.remindTitle}>
                            <MessageCircle size={13} style={{ verticalAlign: '-2px' }} /> {rc.remind}
                          </a>
                        )}
                        <button className="linklike" onClick={() => markPaid(t)} disabled={menandai === t.id}
                          title={tab === 'in' ? rc.markPaidTitleIn : rc.markPaidTitleOut}>
                          {rc.markPaid}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted-sm mt">
        {rc.footerHint}
      </p>
    </>
  )
}
