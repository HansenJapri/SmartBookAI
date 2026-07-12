import { useEffect, useMemo, useState } from 'react'
import {
  fetchTransactions, addTransaction, updateTransaction, deleteTransaction, fetchRules, getReceiptUrl, fetchProfile,
  applyStockForLines,
} from '../lib/api'
import { rupiah, fmtDateTime } from '../lib/format'
import { Pencil, Trash2, Paperclip, Wallet } from 'lucide-react'
import TransactionModal from '../components/TransactionModal'
import InvoiceModal from '../components/InvoiceModal'
import { useCatalog } from '../context/CatalogContext'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'

export default function Transactions() {
  const { channelLabel } = useCatalog()
  const { user } = useAuth()
  const { t } = useLang()
  const T = t.tx
  const [tx, setTx] = useState(null)
  const [rules, setRules] = useState([])
  const [profile, setProfile] = useState(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [payFilter, setPayFilter] = useState('all')
  const [modal, setModal] = useState(null)
  const [invoiceTx, setInvoiceTx] = useState(null)
  const [stockMsg, setStockMsg] = useState('')

  const load = () => fetchTransactions().then(setTx).catch(() => setTx([]))
  useEffect(() => {
    load()
    fetchRules().then(setRules).catch(() => {})
    fetchProfile().then(setProfile).catch(() => {})
  }, [])

  const filtered = useMemo(() => {
    if (!tx) return []
    return tx.filter((t2) => {
      if (filter === 'in' && t2.direction !== 'in') return false
      if (filter === 'out' && t2.direction !== 'out') return false
      if (payFilter !== 'all' && (t2.payment_status || 'lunas') !== payFilter) return false
      if (q && !(`${t2.description} ${t2.category}`.toLowerCase().includes(q.toLowerCase()))) return false
      return true
    })
  }, [tx, q, filter, payFilter])

  const save = async (payload, meta = {}) => {
    setStockMsg('')
    if (modal?.id) {
      const updated = await updateTransaction(modal.id, payload)
      setTx((prev) => prev.map((t2) => (t2.id === updated.id ? updated : t2)))
    } else {
      const created = await addTransaction(payload)
      setTx((prev) => [created, ...prev])
      // Sambungkan ke stok: baris produk otomatis mengurangi (jual) / menambah (beli) stok.
      if (meta.isNew && meta.lines?.length) {
        try {
          const changes = await applyStockForLines(meta.lines, meta.direction)
          if (changes.length) {
            setStockMsg('Stok diperbarui — ' + changes.map((c) => `${c.name}: ${c.before} → ${c.after} ${c.unit}`).join('; '))
          }
        } catch { /* transaksi tetap tersimpan meski update stok gagal */ }
      }
    }
  }

  const remove = async (id) => {
    if (!confirm(T.confirmDel)) return
    await deleteTransaction(id)
    setTx((prev) => prev.filter((t2) => t2.id !== id))
  }

  const openReceipt = async (path) => {
    try {
      const url = await getReceiptUrl(path)
      if (url) window.open(url, '_blank')
    } catch (e) { alert(T.openReceiptErr + e.message) }
  }

  if (!tx) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <>
      {stockMsg && (
        <div className="alert alert-ok" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <span>{stockMsg}</span>
          <button className="icon-btn" onClick={() => setStockMsg('')} aria-label="Tutup">✕</button>
        </div>
      )}
      <div className="toolbar">
        <input className="input" placeholder={T.searchPh} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ maxWidth: 180 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">{T.allTx}</option>
          <option value="in">{T.income}</option>
          <option value="out">{T.expense}</option>
        </select>
        <select className="input" style={{ maxWidth: 180 }} value={payFilter} onChange={(e) => setPayFilter(e.target.value)}>
          <option value="all">{T.allPay}</option>
          <option value="lunas">{T.lunas}</option>
          <option value="belum">{T.belum}</option>
        </select>
        <button className="btn btn-primary" onClick={() => setModal({})}>{T.add}</button>
      </div>

      {filtered.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee"><Wallet size={36} /></div>
          <h3>{tx.length === 0 ? T.emptyNoTx : T.emptyNoResult}</h3>
          <p>{tx.length === 0 ? T.emptyNoTxDesc : T.emptyNoResultDesc}</p>
          {tx.length === 0 && <button className="btn btn-primary" onClick={() => setModal({})}>{T.addTx}</button>}
        </div></div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>{T.thDate}</th><th>{T.thType}</th><th>{T.thDesc}</th><th>{T.thChannel}</th><th>{T.thCat}</th>
                <th>{T.thStatus}</th><th>{T.thAmount}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t2) => (
                <tr key={t2.id}>
                  <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(t2.occurred_at)}</td>
                  <td>
                    {t2.direction === 'in'
                      ? <span className="tx-type tx-type-in">{T.typeIn}</span>
                      : <span className="tx-type tx-type-out">{T.typeOut}</span>}
                  </td>
                  <td>
                    <b>{t2.description}</b>
                    {t2.receipt_url && (
                      <button className="linklike" style={{ marginLeft: 8, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 3 }} title={T.viewReceipt}
                        onClick={() => openReceipt(t2.receipt_url)}><Paperclip size={12} /> {T.receipt}</button>
                    )}
                  </td>
                  <td><span className="pill pill-ch">{channelLabel(t2.channel)}</span></td>
                  <td><span className="pill pill-cat">{t2.category}</span></td>
                  <td>
                    <span className={`pay-badge ${t2.payment_status === 'belum' ? 'pay-belum' : 'pay-lunas'}`}>{t2.payment_status === 'belum' ? T.payBelum : T.payLunas}</span>
                  </td>
                  <td className={t2.direction === 'in' ? 'amt-in' : 'amt-out'}>
                    {t2.direction === 'in' ? '+' : '-'}{rupiah(t2.amount)}
                  </td>
                  <td>
                    <div className="row-actions">
                      {t2.direction === 'in' && (
                        <button className="linklike" title={T.invoiceTitle} onClick={() => setInvoiceTx(t2)}>{T.invoice}</button>
                      )}
                      <button className="icon-btn" title={T.edit} aria-label={T.edit} onClick={() => setModal(t2)}><Pencil size={15} /></button>
                      <button className="icon-btn danger" title={T.del} aria-label={T.del} onClick={() => remove(t2.id)}><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted-sm mt">{T.showingA} {filtered.length} {T.showingB} {tx.length} {T.showingC}</p>

      {modal && (
        <TransactionModal
          initial={modal.id ? modal : null}
          rules={rules}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}

      {invoiceTx && (
        <InvoiceModal tx={invoiceTx} profile={profile} onClose={() => setInvoiceTx(null)} />
      )}
    </>
  )
}
