import { useEffect, useMemo, useState } from 'react'
import { ScrollText, RefreshCw } from 'lucide-react'
import { fetchAuditLogs, fetchStaff } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useLang } from '../context/LangContext'
import { fmtDateTime, rupiah } from '../lib/format'

const ACTION_CLS = { INSERT: 'badge-green', UPDATE: 'badge-amber', DELETE: 'badge-red' }

// Audit Log (owner): rekam jejak permanen siapa-mengubah-apa-kapan.
// Baris ditulis trigger database — aplikasi tidak bisa memalsukan/menghapusnya.
export default function Audit() {
  const { t } = useLang()
  const a = t.audit
  // Ringkasan mudah dibaca dari payload jsonb log.
  const summarize = (log) => {
    const c = log.changed || {}
    if (log.action === 'UPDATE') {
      const parts = Object.entries(c).slice(0, 3).map(([k, v]) => {
        const [oldV, newV] = Array.isArray(v) ? v : [null, v]
        const show = (x) => (x === null || x === undefined ? '-' : typeof x === 'object' ? '(data)' : String(x))
        return `${k}: ${show(oldV)} → ${show(newV)}`
      })
      const extra = Object.keys(c).length > 3 ? ` ${a.moreCols.replace('{n}', Object.keys(c).length - 3)}` : ''
      return parts.join('; ') + extra || a.noColChange
    }
    const name = c.description || c.name || c.po_number || c.opname_number || ''
    const amt = c.amount ? ` — ${rupiah(Number(c.amount))}` : ''
    return `${name}${amt}` || `id ${String(log.row_id || '').slice(0, 8)}`
  }
  const [logs, setLogs] = useState(null)
  const [staff, setStaff] = useState([])
  const [me, setMe] = useState(null)
  const [table, setTable] = useState('')
  const [action, setAction] = useState('')
  const [err, setErr] = useState('')

  const load = () => {
    setErr('')
    fetchAuditLogs({ table, action }).then(setLogs).catch((e) => { setLogs([]); setErr(e.message) })
  }
  useEffect(() => { load() }, [table, action]) // eslint-disable-line
  useEffect(() => {
    fetchStaff().then(setStaff).catch(() => {})
    supabase.auth.getUser().then(({ data }) => setMe(data?.user?.id || null))
  }, [])

  const actorLabel = useMemo(() => (id) => {
    if (!id) return a.actorSystem
    if (id === me) return a.actorYou
    const s = staff.find((x) => x.member_id === id)
    return s?.email || a.actorStaff
  }, [me, staff, a])

  if (!logs) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <>
      {err && <div className="alert alert-err">{err}</div>}
      <div className="toolbar">
        <select className="input" style={{ maxWidth: 200 }} value={table} onChange={(e) => setTable(e.target.value)} aria-label={a.allData}>
          <option value="">{a.allData}</option>
          {Object.entries(a.tables).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" style={{ maxWidth: 160 }} value={action} onChange={(e) => setAction(e.target.value)} aria-label={a.allActions}>
          <option value="">{a.allActions}</option>
          {Object.entries(a.actions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={load}>
          <RefreshCw size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />{a.reload}
        </button>
      </div>

      {logs.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee"><ScrollText size={36} /></div>
          <h3>{a.emptyTitle}</h3>
          <p>{a.emptyDesc}</p>
        </div></div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>{a.thTime}</th><th>{a.thAction}</th><th>{a.thData}</th><th>{a.thSummary}</th><th>{a.thActor}</th></tr></thead>
            <tbody>
              {logs.map((l) => {
                const label = a.actions[l.action] || l.action
                const cls = ACTION_CLS[l.action] || 'badge-indigo'
                return (
                  <tr key={l.id}>
                    <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(l.created_at)}</td>
                    <td><span className={`badge ${cls}`}>{label}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{a.tables[l.table_name] || l.table_name}</td>
                    <td style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis' }}>{summarize(l)}</td>
                    <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{actorLabel(l.actor_id)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted-sm mt">{a.footNote}</p>
    </>
  )
}
