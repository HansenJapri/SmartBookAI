// ============================================================
// FASE 5 OPERASIONAL — helper murni papan tugas.
// ============================================================

// Urutan kolom papan: Antre -> Dikerjakan -> Selesai.
export const TASK_STATUSES = [
  { key: 'antre', label: 'Antre', cls: 'badge-indigo' },
  { key: 'dikerjakan', label: 'Dikerjakan', cls: 'badge-amber' },
  { key: 'selesai', label: 'Selesai', cls: 'badge-green' },
]

export const TASK_PRIORITIES = [
  { key: 'tinggi', label: 'Tinggi', cls: 'badge-red', rank: 0 },
  { key: 'normal', label: 'Normal', cls: 'badge-indigo', rank: 1 },
  { key: 'rendah', label: 'Rendah', cls: 'badge-green', rank: 2 },
]

export function priorityOf(key) {
  return TASK_PRIORITIES.find((p) => p.key === key) || TASK_PRIORITIES[1]
}

// Status berikut/sebelum di alur papan (null bila sudah di ujung).
export function nextStatus(status) {
  const i = TASK_STATUSES.findIndex((s) => s.key === status)
  return i >= 0 && i < TASK_STATUSES.length - 1 ? TASK_STATUSES[i + 1].key : null
}
export function prevStatus(status) {
  const i = TASK_STATUSES.findIndex((s) => s.key === status)
  return i > 0 ? TASK_STATUSES[i - 1].key : null
}

// Terlambat = punya jadwal, sudah lewat tanggalnya, dan belum selesai.
export function isTaskOverdue(task, today = new Date()) {
  if (!task?.due_date || task.status === 'selesai') return false
  return today.getTime() > new Date(`${task.due_date}T23:59:59`).getTime()
}

// Urutan kartu dalam kolom: prioritas tinggi dulu, lalu jadwal terdekat,
// lalu yang paling lama dibuat.
export function sortTasks(tasks) {
  return [...(tasks || [])].sort((a, b) => {
    const pr = priorityOf(a.priority).rank - priorityOf(b.priority).rank
    if (pr !== 0) return pr
    const da = a.due_date || '9999-12-31'
    const db = b.due_date || '9999-12-31'
    if (da !== db) return da < db ? -1 : 1
    return new Date(a.created_at) - new Date(b.created_at)
  })
}
