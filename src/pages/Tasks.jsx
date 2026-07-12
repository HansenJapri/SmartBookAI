import { useEffect, useMemo, useState } from 'react'
import { ListTodo, ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { fetchTasks, addTask, updateTask, deleteTask, fetchEmployees } from '../lib/api'
import {
  TASK_STATUSES, TASK_PRIORITIES, priorityOf, nextStatus, prevStatus, isTaskOverdue, sortTasks,
} from '../lib/ops'
import { fmtDate } from '../lib/format'

const blankForm = () => ({ id: null, title: '', note: '', priority: 'normal', due_date: '', assignee_id: '' })

// Papan Tugas Harian: Antre -> Dikerjakan -> Selesai.
// Perpindahan pakai tombol (bukan drag) agar ramah sentuh & bebas salah geser.
// Setiap perubahan terekam otomatis di Audit Log (= log aktivitas operasional).
export default function Tasks() {
  const [tasks, setTasks] = useState(null)
  const [employees, setEmployees] = useState([])
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetchTasks().then(setTasks).catch(() => setTasks([]))
    fetchEmployees().then(setEmployees).catch(() => {})
  }, [])

  const empName = (id) => employees.find((e) => e.id === id)?.name || null
  const activeEmps = employees.filter((e) => e.status === 'aktif')
  const today = new Date()

  const byStatus = useMemo(() => {
    const map = { antre: [], dikerjakan: [], selesai: [] }
    for (const t of tasks || []) (map[t.status] || map.antre).push(t)
    for (const k of Object.keys(map)) map[k] = sortTasks(map[k])
    return map
  }, [tasks])

  const move = async (task, status) => {
    setErr('')
    try {
      const upd = await updateTask(task.id, {
        status,
        done_at: status === 'selesai' ? new Date().toISOString() : null,
      })
      setTasks((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
    } catch (e2) { setErr(e2.message) }
  }

  const save = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.title.trim()) return setErr('Judul tugas wajib diisi.')
    setBusy(true)
    try {
      const payload = {
        title: form.title.trim(),
        note: form.note.trim() || null,
        priority: form.priority,
        due_date: form.due_date || null,
        assignee_id: form.assignee_id || null,
      }
      if (form.id) {
        const upd = await updateTask(form.id, payload)
        setTasks((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
      } else {
        const created = await addTask({ ...payload, status: 'antre' })
        setTasks((prev) => [created, ...(prev || [])])
      }
      setForm(null)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const remove = async (task) => {
    if (!confirm(`Hapus tugas "${task.title}"? (Terekam di Audit Log)`)) return
    try {
      await deleteTask(task.id)
      setTasks((prev) => prev.filter((x) => x.id !== task.id))
    } catch (e2) { setErr(e2.message) }
  }

  if (!tasks) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <>
      {err && <div className="alert alert-err">{err}</div>}
      <div className="toolbar">
        <p className="muted-sm" style={{ flex: 1, margin: 0 }}>
          Gunakan tombol ◀ ▶ untuk memindah tugas antar kolom. Riwayat perubahan tercatat di Audit Log.
        </p>
        <button className="btn btn-primary" onClick={() => { setErr(''); setForm(blankForm()) }}>+ Tambah Tugas</button>
      </div>

      {tasks.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee"><ListTodo size={36} /></div>
          <h3>Belum ada tugas</h3>
          <p>Catat pekerjaan harian (produksi, kirim pesanan, belanja bahan) agar tim tahu apa yang antre, dikerjakan, dan selesai.</p>
          <button className="btn btn-primary" onClick={() => setForm(blankForm())}>+ Tambah Tugas Pertama</button>
        </div></div>
      ) : (
        <div className="kanban">
          {TASK_STATUSES.map((col) => (
            <div className="kb-col" key={col.key}>
              <div className="kb-head">
                <span className={`badge ${col.cls}`}>{col.label}</span>
                <span className="muted-sm">{byStatus[col.key].length} tugas</span>
              </div>
              {byStatus[col.key].length === 0 && <p className="muted-sm" style={{ padding: '4px 2px' }}>Kosong</p>}
              {byStatus[col.key].map((t) => {
                const pr = priorityOf(t.priority)
                const late = isTaskOverdue(t, today)
                const back = prevStatus(t.status)
                const fwd = nextStatus(t.status)
                return (
                  <div className="kb-card" key={t.id}>
                    <div className="kb-title"><b>{t.title}</b></div>
                    {t.note && <div className="muted-sm">{t.note}</div>}
                    <div className="kb-meta">
                      {t.priority !== 'normal' && <span className={`badge ${pr.cls}`}>{pr.label}</span>}
                      {t.due_date && (
                        late
                          ? <span className="badge badge-red">terlambat · {fmtDate(t.due_date)}</span>
                          : <span className="muted-sm">jadwal {fmtDate(t.due_date)}</span>
                      )}
                      {t.assignee_id && empName(t.assignee_id) && (
                        <span className="pill pill-ch">{empName(t.assignee_id)}</span>
                      )}
                      {t.status === 'selesai' && t.done_at && (
                        <span className="muted-sm">selesai {fmtDate(t.done_at)}</span>
                      )}
                    </div>
                    <div className="kb-actions">
                      <button className="icon-btn" disabled={!back} title={back ? `Kembalikan ke ${back}` : ''}
                        aria-label="Mundurkan status" onClick={() => back && move(t, back)}>
                        <ChevronLeft size={15} />
                      </button>
                      <button className="icon-btn" disabled={!fwd} title={fwd ? `Pindah ke ${fwd}` : ''}
                        aria-label="Majukan status" onClick={() => fwd && move(t, fwd)}>
                        <ChevronRight size={15} />
                      </button>
                      <div style={{ flex: 1 }} />
                      <button className="icon-btn" title="Ubah" aria-label="Ubah" onClick={() => {
                        setErr('')
                        setForm({
                          id: t.id, title: t.title, note: t.note || '', priority: t.priority,
                          due_date: t.due_date || '', assignee_id: t.assignee_id || '',
                        })
                      }}><Pencil size={14} /></button>
                      <button className="icon-btn danger" title="Hapus" aria-label="Hapus" onClick={() => remove(t)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <div className="modal-head">
              <h3>{form.id ? 'Ubah Tugas' : 'Tambah Tugas'}</h3>
              <button type="button" className="icon-btn" onClick={() => setForm(null)}>✕</button>
            </div>
            <div className="modal-body">
              {err && <div className="alert alert-err">{err}</div>}
              <div className="field">
                <label>Judul tugas</label>
                <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="cth: Produksi 50 bolu untuk pesanan Bu Sari" />
              </div>
              <div className="field">
                <label>Catatan <span className="muted-sm">(opsional)</span></label>
                <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Prioritas</label>
                  <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                    {TASK_PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Jadwal / tenggat <span className="muted-sm">(opsional)</span></label>
                  <input className="input" type="date" value={form.due_date}
                    onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label>Ditugaskan ke <span className="muted-sm">(opsional, dari Data Karyawan)</span></label>
                <select className="input" value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}>
                  <option value="">— tanpa petugas —</option>
                  {activeEmps.map((e2) => <option key={e2.id} value={e2.id}>{e2.name}</option>)}
                </select>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost btn-block" onClick={() => setForm(null)}>Batal</button>
                <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
