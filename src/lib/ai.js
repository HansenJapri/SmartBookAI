import { supabase } from './supabase'
import { getSelectedWorkspace } from './api'

// Workspace yang sedang dibuka, dikirim ke Edge Function AI supaya ringkasan
// & konteksnya diikat ke usaha ini saja. Server TIDAK mempercayainya begitu
// saja — resolve_owner() di database memverifikasi keanggotaan aktif dan
// menolak bila mengarang. Tanpa nilai ini, staf yang aktif di usaha lain
// mendapat jawaban AI yang mencampur angka dua usaha.
const activeOwner = () => getSelectedWorkspace() || undefined

// Bahasa jawaban mengikuti pilihan ID/EN di header aplikasi.
//
// Diselipkan ke PESAN, bukan hanya dikirim sebagai field terpisah, karena
// Edge Function yang ter-deploy sekarang belum membaca field `lang` —
// arahan di dalam pesan bekerja pada versi lama maupun versi baru. Field
// `lang` tetap dikirim supaya versi baru bisa memakainya langsung.
const LANG_DIRECTIVE = {
  id: 'Jawab dalam Bahasa Indonesia.',
  en: 'Reply in English. Write your entire answer in English, including any refusal or disclaimer.',
}

export function withLangDirective(message, lang = 'id') {
  const d = LANG_DIRECTIVE[lang === 'en' ? 'en' : 'id']
  return `${d}\n\n${message}`
}

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
export async function askAI(message, history = [], lang = 'id') {
  const data = await invokeFn(AI_FUNCTION, {
    message: withLangDirective(message, lang),
    history, device: deviceKind(), owner: activeOwner(), lang,
  }, 'Asisten AI sedang tidak dapat dihubungi. Coba beberapa saat lagi.')
  return cleanReply(data?.reply || '')
}

// Mode Catat (lama): kalimat bebas -> daftar kandidat transaksi.
// Dipertahankan agar alur lama tetap jalan; alur baru memakai crudAI().
// `note` dari fungsi ini ikut dibacakan asisten suara, jadi bahasanya
// mengikuti pilihan pengguna. Kalimat transaksinya sendiri dikirim apa adanya.
export async function catatAI(message, lang = 'id') {
  return invokeFn('ai-catat', {
    message: lang === 'en' ? `Write the "note" field in English.\n\n${message}` : message,
    lang,
  }, 'Fitur catat via asisten sedang tidak dapat dihubungi. Coba beberapa saat lagi, atau catat manual di menu Transaksi.')
}

// ---------- CRUD via prompt/voice (dengan slot-filling) ----------
//
// Edge Function `ai-crud` SUDAH TER-DEPLOY (v1, 3 Agustus 2026, verify_jwt=true)
// beserta modul supabase/functions/_shared/ai/. Preflight terverifikasi.
// Chatbot.jsx sudah tersambung ke sini, tetapi masih di balik sakelar
// UNIVERSAL_CATAT_ENABLED — lihat alasannya di komponen itu.
// Asisten suara tetap memakai `catatAI` (ai-catat).
// Alur pemakaian:
//   1. crudAI({ message })                       -> draft + pertanyaan pertama
//   2. crudAI({ draft, field, answer })          -> ulangi sampai ready === true
//   3. Bila draft.requiresConfirmation, tampilkan ringkasan & minta konfirmasi
//      manual pengguna SEBELUM menyimpan lewat API biasa.
//
// Menjawab pertanyaan lanjutan TIDAK memanggil AI, jadi tidak memakan kuota.
export async function crudAI({ message, draft, field, answer } = {}) {
  const body = draft ? { draft, field, answer } : { message }
  body.owner = activeOwner()
  return invokeFn('ai-crud', body,
    'Asisten pencatatan sedang tidak dapat dihubungi. Coba beberapa saat lagi, atau pakai form manual.')
}

// Ringkasan draft untuk ditampilkan/diucapkan saat konfirmasi.
export function describeDraft(draft) {
  if (!draft) return ''
  const op = draft.operation === 'create' ? 'Menambah'
    : draft.operation === 'update' ? 'Mengubah' : 'Menghapus'
  const parts = Object.entries(draft.values || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
  return `${op} ${draft.entityLabel}. ${parts.join(', ')}`
}

// Insight harian Dashboard. force=true memaksa buat ulang (kena kuota harian).
// lang menentukan bahasa narasi ('id'/'en'); dipakai juga sebagai bagian cache key.
export async function narasiAI(force = false, lang = 'id') {
  return invokeFn('ai-narasi', { force, lang },
    'Insight harian sedang tidak dapat dimuat. Coba beberapa saat lagi.')
}

// Insight stok untuk halaman Stok Produk. Sama polanya dengan narasiAI:
// hasil di-cache harian per user; force=true memaksa buat ulang.
export async function stokInsightAI(force = false, lang = 'id') {
  return invokeFn('ai-stok-insight', { force, lang },
    'Insight stok sedang tidak dapat dimuat. Coba beberapa saat lagi.')
}

// Draf komposisi biaya (BoM) untuk 1 produk — hasilnya HANYA draf,
// dikoreksi & disimpan pengguna sendiri.
export async function hppDraftAI({ productName, businessType, unit, sellPrice }) {
  return invokeFn('ai-hpp-draft', { productName, businessType, unit, sellPrice },
    'Draf HPP sedang tidak dapat dibuat. Coba beberapa saat lagi, atau isi komposisi manual.')
}

// Memicu pipeline makro harian (berjalan sekali per hari untuk SEMUA pengguna;
// pemanggilan berikutnya di hari yang sama langsung kembali tanpa biaya AI).
export async function makroRefresh() {
  return invokeFn('makro-harian', {},
    'Data harga sedang tidak dapat diperbarui. Coba beberapa saat lagi.')
}

// Harga bahan pokok resmi SP2KP Kemendag. province_id=0 => harga nasional
// (HNT) semua bapok; 1..34 => rata-rata provinsi. Di-cache server per provinsi
// per hari, jadi pemanggilan berulang tidak membebani sumber.
export async function hargaDaerah(provinceId = 0) {
  return invokeFn('harga-daerah', { province_id: provinceId },
    'Harga bahan pokok sedang tidak dapat dimuat. Coba beberapa saat lagi.')
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
    throw new Error(detail || 'Fitur baca struk sedang tidak dapat dihubungi. Coba beberapa saat lagi.')
  }
  if (data?.error) throw new Error(data.error)
  return data
}
