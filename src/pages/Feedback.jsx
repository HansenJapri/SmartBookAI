import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { useAlert } from '../context/AlertContext'
import { fetchFeedback, addFeedback, deleteFeedback } from '../lib/api'
import { fmtDateTime } from '../lib/format'
import { MessageSquare } from 'lucide-react'

const STATUS_CLS = { baru: 'badge-indigo', dibaca: 'badge-amber', ditindaklanjuti: 'badge-amber', selesai: 'badge-green' }

function Stars({ value, onChange, label }) {
  return (
    <div className="flex gap" style={{ gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(n === value ? 0 : n)}
          aria-label={`${n} ${label}`}
          style={{
            fontSize: 26, lineHeight: 1, padding: 0, background: 'none',
            color: n <= value ? '#f59e0b' : 'var(--line-strong)', cursor: 'pointer',
          }}>★</button>
      ))}
    </div>
  )
}

export default function Feedback() {
  const { user } = useAuth()
  const { t } = useLang()
  const { showAlert, showConfirm } = useAlert()
  const f = t.feedback
  const CATS = Object.keys(f.cats).map((v) => ({ v, label: f.cats[v] }))
  const [list, setList] = useState(null)
  const [rating, setRating] = useState(0)
  const [category, setCategory] = useState('saran')
  const [helped, setHelped] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  const load = () => fetchFeedback().then(setList).catch(() => setList([]))
  useEffect(() => { load() }, [])

  const stats = useMemo(() => {
    if (!list || list.length === 0) return null
    const rated = list.filter((x) => x.rating)
    const avg = rated.length ? (rated.reduce((s, x) => s + x.rating, 0) / rated.length) : 0
    const helpedYes = list.filter((x) => x.helped === true).length
    const helpedTot = list.filter((x) => x.helped !== null).length
    return { count: list.length, avg, helpedYes, helpedTot }
  }, [list])

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setOk('')
    if (message.trim().length < 3) { setErr(f.errMin); return }
    setBusy(true)
    try {
      await addFeedback({ rating, category, message, helped })
      setMessage(''); setRating(0); setHelped(null); setCategory('saran')
      setOk(f.okSent)
      await load()
    } catch (e2) {
      setErr(e2.message || f.errFail)
    } finally { setBusy(false) }
  }

  const remove = async (id) => {
    if (!await showConfirm({ message: f.confirmDel, type: 'error' })) return
    try {
      await deleteFeedback(id); await load()
    } catch (e2) {
      showAlert({ type: 'error', title: f.errDelTitle, message: e2?.message || f.errDelete })
    }
  }

  return (
    <>
      <div className="card card-pad">
        <h3 className="card-title">{f.title}</h3>
        <div className="card-sub">
          {f.sub} {stats && (
            <> {f.statsFar} <b>{stats.count}</b> {f.statsInput}
            {stats.avg > 0 && <> · {f.statsAvg} <b>{stats.avg.toFixed(1)}★</b></>}
            {stats.helpedTot > 0 && <> · <b>{Math.round((stats.helpedYes / stats.helpedTot) * 100)}%</b> {f.statsHelped}</>}.</>
          )}
        </div>

        <form onSubmit={submit} style={{ marginTop: 14 }}>
          {err && <div className="alert alert-err">{err}</div>}
          {ok && <div className="alert alert-ok">{ok}</div>}

          <div className="two-col" style={{ alignItems: 'start' }}>
            <div className="field">
              <label id="fb-rating-label">{f.qSat}</label>
              <div role="group" aria-labelledby="fb-rating-label">
                <Stars value={rating} onChange={setRating} label={f.starLabel} />
              </div>
            </div>
            <div className="field">
              <label id="fb-helped-label">{f.qHelp}</label>
              <div className="seg" role="group" aria-labelledby="fb-helped-label" style={{ maxWidth: 280 }}>
                <button type="button" className={helped === true ? 'on-in' : ''}
                  aria-pressed={helped === true}
                  onClick={() => setHelped(helped === true ? null : true)}>{f.helpedYes}</button>
                <button type="button" className={helped === false ? 'on-out' : ''}
                  aria-pressed={helped === false}
                  onClick={() => setHelped(helped === false ? null : false)}>{f.helpedNo}</button>
              </div>
            </div>
          </div>

          <div className="field">
            <label htmlFor="fb-category">{f.category}</label>
            <select id="fb-category" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="fb-message">{f.message}</label>
            <textarea id="fb-message" className="input" rows={4} value={message} maxLength={4000}
              onChange={(e) => setMessage(e.target.value)} placeholder={f.messagePh} />
          </div>

          <button className="btn btn-primary" disabled={busy}>
            {busy ? f.sending : f.send}
          </button>
        </form>
      </div>

      <div className="card card-pad mt">
        <h3 className="card-title">{f.communityTitle}</h3>
        <div className="card-sub">{f.communitySub}</div>

        {!list ? (
          <div style={{ padding: 28, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
        ) : list.length === 0 ? (
          <div className="empty">
            <div className="ee"><MessageSquare size={36} /></div>
            <h3>{f.emptyTitle}</h3>
            <p>{f.emptyDesc}</p>
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            {list.map((x) => {
              const mine = x.user_id === user?.id
              const cls = STATUS_CLS[x.status] || STATUS_CLS.baru
              const stLabel = f.status[x.status] || f.status.baru
              return (
                <div key={x.id} className="fb-item">
                  <div className="flex between" style={{ alignItems: 'center' }}>
                    <div className="flex gap" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <b>{x.author_name || f.user}</b>
                      <span className="pill pill-cat">{f.cats[x.category] || x.category}</span>
                      {x.rating && <span style={{ color: '#f59e0b' }}>{'★'.repeat(x.rating)}<span style={{ color: 'var(--line-strong)' }}>{'★'.repeat(5 - x.rating)}</span></span>}
                      {x.helped === true && <span className="badge badge-green">{f.helpedBadge}</span>}
                      {x.helped === false && <span className="badge badge-amber">{f.notHelpedBadge}</span>}
                    </div>
                    <span className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(x.created_at)}</span>
                  </div>
                  <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{x.message}</p>

                  {x.admin_reply && (
                    <div className="fb-reply">
                      <div className="flex between">
                        <b>{f.teamReply}</b>
                        <span className={`badge ${cls}`}>{stLabel}</span>
                      </div>
                      <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{x.admin_reply}</p>
                    </div>
                  )}

                  {mine && (
                    <div style={{ marginTop: 8 }}>
                      <button className="linklike" style={{ color: 'var(--red)', fontSize: 13 }}
                        onClick={() => remove(x.id)}>{f.delMine}</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
