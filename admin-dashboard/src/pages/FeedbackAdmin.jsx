import { useEffect, useMemo, useState, useCallback } from 'react'
import { listFeedback, replyFeedback, setFeedbackStatus, deleteFeedback, subscribe } from '../lib/adminApi'
import { fmtDateTime, num } from '../lib/format'
import { Stars, StatusBadge, Spinner } from '../components/ui'

const CAT_LABEL = { saran: '💡 Saran', bug: '🐞 Bug', pujian: '❤️ Pujian', pertanyaan: '❓ Pertanyaan', lainnya: '🗂️ Lainnya' }
const STATUSES = ['baru', 'dibaca', 'ditindaklanjuti', 'selesai']
const FILTERS = [
  { v: 'all', label: 'Semua' }, { v: 'baru', label: 'Baru' },
  { v: 'open', label: 'Belum selesai' }, { v: 'bug', label: 'Bug' }, { v: 'pujian', label: 'Pujian' },
]

export default function FeedbackAdmin() {
  const [rows, setRows] = useState(null)
  const [filter, setFilter] = useState('all')
  const [replyFor, setReplyFor] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => listFeedback().then(setRows).catch((e) => { console.error(e); setRows([]) }), [])
  useEffect(() => { load(); const unsub = subscribe('feedback', load); return unsub }, [load])

  const filtered = useMemo(() => {
    if (!rows) return []
    return rows.filter((f) => {
      if (filter === 'all') return true
      if (filter === 'open') return f.status !== 'selesai'
      if (filter === 'baru') return f.status === 'baru'
      return f.category === filter
    })
  }, [rows, filter])

  const counts = useMemo(() => {
    if (!rows) return {}
    return {
      total: rows.length,
      baru: rows.filter((f) => f.status === 'baru').length,
      open: rows.filter((f) => f.status !== 'selesai').length,
    }
  }, [rows])

  const openReply = (f) => { setReplyFor(f); setReplyText(f.admin_reply || '') }

  const sendReply = async () => {
    if (!replyText.trim()) return
    setBusy(true)
    try {
      await replyFeedback(replyFor.id, { admin_reply: replyText.trim(), status: 'ditindaklanjuti' })
      setReplyFor(null); setReplyText(''); await load()
    } catch (e) { alert(e.message) } finally { setBusy(false) }
  }

  const changeStatus = async (f, status) => {
    try { await setFeedbackStatus(f.id, status); await load() } catch (e) { alert(e.message) }
  }

  const remove = async (f) => {
    if (!confirm('Hapus postingan feedback ini secara permanen?')) return
    try { await deleteFeedback(f.id); await load() } catch (e) { alert(e.message) }
  }

  if (!rows) return <Spinner />

  return (
    <>
      <div className="toolbar">
        {FILTERS.map((f) => (
          <button key={f.v} className={`btn btn-sm ${filter === f.v ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(f.v)}>{f.label}</button>
        ))}
        <span className="muted-sm grow" style={{ textAlign: 'right' }}>
          {num(counts.total)} masukan · <b style={{ color: 'var(--indigo)' }}>{num(counts.baru)}</b> baru · {num(counts.open)} belum selesai
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="card"><div className="empty"><div className="ee">💬</div><h3>Tidak ada feedback</h3><p>Belum ada masukan pada filter ini.</p></div></div>
      ) : filtered.map((f) => (
        <div key={f.id} className="fb-card">
          <div className="fb-head">
            <div className="fb-meta">
              <b>{f.author_name || 'Pengguna'}</b>
              <span className="pill">{CAT_LABEL[f.category] || f.category}</span>
              {f.rating ? <Stars value={f.rating} /> : null}
              {f.helped === true && <span className="badge badge-green">Terbantu</span>}
              {f.helped === false && <span className="badge badge-amber">Belum terbantu</span>}
              <StatusBadge status={f.status} />
            </div>
            <span className="muted-sm">{fmtDateTime(f.created_at)}</span>
          </div>

          <div className="fb-msg">{f.message}</div>

          {f.admin_reply && (
            <div className="fb-reply-box">
              <b style={{ color: 'var(--indigo-600)', fontSize: 13 }}>↳ Balasanmu</b>
              <div style={{ marginTop: 5, fontSize: 13.5, color: 'var(--slate)', whiteSpace: 'pre-wrap' }}>{f.admin_reply}</div>
            </div>
          )}

          <div className="fb-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => openReply(f)}>{f.admin_reply ? 'Edit balasan' : '↳ Balas'}</button>
            <select className="input" style={{ width: 'auto', padding: '6px 10px', fontSize: 12.5 }}
              value={f.status} onChange={(e) => changeStatus(f, e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="btn btn-danger btn-sm" onClick={() => remove(f)}>Hapus</button>
          </div>

          {replyFor?.id === f.id && (
            <div style={{ marginTop: 12 }}>
              <textarea className="input" rows={3} autoFocus value={replyText}
                onChange={(e) => setReplyText(e.target.value)} placeholder="Tulis balasan untuk pengguna..." />
              <div className="flex gap" style={{ marginTop: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={sendReply} disabled={busy}>{busy ? 'Mengirim...' : 'Kirim balasan'}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setReplyFor(null)}>Batal</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </>
  )
}
