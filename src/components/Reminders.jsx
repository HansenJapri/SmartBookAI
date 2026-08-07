import { useEffect, useMemo, useState } from 'react'
import { Bell, Plus } from 'lucide-react'
import Modal from './Modal'
import { fetchReminders, addReminder, updateReminder, deleteReminder } from '../lib/api'
import { fmtDateTime } from '../lib/format'
import { useLang } from '../context/LangContext'
import { useAlert } from '../context/AlertContext'
import { BATAS_DATETIME, bersihkanTanggal } from '../lib/dateInput'

// Pengingat penting (mis. "ambil stok jam 3 sore"). Yang sudah jatuh waktu
// tampil sebagai notifikasi di atas Dashboard TERUS-MENERUS sampai pengguna
// menekan silang. Pengingat murni tampil di dalam aplikasi (dashboard).
export default function Reminders() {
  const { t } = useLang()
  const { showConfirm } = useAlert()
  const rm = t.reminders
  const [list, setList] = useState(null)
  const [form, setForm] = useState(null) // {title, note, remind_at(datetime-local)}
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [tick, setTick] = useState(0) // supaya status "jatuh waktu" ikut bergerak

  useEffect(() => { fetchReminders().then(setList).catch(() => setList([])) }, [])
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  const now = Date.now()
  // "tick" ikut dependensi agar daftar dievaluasi ulang tiap menit —
  // pengingat berpindah ke notifikasi tepat saat jatuh waktu.
  const due = useMemo(
    () => (list || []).filter((r) => new Date(r.remind_at).getTime() <= now),
    [list, tick], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const upcoming = useMemo(
    () => (list || []).filter((r) => new Date(r.remind_at).getTime() > now).slice(0, 5),
    [list, tick], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const dismiss = async (r) => {
    try {
      await updateReminder(r.id, { status: 'selesai', dismissed_at: new Date().toISOString() })
      setList((prev) => prev.filter((x) => x.id !== r.id))
    } catch (e) { setErr(e.message) }
  }

  const remove = async (r) => {
    if (!await showConfirm({ message: rm.confirmDelete.replace('{title}', r.title), type: 'error' })) return
    try {
      await deleteReminder(r.id)
      setList((prev) => prev.filter((x) => x.id !== r.id))
    } catch (e) { setErr(e.message) }
  }

  const save = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.title.trim()) return setErr(rm.errTitleReq)
    if (!form.remind_at) return setErr(rm.errDateReq)
    setBusy(true)
    try {
      const created = await addReminder({
        title: form.title.trim(),
        note: form.note.trim() || null,
        remind_at: new Date(form.remind_at).toISOString(),
      })
      setList((prev) => [...(prev || []), created].sort((a, b) => a.remind_at < b.remind_at ? -1 : 1))
      setForm(null)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  if (!list) return null

  return (
    <>
      {err && <div className="alert alert-err">{err}</div>}

      {/* NOTIFIKASI JATUH WAKTU — bertahan sampai pengguna menekan silang */}
      {due.map((r) => (
        <div key={r.id} className="alert alert-warn" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Bell size={16} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 200 }}>
            <b>{r.title}</b>{r.note ? ` — ${r.note}` : ''} · {fmtDateTime(r.remind_at)}
          </span>
          <button className="icon-btn" onClick={() => dismiss(r)} aria-label={rm.closeReminderAria.replace('{title}', r.title)}>✕</button>
        </div>
      ))}

      {/* KARTU KELOLA PENGINGAT */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="flex between" style={{ alignItems: 'center' }}>
          <div>
            <h3 className="card-title"><Bell size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />{rm.title}</h3>
            <div className="card-sub">{rm.sub}</div>
          </div>
          <button className="btn btn-ghost" onClick={() => { setErr(''); setForm({ title: '', note: '', remind_at: '' }) }}>
            <Plus size={15} style={{ verticalAlign: '-2px' }} /> {rm.addBtn}
          </button>
        </div>
        {upcoming.length === 0 && due.length === 0 ? (
          <p className="muted-sm" style={{ margin: '10px 0 0' }}>
            {rm.emptyMsg}
          </p>
        ) : upcoming.length > 0 && (
          <ul className="sig-drivers" style={{ marginTop: 10 }}>
            {upcoming.map((r) => (
              <li key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ flex: 1 }}><b>{r.title}</b> · {fmtDateTime(r.remind_at)}</span>
                <button className="linklike" style={{ color: 'var(--red)' }} onClick={() => remove(r)}>{rm.delete}</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* MODAL TAMBAH PENGINGAT */}
      {form && (
        <Modal onClose={() => setForm(null)} onSubmit={save} labelledBy="reminderModalTitle">
            <div className="modal-head">
              <h3 id="reminderModalTitle">{rm.modalTitle}</h3>
              <button type="button" className="icon-btn" onClick={() => setForm(null)} aria-label={rm.close}>✕</button>
            </div>
            <div className="modal-body">
              {err && <div className="alert alert-err">{err}</div>}
              <div className="field">
                <label htmlFor="rem-title">{rm.lTitle}</label>
                <input id="rem-title" className="input" value={form.title} placeholder={rm.titlePh}
                  onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="rem-note">{rm.lNote} <span className="muted-sm">{rm.optional}</span></label>
                <input id="rem-note" className="input" value={form.note} placeholder={rm.notePh}
                  onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="rem-remind-at">{rm.lDateTime}</label>
                <input id="rem-remind-at" className="input" type="datetime-local" {...BATAS_DATETIME} value={form.remind_at}
                  onChange={(e) => setForm({ ...form, remind_at: bersihkanTanggal(e.target.value) })} />
              </div>
              <p className="muted-sm" style={{ margin: 0 }}>
                {rm.modalHint}
              </p>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost btn-block" onClick={() => setForm(null)}>{rm.cancel}</button>
                <button className="btn btn-primary btn-block" disabled={busy}>{busy ? rm.saving : rm.save}</button>
              </div>
            </div>
        </Modal>
      )}
    </>
  )
}
