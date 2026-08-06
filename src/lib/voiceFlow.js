import { CONFIRM_RESULT, matchConfirmation } from './voice'

// ============================================================
// Mesin percakapan untuk pencatatan lewat suara (tanpa tombol manual).
//
//   idle ──ucapan──> confirming ──"ya"──> saving ──> idle
//                         │
//                         └──"tidak"/tak jelas 3x──> idle (batal)
//
// Sumber draft adalah Edge Function `ai-catat` — fungsi yang SAMA dengan mode
// Catat yang sudah dipakai sehari-hari, jadi jalur suara tidak bergantung pada
// backend baru mana pun. Bentuk balasannya: { transactions: [...], note }.
//
// Gerbang wajib sebelum menyimpan: ringkasan dibacakan ulang dan pengguna harus
// menyetujui secara lisan. Jawaban yang tidak jelas TIDAK dihitung setuju.
// Salah dengar yang menyimpan transaksi jauh lebih merugikan daripada salah
// dengar yang meminta pengguna mengulang.
// ============================================================

export const VOICE_STATE = {
  IDLE: 'idle',
  CONFIRMING: 'confirming',
  SAVING: 'saving',
}

export const initialFlow = () => ({
  state: VOICE_STATE.IDLE,
  drafts: null,
  summary: '',
  unclearCount: 0,
})

// Batas jawaban tak jelas beruntun sebelum draft dibatalkan. Tanpa ini,
// pengguna di tempat berisik terjebak dalam lingkaran "maaf, belum menangkap".
export const MAX_UNCLEAR = 3

const rp = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID')

/** Ringkasan draft yang dibacakan asisten, dalam bahasa pilihan pengguna. */
export function describeDrafts(drafts, lang = 'id') {
  const list = Array.isArray(drafts) ? drafts : []
  if (!list.length) return ''
  return list.map((d) => {
    const dir = d.direction === 'out'
      ? (lang === 'en' ? 'expense' : 'pengeluaran')
      : (lang === 'en' ? 'income' : 'pemasukan')
    const desc = String(d.description || '').trim()
    return lang === 'en'
      ? `${dir} ${rp(d.amount)}${desc ? ` for ${desc}` : ''}`
      : `${dir} ${rp(d.amount)}${desc ? ` untuk ${desc}` : ''}`
  }).join(lang === 'en' ? ', and ' : ', dan ')
}

/** Kalimat konfirmasi akhir. */
export function confirmationPrompt(summary, lang = 'id') {
  return lang === 'en'
    ? `${summary}. Is that correct? Say yes to save, or no to cancel.`
    : `${summary}. Apakah sudah benar? Jawab ya untuk menyimpan, atau tidak untuk membatalkan.`
}

const T = {
  id: {
    notUnderstood: 'Saya belum menangkap transaksi dari kalimat itu. Sebutkan nominalnya, contoh: laku 3 donat total 15 ribu.',
    saving: 'Baik, saya simpan.',
    cancelled: 'Baik, saya batalkan. Silakan sebutkan lagi kalau mau mencatat ulang.',
    givenUp: 'Saya masih belum menangkap jawabannya, jadi saya batalkan dulu supaya tidak salah simpan. Silakan sebutkan lagi.',
    repeat: 'Maaf, saya belum menangkap.',
    failed: 'Maaf, saya belum bisa memproses itu.',
  },
  en: {
    notUnderstood: 'I did not catch a transaction in that sentence. Please state the amount, for example: sold 3 donuts for 15 thousand.',
    saving: 'Alright, saving it now.',
    cancelled: 'Alright, cancelled. Just say it again whenever you want to record it.',
    givenUp: 'I still could not catch your answer, so I cancelled it to avoid saving the wrong thing. Please say it again.',
    repeat: 'Sorry, I did not catch that.',
    failed: 'Sorry, I could not process that.',
  },
}

const tr = (lang) => T[lang === 'en' ? 'en' : 'id']

/**
 * Langkah berikutnya setelah balasan `ai-catat`.
 * Murni: tidak menyentuh jaringan maupun DOM.
 */
export function advanceFromServer(flow, res, lang = 'id') {
  const t = tr(lang)
  if (!res || res.error) {
    return { ...initialFlow(), speak: res?.error || t.failed }
  }

  // Hanya transaksi bernominal > 0 yang layak dikonfirmasi. ai-catat sengaja
  // memindahkan yang nominalnya tidak jelas ke `note`, bukan ke daftar.
  const drafts = (Array.isArray(res.transactions) ? res.transactions : [])
    .filter((d) => Number(d?.amount) > 0)

  if (!drafts.length) {
    return { ...initialFlow(), speak: res.note || t.notUnderstood }
  }

  const summary = describeDrafts(drafts, lang)
  return {
    ...flow,
    state: VOICE_STATE.CONFIRMING,
    drafts,
    summary,
    unclearCount: 0,
    speak: confirmationPrompt(summary, lang),
  }
}

/**
 * Menafsirkan ucapan pengguna saat asisten menunggu konfirmasi.
 * Mengembalikan flow berikutnya + `action` yang dijalankan pemanggil.
 */
export function handleConfirmationReply(flow, text, lang = 'id') {
  const t = tr(lang)
  const verdict = matchConfirmation(text)

  if (verdict === CONFIRM_RESULT.YES) {
    return { ...flow, state: VOICE_STATE.SAVING, action: 'save', speak: t.saving }
  }

  if (verdict === CONFIRM_RESULT.NO) {
    return { ...initialFlow(), action: 'cancel', speak: t.cancelled }
  }

  // Tidak jelas: ulangi ringkasan, JANGAN simpan.
  const unclearCount = flow.unclearCount + 1
  if (unclearCount >= MAX_UNCLEAR) {
    return { ...initialFlow(), action: 'cancel', speak: t.givenUp }
  }
  return {
    ...flow,
    unclearCount,
    action: 'repeat',
    speak: `${t.repeat} ${confirmationPrompt(flow.summary, lang)}`,
  }
}

/** Sesi sedang menunggu jawaban ya/tidak. */
export function isAwaitingConfirmation(flow) {
  return flow.state === VOICE_STATE.CONFIRMING
}

/** Ucapan diabaikan saat menyimpan agar tidak tersimpan dua kali. */
export function isBusy(flow) {
  return flow.state === VOICE_STATE.SAVING
}

/** Baris siap-simpan untuk addTransactionsBulk — bentuknya sama dengan mode Catat. */
export function toTransactionRows(drafts) {
  const now = new Date()
  return (drafts || [])
    .filter((d) => Number(d.amount) > 0)
    .map((d) => {
      const ds = /^\d{4}-\d{2}-\d{2}$/.test(d.occurred_at || '') ? d.occurred_at : now.toISOString().slice(0, 10)
      const [y, m, day] = ds.split('-').map(Number)
      return {
        description: String(d.description || '').slice(0, 200) || (d.direction === 'in' ? 'Penjualan' : 'Pengeluaran'),
        amount: Math.round(Number(d.amount)),
        direction: d.direction === 'in' ? 'in' : 'out',
        category: d.category,
        channel: 'asisten',
        // Tanggal dibangun dari komponen LOKAL supaya tidak bergeser sehari
        // saat dikonversi ke UTC.
        occurred_at: new Date(y, m - 1, day, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString(),
        payment_status: d.direction === 'in' && d.payment_status === 'belum' ? 'belum' : 'lunas',
      }
    })
}
