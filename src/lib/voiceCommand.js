import { CONFIRM_RESULT, matchConfirmation } from './voice'
import { DESTRUCTIVE_TOOLS } from './voiceInstruction'

// ============================================================
// Mesin percakapan perintah suara — gerbang wajib sebelum data berubah.
//
//   IDLE ─ucapan─> LISTENING ─fungsi dipanggil─> PROCESSING
//        └──> CONFIRMATION_PENDING ─"ya"──> EXECUTING ──> IDLE
//                    │            └─"tidak"─> IDLE (batal)
//                    └─tak jelas 3x────────> IDLE (batal demi keamanan)
//
// KENAPA KLIEN YANG MEMEGANG GERBANG, BUKAN MODEL:
// System instruction sudah memerintahkan model meminta konfirmasi lebih dulu,
// dan model biasanya menurut. "Biasanya" tidak cukup untuk fungsi yang menulis
// ke tabel transaksi. Model bisa salah paham, bisa terpancing kalimat pengguna,
// dan satu kali saja ia langsung memanggil fungsi hapus, data pengguna hilang.
//
// Jadi aturannya keras: PANGGILAN FUNGSI DARI MODEL TIDAK PERNAH DIEKSEKUSI.
// Panggilan itu hanya menjadi RENCANA yang ditahan di sini. Yang mengeksekusi
// adalah persetujuan lisan pengguna yang dicocokkan oleh matchConfirmation().
// Dengan begitu, seburuk apa pun model berperilaku, batas terburuknya adalah
// asisten yang bertanya terlalu sering — bukan data yang berubah diam-diam.
// ============================================================

export const VOICE_PHASE = {
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  CONFIRMATION_PENDING: 'confirmation_pending',
  EXECUTING: 'executing',
  ERROR: 'error',
}

// Jawaban tak jelas beruntun sebelum rencana dibatalkan. Tanpa batas ini,
// pengguna di warung yang ramai terjebak dalam lingkaran "maaf, belum jelas".
export const MAX_UNCLEAR = 3

export const initialVoiceState = () => ({
  phase: VOICE_PHASE.IDLE,
  pending: null,
  unclearCount: 0,
  error: '',
})

// ---------- Ringkasan yang dibacakan ----------

const rp = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID')

const OPERATION_LABEL = {
  id: { create: 'Menambah', update: 'Mengubah', delete: 'MENGHAPUS' },
  en: { create: 'Add', update: 'Update', delete: 'DELETE' },
}

const ENTITY_LABEL = {
  id: { transaksi: 'transaksi', produk: 'produk', pengingat: 'pengingat' },
  en: { transaksi: 'transaction', produk: 'product', pengingat: 'reminder' },
}

const FIELD_LABEL = {
  id: {
    direction: 'jenis', amount: 'nominal', description: 'keterangan', category: 'kategori',
    name: 'nama', stock: 'stok', unit: 'satuan', price: 'harga jual', cost_price: 'harga modal',
    title: 'isi', remind_at: 'waktu', note: 'catatan',
  },
  en: {
    direction: 'type', amount: 'amount', description: 'description', category: 'category',
    name: 'name', stock: 'stock', unit: 'unit', price: 'selling price', cost_price: 'cost price',
    title: 'title', remind_at: 'time', note: 'note',
  },
}

const DIRECTION_LABEL = {
  id: { in: 'pemasukan', out: 'pengeluaran' },
  en: { in: 'income', out: 'expense' },
}

// Field bernilai uang diformat sebagai Rupiah supaya ringkasan yang dibacakan
// tidak berbunyi "amount 150000" — angka telanjang paling sering salah dengar.
const MONEY_FIELDS = new Set(['amount', 'price', 'cost_price'])

const L = (lang) => (lang === 'en' ? 'en' : 'id')

/** Pecah nama fungsi `create_transaksi` menjadi bagian yang bisa dibaca. */
export function splitToolName(name) {
  const [operation, ...rest] = String(name || '').split('_')
  return { operation, entity: rest.join('_') }
}

/**
 * Ringkasan sebuah rencana perintah, dalam bahasa pengguna.
 * Inilah kalimat yang menjadi dasar persetujuan — kalau ia tidak akurat,
 * persetujuan pengguna tidak berarti apa-apa.
 */
export function describeCommand(call, lang = 'id') {
  const l = L(lang)
  const { operation, entity } = splitToolName(call?.name)
  const op = OPERATION_LABEL[l][operation] || operation
  const ent = ENTITY_LABEL[l][entity] || entity

  const args = call?.args || {}
  const bits = Object.entries(args)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => {
      const label = FIELD_LABEL[l][k] || k
      if (k === 'direction') return `${label} ${DIRECTION_LABEL[l][v] || v}`
      if (MONEY_FIELDS.has(k)) return `${label} ${rp(v)}`
      return `${label} ${v}`
    })

  const head = `${op} ${ent}`
  return bits.length ? `${head}: ${bits.join(', ')}` : head
}

const PROMPT = {
  id: {
    ask: (s) => `${s}. Ada yang ingin ditambahkan atau diubah? Kalau sudah pas, bilang "ya" untuk saya simpan.`,
    askDestructive: (s) => `${s}. Data ini akan hilang dan tidak bisa dikembalikan. Yakin mau saya hapus? Jawab "ya" kalau betul.`,
    repeat: 'Maaf, saya belum menangkap jawabannya.',
    cancelled: 'Baik, saya batalkan. Ada lagi yang bisa saya bantu?',
    givenUp: 'Saya masih belum menangkap jawabannya, jadi saya batalkan dulu supaya tidak salah simpan. Silakan sebutkan lagi.',
    executing: 'Baik, saya proses sekarang.',
    failed: 'Maaf, perintahnya gagal dijalankan.',
  },
  en: {
    ask: (s) => `${s}. Anything to add or change? If it looks right, say "yes" and I will save it.`,
    askDestructive: (s) => `${s}. This data will be gone for good. Are you sure you want me to delete it? Say "yes" to confirm.`,
    repeat: 'Sorry, I did not catch your answer.',
    cancelled: 'Alright, cancelled. Anything else I can help with?',
    givenUp: 'I still could not catch your answer, so I cancelled it to avoid saving the wrong thing. Please say it again.',
    executing: 'Alright, processing it now.',
    failed: 'Sorry, the command could not be carried out.',
  },
}

/** Kalimat konfirmasi lengkap untuk sebuah rencana. */
export function confirmationPrompt(call, lang = 'id') {
  const t = PROMPT[L(lang)]
  const summary = describeCommand(call, lang)
  return DESTRUCTIVE_TOOLS.has(call?.name) ? t.askDestructive(summary) : t.ask(summary)
}

// ---------- Transisi ----------

/**
 * Panggilan fungsi masuk dari model. TIDAK dieksekusi — ditahan sebagai rencana.
 *
 * Rencana baru selalu MENGGANTIKAN rencana lama. Itu yang membuat koreksi
 * bekerja secara alami: pengguna berkata "bukan sepuluh, lima belas", model
 * memanggil ulang dengan nilai baru, dan yang menunggu persetujuan adalah
 * angka yang benar. Menumpuk rencana justru berbahaya — pengguna bisa
 * menyetujui satu ringkasan lalu dua perintah yang tereksekusi.
 */
export function stageCommand(state, call, lang = 'id') {
  return {
    ...state,
    phase: VOICE_PHASE.CONFIRMATION_PENDING,
    pending: {
      id: call?.id ?? null,
      name: call?.name,
      args: call?.args || {},
      summary: describeCommand(call, lang),
      destructive: DESTRUCTIVE_TOOLS.has(call?.name),
    },
    unclearCount: 0,
    error: '',
    speak: confirmationPrompt(call, lang),
  }
}

/**
 * Balasan yang dikirim balik ke model sebagai hasil pemanggilan fungsi.
 *
 * Statusnya sengaja BUKAN "berhasil": model harus tahu bahwa yang terjadi
 * barulah rencana, supaya ia tidak terlanjur mengucapkan "sudah tersimpan"
 * kepada pengguna sebelum ada persetujuan.
 */
export function pendingToolResponse(pending, lang = 'id') {
  return {
    id: pending?.id ?? undefined,
    name: pending?.name,
    response: {
      status: 'PERLU_KONFIRMASI',
      ringkasan: pending?.summary,
      instruksi: L(lang) === 'en'
        ? 'Read this summary back to the user, ask whether anything should be added or changed, then ask for explicit confirmation. Do NOT say it is saved yet.'
        : 'Bacakan ringkasan ini ke pengguna, tanyakan apakah ada yang perlu ditambah atau diubah, lalu minta kepastian. JANGAN katakan sudah tersimpan.',
    },
  }
}

/**
 * Tafsirkan ucapan pengguna saat sebuah rencana menunggu persetujuan.
 * Mengembalikan state berikutnya beserta `action` yang harus dijalankan pemanggil.
 */
export function resolveConfirmation(state, text, lang = 'id') {
  const t = PROMPT[L(lang)]
  if (state.phase !== VOICE_PHASE.CONFIRMATION_PENDING || !state.pending) {
    return { ...state, action: 'none' }
  }

  const verdict = matchConfirmation(text)

  if (verdict === CONFIRM_RESULT.YES) {
    return { ...state, phase: VOICE_PHASE.EXECUTING, action: 'execute', speak: t.executing }
  }

  if (verdict === CONFIRM_RESULT.NO) {
    return { ...initialVoiceState(), action: 'cancel', speak: t.cancelled }
  }

  // Tak jelas: ulangi pertanyaan. JANGAN eksekusi. Diam-diam menganggap
  // ketidakjelasan sebagai "ya" adalah satu-satunya kesalahan di fitur ini
  // yang tidak bisa ditarik kembali.
  const unclearCount = state.unclearCount + 1
  if (unclearCount >= MAX_UNCLEAR) {
    return { ...initialVoiceState(), action: 'cancel', speak: t.givenUp }
  }
  return {
    ...state,
    unclearCount,
    action: 'repeat',
    speak: `${t.repeat} ${confirmationPrompt(state.pending, lang)}`,
  }
}

/** Perintah selesai dijalankan dengan sukses. */
export function markExecuted(state) {
  return { ...initialVoiceState(), phase: VOICE_PHASE.IDLE, lastExecuted: state.pending }
}

/** Perintah gagal dijalankan — rencana dibuang, pengguna diberi tahu. */
export function markFailed(state, message, lang = 'id') {
  const t = PROMPT[L(lang)]
  return { ...initialVoiceState(), error: message || t.failed, speak: `${t.failed} ${message || ''}`.trim() }
}

/** Sedang menunggu persetujuan lisan. */
export function isAwaitingConfirmation(state) {
  return state.phase === VOICE_PHASE.CONFIRMATION_PENDING
}

/** Sedang menulis ke database — ucapan lain diabaikan agar tidak tersimpan ganda. */
export function isExecuting(state) {
  return state.phase === VOICE_PHASE.EXECUTING
}
