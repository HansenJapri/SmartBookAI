import { supabase } from './supabase'

// Nama Edge Function admin di Supabase (harus sama dengan nama saat deploy).
const AI_FUNCTION = 'BukuPencatatanAdmin'

// Membersihkan simbol markdown dari jawaban AI agar tampil rapi sebagai teks biasa.
export function cleanReply(text) {
  if (!text) return ''
  return String(text)
    .replace(/^[ \t]*[*\-•]\s+/gm, '• ')
    .replace(/\*\*/g, '').replace(/\*/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Mengirim pertanyaan admin ke Edge Function. History hanya untuk konteks dalam
// sesi; tidak disimpan di server maupun database.
export async function askAdminAI(message, history = []) {
  const { data, error } = await supabase.functions.invoke(AI_FUNCTION, {
    body: { message, history },
  })
  if (error) {
    let detail = ''
    try { detail = (await error.context?.json())?.error } catch { /* abaikan */ }
    throw new Error(detail || 'Asisten AI belum aktif atau gagal dihubungi. Pastikan Edge Function "BukuPencatatanAdmin" sudah di-deploy.')
  }
  if (data?.error) throw new Error(data.error)
  return cleanReply(data?.reply || '')
}
