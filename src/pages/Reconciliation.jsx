import { useEffect, useMemo, useState } from 'react'
import { fetchTransactions, deleteTransaction, updateTransaction } from '../lib/api'
import { findDuplicateGroups } from '../lib/analytics'
import { rupiah, fmtDateTime } from '../lib/format'
import { CheckCircle2 } from 'lucide-react'
import { useCatalog } from '../context/CatalogContext'
import { useLang } from '../context/LangContext'

export default function Reconciliation() {
  const { channelLabel } = useCatalog()
  const { t } = useLang()
  const r = t.recon
  const [tx, setTx] = useState(null)
  const [tol, setTol] = useState(24)

  const load = () => fetchTransactions().then(setTx).catch(() => setTx([]))
  useEffect(() => { load() }, [])

  const groups = useMemo(() => {
    if (!tx) return []
    const active = tx.filter((t2) => !t2.dismissed_dup)
    return findDuplicateGroups(active, tol)
  }, [tx, tol])

  const keepOne = async (group, keepId) => {
    if (!confirm(`${r.mergeA} ${group.length} ${r.mergeB} ${group.length - 1} ${r.mergeC}`)) return
    const toDelete = group.filter((g) => g.id !== keepId)
    await Promise.all(toDelete.map((g) => deleteTransaction(g.id)))
    setTx((prev) => prev.filter((t2) => !toDelete.some((dd) => dd.id === t2.id)))
  }

  const dismiss = async (group) => {
    await Promise.all(group.map((g) => updateTransaction(g.id, { dismissed_dup: true })))
    setTx((prev) => prev.map((t2) => group.some((g) => g.id === t2.id) ? { ...t2, dismissed_dup: true } : t2))
  }

  if (!tx) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <h3 className="card-title">{r.title}</h3>
        <div className="card-sub">{r.sub}</div>
        <div className="flex gap" style={{ alignItems: 'center' }}>
          <label className="muted-sm">{r.tol}</label>
          <select className="input" style={{ width: 'auto' }} value={tol} onChange={(e) => setTol(Number(e.target.value))} aria-label="Toleransi selisih waktu duplikat">
            <option value={1}>{r.h1}</option>
            <option value={6}>{r.h6}</option>
            <option value={24}>{r.d1}</option>
            <option value={72}>{r.d3}</option>
          </select>
          <span className="badge badge-indigo">{groups.length} {r.suspected}</span>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee"><CheckCircle2 size={36} style={{ color: 'var(--green)' }} /></div>
          <h3>{r.noneTitle}</h3>
          <p>{r.noneDesc}</p>
        </div></div>
      ) : (
        groups.map((group, gi) => (
          <div className="recon-group" key={gi}>
            <div className="rg-head">
              <span className="badge badge-amber">{r.groupA} {rupiah(group[0].amount)} ({group.length} {r.groupB})</span>
            </div>
            {group.map((t2) => (
              <div className="recon-row" key={t2.id}>
                <span className="pill pill-ch">{channelLabel(t2.channel)}</span>
                <div className="rr-main">
                  <div className="rr-t">{t2.description}</div>
                  <div className="rr-m">{fmtDateTime(t2.occurred_at)} · {t2.category}</div>
                </div>
                <span className={t2.direction === 'in' ? 'amt-in' : 'amt-out'}>
                  {t2.direction === 'in' ? '+' : '-'}{rupiah(t2.amount)}
                </span>
                <button className="btn btn-ghost" style={{ padding: '7px 12px', fontSize: 13 }}
                  onClick={() => keepOne(group, t2.id)}>{r.keepThis}</button>
              </div>
            ))}
            <div className="flex gap mt">
              <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => dismiss(group)}>{r.notDup}</button>
            </div>
          </div>
        ))
      )}
    </>
  )
}
