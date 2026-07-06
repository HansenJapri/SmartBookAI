import { supabase } from './supabase'

// Nama Edge Function di Supabase. Saat deploy, fungsi ini diberi nama
// "BukuPencatatan", jadi nama di sini harus sama persis.
const AI_FUNCTION = 'BukuPencatatan'

// Deteksi perangkat sederhana — dipakai agar instruksi navigasi dari chatbot
// sesuai tampilan pengguna (bar bawah di HP vs sidebar di desktop).
export function deviceKind() {
  try { return window.innerWidth < 768 ? 'mobile' : 'desktop' } catch { return 'desktop' }
}

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

// Helper umum: panggil Edge Function + angkat pesan error yang jelas.
async function invokeFn(name, body, fallbackErr) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let detail = ''
    try { detail = (await error.context?.json())?.error } catch { /* abaikan */ }
    throw new Error(detail || fallbackErr)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

// Mengirim pertanyaan ke Edge Function AI (mode Tanya). History hanya untuk
// konteks dalam sesi; tidak disimpan di server maupun database.
export async function askAI(message, history = []) {
  const data = await invokeFn(AI_FUNCTION, { message, history, device: deviceKind() },
    'Asisten AI belum aktif atau gagal dihubungi. Pastikan Edge Function sudah di-deploy.')
  return cleanReply(data?.reply || '')
}

// Mode Catat: kalimat bebas -> daftar kandidat transaksi (belum tersimpan;
// pengguna WAJIB meninjau & menekan Simpan dulu).
export async function catatAI(message) {
  return invokeFn('ai-catat', { message },
    'Fitur catat via asisten belum aktif. Pastikan Edge Function "ai-catat" sudah di-deploy.')
}

// Insight harian Dashboard. force=true memaksa buat ulang (kena kuota harian).
export async function narasiAI(force = false) {
  return invokeFn('ai-narasi', { force },
    'Fitur insight belum aktif. Pastikan Edge Function "ai-narasi" sudah di-deploy.')
}

// Draf komposisi biaya (BoM) untuk 1 produk — hasilnya HANYA draf,
// dikoreksi & disimpan pengguna sendiri.
export async function hppDraftAI({ productName, businessType, unit, sellPrice }) {
  return invokeFn('ai-hpp-draft', { productName, businessType, unit, sellPrice },
    'Fitur draf HPP belum aktif. Pastikan Edge Function "ai-hpp-draft" sudah di-deploy.')
}

// Memicu pipeline makro harian (berjalan sekali per hari untuk SEMUA pengguna;
// pemanggilan berikutnya di hari yang sama langsung kembali tanpa biaya AI).
export async function makroRefresh() {
  return invokeFn('makro-harian', {},
    'Pipeline makro belum aktif. Pastikan Edge Function "makro-harian" sudah di-deploy.')
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
// terstruktur: { merchant, date, total, legibility, items: [...] }.
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
