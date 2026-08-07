import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Search, ArrowDownCircle, ArrowUpCircle, ClipboardCheck,
  Calendar, History as HistoryIcon,
} from 'lucide-react'
import { fetchProducts, fetchTransactions, fetchStockHistorySources } from '../lib/api'
import { rupiah, fmtDateTime } from '../lib/format'
import { useLang } from '../context/LangContext'
import { BATAS_DATE, bersihkanTanggal } from '../lib/dateInput'
import './stok.css'
import './stok-histori.css'

// Halaman histori pergerakan stok — menggabungkan 3 sumber:
//   1. transactions dengan product_id (penjualan → stok turun; refund → stok naik)
//   2. purchase_orders yang sudah 'received' (stok bertambah)
//   3. stock_opnames yang sudah 'posted' (penyesuaian manual)
// Semua diurut menurun berdasarkan waktu.

export default function StokHistori() {
  const { t } = useLang()
  const sh = t.stokHistori
  const TYPE_META = {
    penjualan: { label: sh.typeSale, tag: 's2h-tag-out', ic: ArrowDownCircle, sign: '-' },
    pembelian: { label: sh.typePurchase, tag: 's2h-tag-in', ic: ArrowUpCircle, sign: '+' },
    opname:    { label: sh.typeOpname, tag: 's2h-tag-adj', ic: ClipboardCheck, sign: '±' },
  }
  const [rows, setRows] = useState(null)
  const [products, setProducts] = useState([])
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [prodFilter, setProdFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const rootRef = useRef(null)
  useEffect(() => {
    if (!rootRef.current || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target) }
    }, { threshold: 0.1 })
    rootRef.current.querySelectorAll('.s2-rv').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [rows])

  useEffect(() => {
    (async () => {
      try {
        const [prods, txs, sources] = await Promise.all([
          fetchProducts(),
          fetchTransactions(),
          fetchStockHistorySources(),
        ])
        const poRes = { data: sources.purchaseOrders }
        const opRes = { data: sources.opnames }
        const prodMap = new Map(prods.map((p) => [p.id, p]))
        setProducts(prods)

        const list = []

        for (const t of txs || []) {
          if (!t.product_id) continue
          list.push({
            id: `tx-${t.id}`,
            at: t.occurred_at,
            type: t.direction === 'in' ? 'penjualan' : 'pembelian',
            product: prodMap.get(t.product_id) || { name: sh.deletedProduct, unit: '' },
            qty: Number(t.qty) || 0,
            amount: Number(t.amount) || 0,
            ref: t.description || '',
          })
        }

        for (const po of (poRes.data || [])) {
          if (po.status !== 'received') continue
          list.push({
            id: `po-${po.id}`,
            at: po.received_at || po.created_at,
            type: 'pembelian',
            product: prodMap.get(po.product_id) || { name: sh.deletedProduct, unit: '' },
            qty: Number(po.qty) || 0,
            amount: (Number(po.qty) || 0) * (Number(po.unit_price) || 0),
            ref: po.po_number,
          })
        }

        for (const op of (opRes.data || [])) {
          const items = Array.isArray(op.items) ? op.items : []
          for (const it of items) {
            const diff = Number(it.new_stock ?? it.count ?? 0) - Number(it.old_stock ?? it.expected ?? 0)
            if (!diff) continue
            list.push({
              id: `op-${op.id}-${it.product_id}`,
              at: op.posted_at || op.created_at,
              type: 'opname',
              product: prodMap.get(it.product_id) || { name: sh.deletedProduct, unit: '' },
              qty: Math.abs(diff),
              qty_signed: diff,
              amount: 0,
              ref: op.opname_number,
            })
          }
        }

        list.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        setRows(list)
      } catch { setRows([]) }
    })()
  }, [])

  const filtered = useMemo(() => {
    if (!rows) return []
    const fromTs = from ? new Date(from + 'T00:00:00').getTime() : null
    const toTs = to ? new Date(to + 'T23:59:59').getTime() : null
    return rows.filter((r) => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false
      if (prodFilter && r.product?.id !== prodFilter) return false
      const ts = new Date(r.at).getTime()
      if (fromTs && ts < fromTs) return false
      if (toTs && ts > toTs) return false
      if (q) {
        const hay = `${r.product?.name || ''} ${r.ref || ''}`.toLowerCase()
        if (!hay.includes(q.toLowerCase())) return false
      }
      return true
    })
  }, [rows, typeFilter, prodFilter, q, from, to])

  const totals = useMemo(() => {
    const t = { masuk: 0, keluar: 0, adj: 0 }
    for (const r of filtered) {
      if (r.type === 'pembelian') t.masuk += r.qty
      else if (r.type === 'penjualan') t.keluar += r.qty
      else t.adj += Math.abs(r.qty_signed || r.qty || 0)
    }
    return t
  }, [filtered])

  if (!rows) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <div className="s2" ref={rootRef}>
      <div className="s2-head s2-rv">
        <div>
          <span className="s2-eyebrow"><HistoryIcon size={16} />{sh.eyebrow}</span>
          <h1>{sh.title}</h1>
          <p>{sh.subtitle}</p>
        </div>
        <div className="s2-head-actions">
          <Link to="/app/stok" className="s2-btn-outline"><ArrowLeft size={16} />{sh.backToStock}</Link>
        </div>
      </div>

      {/* Ringkasan */}
      <div className="s2-kpi-grid s2h-summary s2-rv">
        <div className="s2-kpi s2-kpi-primary">
          <div className="s2-kpi-ic s2-kpi-ic-primary"><ArrowUpCircle size={20} /></div>
          <div><p className="s2-kpi-l">{sh.kpiIn}</p><p className="s2-kpi-v">{Math.round(totals.masuk)}</p></div>
        </div>
        <div className="s2-kpi s2-kpi-secondary">
          <div className="s2-kpi-ic s2-kpi-ic-secondary"><ArrowDownCircle size={20} /></div>
          <div><p className="s2-kpi-l">{sh.kpiOut}</p><p className="s2-kpi-v">{Math.round(totals.keluar)}</p></div>
        </div>
        <div className="s2-kpi s2-kpi-tertiary">
          <div className="s2-kpi-ic s2-kpi-ic-tertiary"><ClipboardCheck size={20} /></div>
          <div><p className="s2-kpi-l">{sh.kpiAdj}</p><p className="s2-kpi-v">{Math.round(totals.adj)}</p></div>
        </div>
        <div className="s2-kpi s2-kpi-primary">
          <div className="s2-kpi-ic s2-kpi-ic-primary"><HistoryIcon size={20} /></div>
          <div><p className="s2-kpi-l">{sh.kpiTotalRows}</p><p className="s2-kpi-v">{filtered.length}</p></div>
        </div>
      </div>

      {/* Filter */}
      <div className="s2-log s2-rv">
        <div className="s2-log-head">
          <div>
            <h3>{sh.filterTitle}</h3>
            <p>{sh.filterSub}</p>
          </div>
        </div>
        <div className="s2h-filters">
          <label className="s2-search">
            <Search size={16} aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={sh.searchPh} aria-label={sh.searchAria} />
          </label>
          <select className="s2-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label={sh.typeAria}>
            <option value="all">{sh.allTypes}</option>
            <option value="pembelian">{sh.typePurchase}</option>
            <option value="penjualan">{sh.typeSale}</option>
            <option value="opname">{sh.typeOpname}</option>
          </select>
          <select className="s2-select" value={prodFilter} onChange={(e) => setProdFilter(e.target.value)} aria-label={sh.productAria}>
            <option value="">{sh.allProducts}</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label className="s2h-date">
            <Calendar size={14} aria-hidden="true" />
            <input type="date" {...BATAS_DATE} value={from} onChange={(e) => setFrom(bersihkanTanggal(e.target.value))} aria-label={sh.fromAria} />
            <span>—</span>
            <input type="date" {...BATAS_DATE} value={to} onChange={(e) => setTo(bersihkanTanggal(e.target.value))} aria-label={sh.toAria} />
          </label>
        </div>
      </div>

      {/* Tabel histori */}
      <div className="s2-log s2-rv">
        <div className="s2-log-wrap">
          <table className="s2-log-tbl">
            <thead>
              <tr>
                <th>{sh.thTime}</th>
                <th>{sh.thProduct}</th>
                <th>{sh.thType}</th>
                <th>{sh.thQty}</th>
                <th className="s2-right">{sh.thAmount}</th>
                <th>{sh.thRef}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--s2-on-surface-variant)' }}>
                  {sh.emptyHistory}
                </td></tr>
              ) : filtered.map((r) => {
                const meta = TYPE_META[r.type]
                const Ic = meta.ic
                const signed = r.type === 'opname' ? r.qty_signed : (r.type === 'penjualan' ? -r.qty : r.qty)
                return (
                  <tr key={r.id}>
                    <td style={{ color: 'var(--s2-on-surface-variant)', whiteSpace: 'nowrap' }}>{fmtDateTime(r.at)}</td>
                    <td><div className="s2-log-prod"><div className="s2-log-prod-ic">{r.product?.image_url ? <img src={r.product.image_url} alt="" /> : <Ic size={18} />}</div><b>{r.product?.name || '—'}</b></div></td>
                    <td><span className={`s2h-tag ${meta.tag}`}><Ic size={12} />{meta.label}</span></td>
                    <td className={`s2-log-stock ${signed < 0 ? 's2-log-stock-danger' : ''}`}>
                      {meta.sign === '±' ? (signed > 0 ? `+${signed}` : signed) : `${meta.sign}${r.qty}`} {r.product?.unit || ''}
                    </td>
                    <td className="s2-right" style={{ fontWeight: 600 }}>{r.amount > 0 ? rupiah(r.amount) : '—'}</td>
                    <td className="s2-log-sku">{r.ref || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
