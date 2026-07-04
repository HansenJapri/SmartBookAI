import { supabase } from './supabase'

// Nama Edge Function di Supabase. Saat deploy, fungsi ini diberi nama
// "BukuPencatatan", jadi nama di sini harus sama persis.
const AI_FUNCTION = 'BukuPencatatan'

// Membersihkan simbol markdown dari jawaban AI agar tampil rapi sebagai teks
// biasa (tanpa *, **, #, backtick). Penanda daftar diubah jadi butir yang rapi.
export function cleanReply(text) {
  if (!text) return ''
  return String(text)
    .replace(/^[ \t]*[*\-•]\s+/gm, '• ')          // butir daftar -> "• "
    .replace(/\*\*/g, '').replace(/\*/g, '')        // tebal/miring markdown
    .replace(/^#{1,6}\s*/gm, '')                    // judul markdown
    .replace(/`{1,3}/g, '')                         // kode
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)') // tautan markdown
    .replace(/\n{3,}/g, '\n\n')                     // rapikan baris kosong berlebih
    .trim()
}

// Mengirim pertanyaan ke Edge Function AI. History hanya dipakai untuk
// konteks dalam sesi; tidak disimpan di server maupun database.
export async function askAI(message, history = []) {
  const { data, error } = await supabase.functions.invoke(AI_FUNCTION, {
    body: { message, history },
  })
  if (error) {
    // Coba ambil pesan error dari respons fungsi bila ada.
    let detail = ''
    try { detail = (await error.context?.json())?.error } catch { /* abaikan */ }
    throw new Error(detail || 'Asisten AI belum aktif atau gagal dihubungi. Pastikan Edge Function sudah di-deploy.')
  }
  if (data?.error) throw new Error(data.error)
  return cleanReply(data?.reply || '')
}

// Mengubah File jadi base64 (tanpa prefix data URL) untuk dikirim ke AI.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ base64: String(reader.result).split(',')[1] || '', mimeType: file.type || 'image/jpeg' })
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Mengirim foto/PDF struk ke Edge Function vision dan mengembalikan data
// terstruktur: { merchant, date, total, items: [{name, qty, unit, unit_price, total}] }.
export async function readReceipt(file) {
  const { base64, mimeType } = await fileToBase64(file)
  const { data, error } = await supabase.functions.invoke('BukuPencatatanStruk', {
    body: { image: base64, mimeType },
  })
  if (error) {
    let detail = ''
    try { detail = (await error.context?.json())?.error } catch { /* abaikan */ }
    throw new Error(detail || 'Fitur baca struk belum aktif. Pastikan Edge Function "BukuPencatatanStruk" sudah di-deploy.')
  }
  if (data?.error) throw new Error(data.error)
  return data
}
