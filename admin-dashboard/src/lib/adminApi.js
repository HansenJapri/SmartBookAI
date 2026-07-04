import { supabase } from './supabase'

// ---------- VERIFIKASI ADMIN ----------
export async function checkIsAdmin() {
  const { data, error } = await supabase.rpc('is_admin')
  if (error) return false
  return Boolean(data)
}

// ---------- AUDIT LOG (jejak tindakan admin) ----------
// "Fire-and-forget": tidak pernah melempar error agar tak mengganggu aksi utama.
export async function logAdminAction(action, target_table = null, target_id = null, meta = null) {
  try {
    await supabase.from('admin_audit_log').insert({
      action, target_table, target_id: target_id != null ? String(target_id) : null, meta,
    })
  } catch { /* abaikan: tabel audit mungkin belum dimigrasi */ }
}

export async function listAuditLog({ limit = 200 } = {}) {
  const { data, error } = await supabase
    .from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}

// ---------- METRIK / KPI ----------
export async function getMetrics() {
  const { data, error } = await supabase.rpc('admin_metrics')
  if (error) throw error
  return data || {}
}

// ---------- USER ----------
export async function listUsers() {
  const { data, error } = await supabase.rpc('admin_list_users')
  if (error) throw error
  return data || []
}

export async function updateUserProfile(id, patch) {
  const { data, error } = await supabase
    .from('profiles').update(patch).eq('id', id).select().single()
  if (error) throw error
  logAdminAction('user_updated', 'profiles', id, { fields: Object.keys(patch) })
  return data
}

export async function deleteUser(id) {
  const { error } = await supabase.rpc('admin_delete_user', { p_uid: id })
  if (error) throw error
  logAdminAction('user_deleted', 'profiles', id)
}

// ---------- TRANSAKSI (semua user) ----------
export async function listTransactions({ limit = 1000, userId = null } = {}) {
  let q = supabase.from('transactions').select('*').order('occurred_at', { ascending: false }).limit(limit)
  if (userId) q = q.eq('user_id', userId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function updateTransaction(id, patch) {
  const { data, error } = await supabase
    .from('transactions').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteTransaction(id) {
  const { error } = await supabase.from('transactions').delete().eq('id', id)
  if (error) throw error
  logAdminAction('transaction_deleted', 'transactions', id)
}

// ---------- FEEDBACK (forum, sudut pandang admin) ----------
export async function listFeedback({ limit = 500 } = {}) {
  const { data, error } = await supabase
    .from('feedback').select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}

export async function replyFeedback(id, { admin_reply, status }) {
  const patch = { admin_reply, replied_at: new Date().toISOString() }
  if (status) patch.status = status
  const { data, error } = await supabase
    .from('feedback').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function setFeedbackStatus(id, status) {
  const { data, error } = await supabase
    .from('feedback').update({ status }).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteFeedback(id) {
  const { error } = await supabase.from('feedback').delete().eq('id', id)
  if (error) throw error
}

// ---------- EVENT PEMAKAIAN ----------
export async function listEvents({ days = 30, limit = 5000 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const { data, error } = await supabase
    .from('app_events').select('*').gte('created_at', since)
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}

// ---------- DOKUMEN LEGAL (S&K + Kebijakan Privasi) ----------
export async function getLegalDocs() {
  const { data, error } = await supabase
    .from('legal_docs').select('slug, title, content, updated_at').order('slug')
  if (error) throw error
  return data || []
}

export async function saveLegalDoc(slug, title, content) {
  const { data, error } = await supabase
    .from('legal_docs')
    .upsert({ slug, title, content, updated_at: new Date().toISOString() }, { onConflict: 'slug' })
    .select().single()
  if (error) throw error
  logAdminAction('legal_doc_updated', 'legal_docs', slug)
  return data
}

// ---------- REALTIME ----------
// Memanggil cb() setiap ada perubahan pada tabel tertentu.
export function subscribe(table, cb) {
  const channel = supabase
    .channel(`admin-${table}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => cb(payload))
    .subscribe()
  return () => supabase.removeChannel(channel)
}
